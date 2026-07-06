import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { subscribeAdminEvents } from "@/lib/admin-events";
import { getUserAdminSections } from "@/lib/permissions";
import { markAdminOnline, markAdminOffline, refreshHeartbeat } from "@/lib/realtime/presence";
import { createSseResponse } from "@/lib/realtime/sse";
import { randomUUID } from "crypto";

/**
 * GET /api/admin/events/stream — SSE endpoint for real-time admin notifications.
 *
 * Only SUPERADMIN and MANAGER users can connect. Events are filtered
 * by the user's admin section permissions (e.g., a gazebos manager
 * only receives gazebos events).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { role } = session.user;
  if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
    return new Response("Forbidden", { status: 403 });
  }

  const userId = session.user.id;
  const sections = await getUserAdminSections(userId);
  const connId = randomUUID();

  return createSseResponse({
    signal: request.signal,
    connectionKey: `admin:${userId}`,
    async onStart(sse) {
      await markAdminOnline(userId, connId);

      sse.addCleanup(
        subscribeAdminEvents((event) => {
          // Filter events by manager's allowed sections
          if (role !== "SUPERADMIN" && !sections.includes(event.moduleSlug)) {
            return;
          }
          sse.sendEvent(event);
        })
      );
    },
    onKeepalive: () => refreshHeartbeat(userId),
    onClose: () => markAdminOffline(userId),
  });
}

// Force dynamic rendering (SSE cannot be static)
export const dynamic = "force-dynamic";
