/**
 * User event broadcaster for SSE connections.
 * Wraps realtime bus — each user subscribes to their own channel.
 */

import { publish, subscribe, type RealtimeEvent } from "@/lib/realtime";

export type UserBrowserEvent = RealtimeEvent & {
  chatId?: string;
  messageId?: string;
};

/** Broadcast an event to a specific user's SSE stream. */
export function broadcastToParticipant(userId: string, event: UserBrowserEvent): void {
  publish(`participant:${userId}`, event).catch(() => {});
}

/** Broadcast an event to all subscribers of a specific chat (typing, read receipts). */
export function broadcastToChat(chatId: string, event: UserBrowserEvent): void {
  publish(`chat:${chatId}`, event).catch(() => {});
}

/** Subscribe to events for a user. Returns an unsubscribe function. */
export function subscribeUserEvents(
  userId: string,
  listener: (event: UserBrowserEvent) => void,
): () => void {
  return subscribe(`participant:${userId}`, listener as (event: { type: string; [key: string]: unknown }) => void);
}

/** Subscribe to chat-level events (typing, read receipts). */
export function subscribeChatEvents(
  chatId: string,
  listener: (event: UserBrowserEvent) => void,
): () => void {
  return subscribe(`chat:${chatId}`, listener as (event: { type: string; [key: string]: unknown }) => void);
}
