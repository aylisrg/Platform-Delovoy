import type { NotificationEvent } from "./types";
import { EVENT_ROUTING } from "./events";
import { broadcastAdminEvent } from "@/lib/admin-events";
import { renderBrowserNotification } from "./browser-templates";

/**
 * Fire-and-forget notification dispatch.
 * Does not block the caller — notifications are processed asynchronously.
 * Also broadcasts to admin SSE connections for browser notifications.
 */
export function enqueueNotification(event: NotificationEvent): void {
  // Broadcast to admin SSE connections (sync, in-memory)
  const routing = EVENT_ROUTING[event.type];
  if (routing?.admin) {
    const browser = renderBrowserNotification(
      event.moduleSlug,
      event.type,
      event.data
    );
    if (browser) {
      broadcastAdminEvent({
        id: `${event.entityId}-${Date.now()}`,
        type: event.type,
        moduleSlug: event.moduleSlug,
        entityId: event.entityId,
        title: browser.title,
        body: browser.body,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Use microtask to avoid blocking the API response
  Promise.resolve()
    .then(async () => {
      const { notify } = await import("./service");
      await notify(event);
    })
    .catch((err) => {
      console.error("[Notifications] Dispatch failed:", err);
    });
}
