import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { getParticipants, listMessages } from "@/modules/messenger/service";
import { listMessagesQuerySchema } from "@/modules/messenger/validation";

type Params = { params: Promise<{ chatId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role === "USER") return apiForbidden();

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return apiNotFound();

  const query = listMessagesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return apiError("VALIDATION_ERROR", query.error.message, 422);

  const [participants, messages] = await Promise.all([
    getParticipants(chatId),
    listMessages(chatId, query.data),
  ]);

  return apiResponse({ chat, participants, messages: messages.messages });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN" && session.user.role !== "ADMIN") return apiForbidden();

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return apiNotFound();

  const body = await request.json().catch(() => ({})) as { archived?: boolean };
  if (typeof body.archived !== "boolean") {
    return apiError("VALIDATION_ERROR", "archived must be boolean", 422);
  }

  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { archivedAt: body.archived ? new Date() : null },
  });

  await logAudit(
    session.user.id,
    body.archived ? "CHAT_ARCHIVED" : "CHAT_UNARCHIVED",
    "Chat",
    chatId,
  );

  return apiResponse(updated);
}
