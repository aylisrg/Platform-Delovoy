"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageBubble } from "@/components/messenger/MessageBubble";
import { MessageComposer } from "@/components/messenger/MessageComposer";
import { TypingIndicator } from "@/components/messenger/TypingIndicator";
import { useChatStream, type StreamEvent } from "@/components/messenger/useChatStream";

type ChatMessageEvent = {
  id: string;
  body: string;
  senderUserId: string;
  senderName: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
};

type Props = {
  chatId: string;
  currentUserId: string;
  currentUserName: string | null;
  isAdmin?: boolean;
  onBack?: () => void;
  onOpenParticipants?: () => void;
};

type TypingUser = { userId: string; userName: string | null; expiresAt: number };

type MessagesApiResponse =
  | {
      success: true;
      data: { messages: ChatMessageEvent[]; nextCursor: string | null };
    }
  | { success: false; error: { code: string; message: string } };

type ChatApiResponse =
  | {
      success: true;
      data: {
        id: string;
        kind: "SUPPORT" | "DIRECT" | "GROUP" | "TOPIC_BOOKINGS" | "TOPIC_CONTRACTS";
        title: string | null;
        participants: Array<{ userId: string; name: string | null }>;
      };
    }
  | { success: false; error: { code: string; message: string } };

const PAGE_SIZE = 50;
const TYPING_TTL_MS = 5000;
const NEAR_BOTTOM_PX = 100;
const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Сегодня";
  if (sameDay(d, yesterday)) return "Вчера";
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

function DateDivider({ iso }: { iso: string }): ReactNode {
  return (
    <div className="my-2 flex items-center justify-center">
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {formatDateDivider(iso)}
      </span>
    </div>
  );
}

function BackIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function GroupIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function ChatWindow(props: Props): ReactNode {
  const { chatId, currentUserId, currentUserName, isAdmin, onBack, onOpenParticipants } = props;

  const [messages, setMessages] = useState<ChatMessageEvent[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [editingMessage, setEditingMessage] = useState<{ id: string; body: string } | null>(null);
  const [readUpTo, setReadUpTo] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState<string>("Чат");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef<boolean>(true);
  const loadingOlderRef = useRef<boolean>(false);
  const prevScrollHeightRef = useRef<number>(0);

  const markRead = useCallback(
    async (lastMessageId: string): Promise<void> => {
      try {
        await fetch(`/api/messenger/chats/${chatId}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ upToMessageId: lastMessageId }),
        });
      } catch {
        // ignore read errors
      }
    },
    [chatId],
  );

  // Initial load of chat metadata + messages
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    setEditingMessage(null);
    setTypingUsers([]);

    const loadChatInfo = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/messenger/chats/${chatId}`, {
          credentials: "include",
        });
        const json = (await res.json()) as ChatApiResponse;
        if (!cancelled && json.success) {
          const c = json.data;
          let title: string;
          if (c.kind === "SUPPORT") title = "Поддержка";
          else if (c.kind === "TOPIC_BOOKINGS") title = "Бронирования";
          else if (c.kind === "TOPIC_CONTRACTS") title = "Договоры";
          else if (c.kind === "DIRECT") {
            const other = c.participants.find((p) => p.userId !== currentUserId);
            title = other?.name ?? c.title ?? "Личный чат";
          } else {
            title = c.title ?? "Группа";
          }
          setChatTitle(title);
        }
      } catch {
        // keep default title
      }
    };

    const loadMessages = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/messenger/chats/${chatId}/messages?limit=${PAGE_SIZE}`,
          { credentials: "include" },
        );
        const json = (await res.json()) as MessagesApiResponse;
        if (cancelled) return;
        if (json.success) {
          setMessages(json.data.messages);
          setCursor(json.data.nextCursor);
          setHasMore(json.data.nextCursor !== null);
          if (json.data.messages.length > 0) {
            const last = json.data.messages[json.data.messages.length - 1]!;
            setReadUpTo(last.id);
            void markRead(last.id);
          }
        }
        setLoading(false);
        wasNearBottomRef.current = true;
        requestAnimationFrame(() => {
          if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ block: "end" });
          }
        });
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    void loadChatInfo();
    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [chatId, currentUserId, markRead]);

  // Load older messages
  const loadOlder = useCallback(async (): Promise<void> => {
    if (loadingOlderRef.current || !hasMore || cursor === null) return;
    loadingOlderRef.current = true;
    const container = scrollRef.current;
    prevScrollHeightRef.current = container ? container.scrollHeight : 0;
    try {
      const res = await fetch(
        `/api/messenger/chats/${chatId}/messages?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { credentials: "include" },
      );
      const json = (await res.json()) as MessagesApiResponse;
      if (json.success) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const older = json.data.messages.filter((m) => !ids.has(m.id));
          return [...older, ...prev];
        });
        setCursor(json.data.nextCursor);
        setHasMore(json.data.nextCursor !== null);
        requestAnimationFrame(() => {
          if (container) {
            const diff = container.scrollHeight - prevScrollHeightRef.current;
            container.scrollTop = container.scrollTop + diff;
          }
          loadingOlderRef.current = false;
        });
      } else {
        loadingOlderRef.current = false;
      }
    } catch {
      loadingOlderRef.current = false;
    }
  }, [chatId, cursor, hasMore]);

  // IntersectionObserver on top sentinel for infinite scroll up
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadOlder();
          }
        }
      },
      { root, rootMargin: "100px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlder]);

  // Track scroll position to know if user is near bottom
  const handleScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  // Prune expired typing users
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => prev.filter((u) => u.expiresAt > now));
    }, 1000);
    return () => clearInterval(timer);
  }, [typingUsers.length]);

  // SSE event handler
  const handleEvent = useCallback(
    (event: StreamEvent): void => {
      if (event.type === "ping") return;
      if ("chatId" in event && event.chatId !== chatId) return;

      if (event.type === "message.created") {
        const incoming = event.message;
        setMessages((prev) => {
          // Dedup by id or clientId
          const idx = prev.findIndex(
            (m) =>
              m.id === incoming.id ||
              (incoming.clientId !== null && m.clientId === incoming.clientId),
          );
          if (idx === -1) return [...prev, incoming];
          return prev.map((m, i) => (i === idx ? incoming : m));
        });
        setTypingUsers((prev) => prev.filter((u) => u.userId !== incoming.senderUserId));
        setReadUpTo(incoming.id);
        void markRead(incoming.id);
        return;
      }

      if (event.type === "message.edited") {
        const updated = event.message;
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        return;
      }

      if (event.type === "message.deleted") {
        const id = event.messageId;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, deletedAt: new Date().toISOString() } : m,
          ),
        );
        return;
      }

      if (event.type === "typing") {
        if (event.userId === currentUserId) return;
        const expiresAt = Date.now() + TYPING_TTL_MS;
        setTypingUsers((prev) => {
          const idx = prev.findIndex((u) => u.userId === event.userId);
          const next: TypingUser = {
            userId: event.userId,
            userName: event.userName,
            expiresAt,
          };
          if (idx === -1) return [...prev, next];
          return prev.map((u, i) => (i === idx ? next : u));
        });
        return;
      }

      if (event.type === "read") {
        if (event.userId !== currentUserId) {
          setReadUpTo(event.upToMessageId);
        }
        return;
      }
    },
    [chatId, currentUserId, markRead],
  );

  useChatStream({ chatIds: [chatId], isAdmin, onEvent: handleEvent });

  const handleMessageSent = useCallback(
    (msg: ChatMessageEvent): void => {
      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) =>
            m.id === msg.id ||
            (msg.clientId !== null && m.clientId === msg.clientId),
        );
        if (idx === -1) return [...prev, msg];
        return prev.map((m, i) => (i === idx ? msg : m));
      });
      wasNearBottomRef.current = true;
    },
    [],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      try {
        const res = await fetch(
          `/api/messenger/chats/${chatId}/messages/${messageId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m,
            ),
          );
        }
      } catch {
        // ignore
      }
    },
    [chatId],
  );

  const groupedRendering = useMemo(() => {
    const items: ReactNode[] = [];
    let lastDayKey: string | null = null;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const dk = dayKey(msg.createdAt);
      if (dk !== lastDayKey) {
        items.push(<DateDivider key={`d-${dk}-${msg.id}`} iso={msg.createdAt} />);
        lastDayKey = dk;
      }
      const isMine = msg.senderUserId === currentUserId;
      const prev = i > 0 ? messages[i - 1]! : null;
      const showAvatar = !isMine && (prev === null || prev.senderUserId !== msg.senderUserId);
      const readByAll = readUpTo !== null && msg.id <= readUpTo;
      items.push(
        <MessageBubble
          key={msg.id}
          message={msg}
          isMine={isMine}
          showAvatar={showAvatar}
          readByAll={readByAll}
          deliveredToAll
          onEdit={
            isMine
              ? () => setEditingMessage({ id: msg.id, body: msg.body })
              : undefined
          }
          onDelete={isMine ? () => void handleDeleteMessage(msg.id) : undefined}
        />,
      );
    }
    return items;
  }, [messages, currentUserId, readUpTo, handleDeleteMessage]);

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            aria-label="Назад"
          >
            <BackIcon />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{chatTitle}</div>
          {currentUserName && (
            <div className="truncate text-xs text-muted-foreground">
              {currentUserName}
            </div>
          )}
        </div>
        {onOpenParticipants && (
          <button
            type="button"
            onClick={onOpenParticipants}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Участники"
          >
            <GroupIcon />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2"
      >
        <div ref={topSentinelRef} className="h-1" />
        {loading && messages.length === 0 ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : (
          <div className="flex flex-col gap-1">{groupedRendering}</div>
        )}
        <TypingIndicator
          typingUsers={typingUsers.map((u) => ({
            userId: u.userId,
            userName: u.userName,
          }))}
        />
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        chatId={chatId}
        onMessageSent={handleMessageSent}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
      />
    </div>
  );
}
