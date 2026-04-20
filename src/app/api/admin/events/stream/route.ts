import { auth } from "@/lib/auth";
import { subscribeAdminEvents } from "@/lib/admin-events";
import { getUserAdminSections } from "@/lib/permissions";

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

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial keepalive
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Subscribe to admin events
      const unsubscribe = subscribeAdminEvents((event) => {
        // Filter events by manager's allowed sections
        if (role !== "SUPERADMIN" && !sections.includes(event.moduleSlug)) {
          return;
        }

        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      });

      // Keepalive every 30s to prevent connection timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
      };

      controller.enqueue(encoder.encode("retry: 5000\n\n"));
    },
    cancel() {
      cleanup?.();
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
