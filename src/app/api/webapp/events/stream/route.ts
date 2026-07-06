import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { subscribeUserEvents, subscribeChatEvents } from "@/lib/user-events";
import { markOnline, markOffline, refreshHeartbeat } from "@/lib/realtime/presence";
import { createSseResponse } from "@/lib/realtime/sse";
import { randomUUID } from "crypto";

/**
 * GET /api/webapp/events/stream — SSE for USER-side realtime (messenger).
 *
 * Query params:
 *   chats=id1,id2,...  — subscribe to typing/read-receipt events for specific chats
 *
 * Events delivered:
 *   message.created, message.edited, message.deleted (participant channel)
 *   typing, read (chat channel)
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const connId = randomUUID();

  // Parse chat IDs for chat-level events (typing, read receipts).
  const chatIds = (request.nextUrl.searchParams.get("chats") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return createSseResponse({
    signal: request.signal,
    connectionKey: `user:${userId}`,
    async onStart(sse) {
      await markOnline(userId, connId);

      // Subscribe to user's personal channel (new messages across all chats).
      sse.addCleanup(subscribeUserEvents(userId, (event) => sse.sendEvent(event)));

      // Subscribe to chat-level events for specified chats.
      for (const chatId of chatIds) {
        sse.addCleanup(subscribeChatEvents(chatId, (event) => sse.sendEvent(event)));
      }
    },
    onKeepalive: () => refreshHeartbeat(userId),
    onClose: () => markOffline(userId, connId),
  });
}

export const dynamic = "force-dynamic";
