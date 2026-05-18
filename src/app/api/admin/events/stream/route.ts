import { auth } from "@/lib/auth";
import { subscribeAdminEvents } from "@/lib/admin-events";
import { getUserAdminSections } from "@/lib/permissions";
import { markAdminOnline, markAdminOffline, refreshHeartbeat } from "@/lib/realtime/presence";
import { randomUUID } from "crypto";

/**
 * GET /api/admin/events/stream — SSE endpoint for real-time admin notifications.
 *
 * Only SUPERADMIN and MANAGER users can connect. Events are filtered
 * by the user's admin section permissions (e.g., a gazebos manager
 * only receives gazebos events).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { role } = session.user;
  if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
    return new Response("Forbidden", { status: 403 });
  }

  const sections = await getUserAdminSections(session.user.id);
  const connId = randomUUID();

  const encoder = new TextEncoder();
  const cleanups: Array<() => void> = [];

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      controller.enqueue(encoder.encode("retry: 5000\n\n"));

      await markAdminOnline(session.user.id, connId);

      // Subscribe to admin events
      const unsubscribe = subscribeAdminEvents((event) => {
        // Filter events by manager's allowed sections
        if (role !== "SUPERADMIN" && !sections.includes(event.moduleSlug)) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream closed */ }
      });
      cleanups.push(unsubscribe);

      // Keepalive every 30s to prevent connection timeout + refresh presence
      const keepalive = setInterval(async () => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
          await refreshHeartbeat(session.user.id);
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);
      cleanups.push(() => clearInterval(keepalive));
    },
    async cancel() {
      for (const fn of cleanups) fn();
      await markAdminOffline(session.user.id);
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

// Force dynamic rendering (SSE cannot be static)
export const dynamic = "force-dynamic";
