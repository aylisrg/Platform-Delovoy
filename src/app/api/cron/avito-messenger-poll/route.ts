import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError, apiResponse, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { listChatsUnread, listMessages } from "@/lib/avito/messenger";
import { routeInboundMessage } from "@/lib/avito/lead-routing";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/avito-messenger-poll?token=<CRON_SECRET>
 *
 * Fallback polling for Avito Messenger when webhooks miss messages
 * (Avito Pro does not retry politely on delivery failures — see ADR §Q2).
 *
 * Schedule: every 30 seconds via host cron.
 * Gating:
 *   - process.env.AVITO_CRON_ENABLED === "true"
 *   - AvitoIntegration.pollEnabled === true
 *
 * For each unread chat we list messages newer than the latest known
 * `AvitoMessage.receivedAt` for that chat and re-route them through the same
 * pipeline as webhook. Idempotency is enforced by UNIQUE on
 * `AvitoMessage.avitoMessageId` — webhook + polling can't double-create.
 */
export async function GET(request: NextRequest) {
  return run(request);
}
export async function POST(request: NextRequest) {
  return run(request);
}

async function run(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!token || token !== cronSecret) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    if (process.env.AVITO_CRON_ENABLED !== "true") {
      return apiResponse({ skipped: true, reason: "AVITO_CRON_ENABLED is not 'true'" });
    }

    const integration = await prisma.avitoIntegration.findUnique({
      where: { id: "default" },
      select: { pollEnabled: true, avitoUserId: true },
    });
    if (!integration?.pollEnabled) {
      return apiResponse({ skipped: true, reason: "pollEnabled=false" });
    }
    if (!integration.avitoUserId) {
      return apiResponse({ skipped: true, reason: "avitoUserId not set" });
    }

    const chats = await listChatsUnread();
    let processed = 0;
    let skipped = 0;

    for (const chat of chats) {
      const lastKnown = await prisma.avitoMessage.findFirst({
        where: { avitoChatId: chat.chatId, direction: "INBOUND" },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      });
      const since = lastKnown?.receivedAt ?? null;

      const messages = await listMessages(chat.chatId, since);
      for (const m of messages) {
        try {
          const res = await routeInboundMessage({
            avitoMessageId: m.avitoMessageId,
            avitoChatId: m.avitoChatId,
            avitoItemId: m.avitoItemId ?? chat.itemId ?? null,
            authorAvitoUserId: m.authorAvitoUserId ?? "unknown",
            authorName: null,
            body: m.body,
            receivedAt: m.receivedAt,
            rawPayload: m.rawPayload,
          });
          if (res.idempotent) skipped += 1;
          else processed += 1;
        } catch (err) {
          await prisma.systemEvent
            .create({
              data: {
                level: "ERROR",
                source: "avito.cron.poll",
                message: "avito.cron.routing_failed",
                metadata: {
                  err: err instanceof Error ? err.message : String(err),
                  avitoMessageId: m.avitoMessageId,
                } as Prisma.InputJsonValue,
              },
            })
            .catch(() => undefined);
        }
      }
    }

    return apiResponse({ chats: chats.length, processed, skipped });
  } catch (err) {
    console.error("[cron avito-messenger-poll]", err);
    return apiServerError();
  }
}
