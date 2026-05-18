/**
 * Admin event broadcaster for SSE connections.
 *
 * Wraps the realtime bus (Redis Pub/Sub when available, in-memory fallback).
 * Public API is unchanged so existing callers are not affected.
 */

import { publish, subscribe } from "@/lib/realtime";

export type AdminBrowserEvent = {
  id: string;
  type: string; // "booking.created", "order.placed", etc.
  moduleSlug: string;
  entityId: string;
  title: string;
  body: string;
  timestamp: string; // ISO string
};

const ADMIN_CHANNEL = "admin:events";

/** Broadcast an event to all connected admin SSE clients. */
export function broadcastAdminEvent(event: AdminBrowserEvent): void {
  publish(ADMIN_CHANNEL, event).catch(() => {});
}

/** Subscribe to admin events. Returns an unsubscribe function. */
export function subscribeAdminEvents(
  listener: (event: AdminBrowserEvent) => void,
): () => void {
  return subscribe(ADMIN_CHANNEL, listener as (event: { type: string; [key: string]: unknown }) => void);
}
