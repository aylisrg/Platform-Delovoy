import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  apiError,
  apiForbidden,
  apiNotFound,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasModuleAccess } from "@/lib/permissions";
import { sendMessage } from "@/lib/avito/messenger";
import { AvitoReplySchema } from "@/lib/avito/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ publicId: string }> };

/**
 * POST /api/tasks/:publicId/avito/reply
 *
 * Sends a manager reply into the underlying Avito Messenger chat associated
 * with the given Task (must have `externalContact.source = "avito"` +
 * `avitoChatId`). Records:
 *   - AvitoMessage (direction=OUTBOUND, taskId)
 *   - TaskComment (source=MANUAL, authorUserId)
 *   - TaskEvent (kind=COMMENT_ADDED, metadata.avitoSent=true)
 *   - AuditLog (action="avito.message.send")
 *
 * RBAC: SUPERADMIN, ADMIN with avito section, or MANAGER with module access
 * for the Task's underlying AvitoItem.moduleSlug.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;

    const raw = await request.json().catch(() => null);
    const parsed = AvitoReplySchema.safeParse(raw);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }

    const task = await prisma.task.findUnique({
      where: { publicId },
      select: {
        id: true,
        publicId: true,
        externalContact: true,
        deletedAt: true,
      },
    });
    if (!task || task.deletedAt) return apiNotFound("Задача не найдена");

    const ec = (task.externalContact ?? {}) as Record<string, unknown>;
    const isAvito = ec.source === "avito";
    const chatId = typeof ec.avitoChatId === "string" ? ec.avitoChatId : null;
    if (!isAvito || !chatId) {
      return apiError("INVALID_TASK", "Задача не из канала Авито", 400);
    }
    const itemId = typeof ec.avitoItemId === "string" ? ec.avitoItemId : null;

    // RBAC: resolve moduleSlug from AvitoItem and gate by it.
    let moduleSlug: string | null = null;
    if (itemId) {
      const item = await prisma.avitoItem.findUnique({
        where: { avitoItemId: itemId },
        select: { moduleSlug: true },
      });
      moduleSlug = item?.moduleSlug ?? null;
    }

    const role = session.user.role;
    if (role === "USER") return apiForbidden();
    if (role !== "SUPERADMIN") {
      const allowed = moduleSlug
        ? await hasModuleAccess(session.user.id, moduleSlug)
        : role === "ADMIN";
      if (!allowed) return apiForbidden("Нет доступа к этому модулю");
    }

    const result = await sendMessage({
      chatId,
      itemId: itemId ?? undefined,
      text: parsed.data.text,
    });

    if (!result.ok) {
      await prisma.systemEvent
        .create({
          data: {
            level: "ERROR",
            source: "avito.reply",
            message: "avito.reply.send_failed",
            metadata: {
              taskPublicId: publicId,
              reason: result.reason,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      return apiError(
        result.retryable ? "AVITO_API_ERROR" : "AVITO_SEND_REJECTED",
        result.reason,
        502
      );
    }

    const externalId =
      result.externalId ?? `manual:${task.id}:${Date.now()}`;

    // Persist outbound trace + comment + event + audit (best-effort wrapped).
    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorUserId: session.user.id,
        body: parsed.data.text,
        source: "MANUAL",
        visibleToReporter: false,
      },
    });

    await prisma.avitoMessage
      .create({
        data: {
          avitoMessageId: externalId,
          avitoChatId: chatId,
          direction: "OUTBOUND",
          authorAvitoUserId: null,
          authorName: session.user.name ?? null,
          body: parsed.data.text,
          receivedAt: new Date(),
          taskId: task.id,
          taskCommentId: comment.id,
        },
      })
      .catch(async (err) => {
        // External id collision (extremely unlikely) — log and continue.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return;
        }
        throw err;
      });

    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorUserId: session.user.id,
        kind: "COMMENT_ADDED",
        metadata: {
          commentId: comment.id,
          source: "avito",
          avitoSent: true,
          avitoChatId: chatId,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "avito.message.send",
        entity: "Task",
        entityId: task.id,
        metadata: {
          publicId,
          avitoChatId: chatId,
          length: parsed.data.text.length,
        },
      },
    });

    return apiResponse({ ok: true, commentId: comment.id });
  } catch (err) {
    console.error("[POST /api/tasks/:publicId/avito/reply]", err);
    return apiServerError();
  }
}
