"use client";

import { useEffect, useRef } from "react";

export type ChatMessageEvent = {
  id: string;
  chatId: string;
  senderUserId: string;
  senderName: string | null;
  body: string;
  clientId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type StreamEvent =
  | { type: "message.created"; chatId: string; message: ChatMessageEvent }
  | { type: "message.edited"; chatId: string; message: ChatMessageEvent }
  | { type: "message.deleted"; chatId: string; messageId: string }
  | { type: "typing"; chatId: string; userId: string; userName: string | null }
  | { type: "read"; chatId: string; userId: string; upToMessageId: string }
  | { type: "ping" };

type Options = {
  chatIds: string[];
  isAdmin?: boolean;
  onEvent: (event: StreamEvent) => void;
};

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useChatStream(options: Options): void {
  const { chatIds, isAdmin, onEvent } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const chatIdsKey = chatIds.join(",");

  useEffect(() => {
    if (typeof window === "undefined") return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    let closed = false;

    const buildUrl = (): string => {
      if (isAdmin) return "/api/admin/events/stream";
      return `/api/webapp/events/stream?chats=${encodeURIComponent(chatIdsKey)}`;
    };

    const scheduleReconnect = (): void => {
      if (closed) return;
      if (reconnectTimer !== null) return;
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = (): void => {
      if (closed) return;
      if (document.visibilityState !== "visible") return;
      if (!isAdmin && chatIdsKey.length === 0) return;

      try {
        es = new EventSource(buildUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      es.onmessage = (ev: MessageEvent<string>) => {
        backoff = INITIAL_BACKOFF_MS;
        try {
          const parsed = JSON.parse(ev.data) as StreamEvent;
          onEventRef.current(parsed);
        } catch {
          // ignore malformed payload
        }
      };

      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        scheduleReconnect();
      };
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible" && es === null) {
        backoff = INITIAL_BACKOFF_MS;
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [chatIdsKey, isAdmin]);
}
