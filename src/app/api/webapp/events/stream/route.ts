import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { subscribeUserEvents, subscribeChatEvents } from "@/lib/user-events";
import { markOnline, markOffline, refreshHeartbeat } from "@/lib/realtime/presence";
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

  const encoder = new TextEncoder();
  const cleanups: Array<() => void> = [];

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      controller.enqueue(encoder.encode("retry: 5000\n\n"));

      await markOnline(userId, connId);

      // Subscribe to user's personal channel (new messages across all chats).
      const unsub = subscribeUserEvents(userId, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream closed */ }
      });
      cleanups.push(unsub);

      // Subscribe to chat-level events for specified chats.
      for (const chatId of chatIds) {
        const unsubChat = subscribeChatEvents(chatId, (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch { /* stream closed */ }
        });
        cleanups.push(unsubChat);
      }

      // Keepalive every 30 s — also refreshes presence heartbeat.
      const keepalive = setInterval(async () => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
          await refreshHeartbeat(userId);
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      cleanups.push(() => clearInterval(keepalive));
    },
    async cancel() {
      for (const fn of cleanups) fn();
      await markOffline(userId, connId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const dynamic = "force-dynamic";
