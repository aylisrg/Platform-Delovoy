/**
 * In-memory admin event broadcaster for SSE connections.
 *
 * Admin/manager users subscribe via SSE. When a notification event fires
 * with admin routing, it's broadcast here so connected browsers receive
 * it in real time.
 */

import { EventEmitter } from "events";

export type AdminBrowserEvent = {
  id: string;
  type: string; // "booking.created", "order.placed", etc.
  moduleSlug: string;
  entityId: string;
  title: string;
  body: string;
  timestamp: string; // ISO string
};

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // Support many concurrent admin sessions

/**
 * Broadcast an event to all connected admin SSE clients.
 */
export function broadcastAdminEvent(event: AdminBrowserEvent): void {
  emitter.emit("admin-event", event);
}

/**
 * Subscribe to admin events. Returns an unsubscribe function.
 */
export function subscribeAdminEvents(
  listener: (event: AdminBrowserEvent) => void
): () => void {
  emitter.on("admin-event", listener);
  return () => {
    emitter.off("admin-event", listener);
  };
}
