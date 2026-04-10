import type { NotificationEvent } from "./types";

/**
 * Fire-and-forget notification dispatch.
 * Does not block the caller — notifications are processed asynchronously.
 */
export function enqueueNotification(event: NotificationEvent): void {
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
