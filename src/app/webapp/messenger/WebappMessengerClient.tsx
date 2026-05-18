"use client";

/**
 * Webapp messenger — mobile-first fullscreen, two-column on md+.
 *
 * Контракт (см. PRD «webapp messenger pages»):
 *  - на мобиле виден ИЛИ список чатов, ИЛИ окно чата (переключается `view`)
 *  - на md+ обе колонки одновременно
 *  - кнопка «Назад» в чате на мобиле возвращает к списку
 *  - при mount/online/SW-нотификации `chat-sync-flush` — отправляем outbox
 *  - SSE `message.created` — пробрасываем в `chatList.addOrUpdateChat`
 */

import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatList } from "@/components/messenger/ChatList";
import { ChatWindow } from "@/components/messenger/ChatWindow";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { ParticipantsDrawer } from "@/components/messenger/ParticipantsDrawer";
import {
  useChatList,
  type ChatPreview,
} from "@/components/messenger/useChatList";
import {
  useChatStream,
  type StreamEvent,
} from "@/components/messenger/useChatStream";

type ListFilter = "ALL" | "UNREAD" | "SUPPORT" | "DIRECT" | "GROUP";

type Props = {
  currentUserId: string;
  currentUserName: string | null;
  initialChatId?: string;
};

export default function WebappMessengerClient({
  currentUserId,
  currentUserName,
  initialChatId,
}: Props): React.JSX.Element {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    initialChatId ?? null,
  );
  const [view, setView] = useState<"list" | "chat">(
    initialChatId ? "chat" : "list",
  );
  const [search, setSearch] = useState<string>("");
  const [filter, setFilter] = useState<ListFilter>("ALL");
  const [newChatOpen, setNewChatOpen] = useState<boolean>(false);
  const [participantsOpen, setParticipantsOpen] = useState<boolean>(false);

  const chatList = useChatList({ search, filter });

  // Подписка на SSE по всем чатам пользователя.
  const chatIds = useMemo(
    () => chatList.chats.map((c) => c.id),
    [chatList.chats],
  );

  const handleStreamEvent = useCallback(
    (event: StreamEvent): void => {
      if (event.type !== "message.created") return;
      const chat = chatList.chats.find((c) => c.id === event.chatId);
      if (!chat) {
        // Новый чат — перезагрузим список.
        chatList.refresh();
        return;
      }
      const updated: ChatPreview = {
        ...chat,
        lastMessageAt: event.message.createdAt,
        lastMessagePreview: event.message.body,
        unreadCount:
          event.chatId === selectedChatId ||
          event.message.senderUserId === currentUserId
            ? chat.unreadCount
            : chat.unreadCount + 1,
      };
      chatList.addOrUpdateChat(updated);
    },
    [chatList, currentUserId, selectedChatId],
  );

  useChatStream({
    chatIds,
    isAdmin: false,
    onEvent: handleStreamEvent,
  });

  // Outbox flush — на mount, при возврате online и по SW-нотификации.
  useEffect(() => {
    let cancelled = false;
    const flush = (): void => {
      void import("@/lib/webapp/chat-outbox")
        .then((m) => {
          if (!cancelled) return m.flushOutbox();
        })
        .catch(() => {
          // ignore — IDB может быть недоступен (private mode и т.п.)
        });
    };

    flush();

    const onOnline = (): void => flush();
    window.addEventListener("online", onOnline);

    const onSwMessage = (ev: MessageEvent): void => {
      const data = ev.data as { type?: string } | null;
      if (data && data.type === "chat-sync-flush") flush();
    };
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.addEventListener("message", onSwMessage);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      sw?.removeEventListener("message", onSwMessage);
    };
  }, []);

  // Escape: закрываем диалоги, иначе — назад к списку (на мобиле).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (newChatOpen) {
        setNewChatOpen(false);
        return;
      }
      if (participantsOpen) {
        setParticipantsOpen(false);
        return;
      }
      if (view === "chat") setView("list");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChatOpen, participantsOpen, view]);

  const selectedChatKind = useMemo(() => {
    if (!selectedChatId) return "SUPPORT" as const;
    return (
      chatList.chats.find((c) => c.id === selectedChatId)?.kind ?? "SUPPORT"
    );
  }, [chatList.chats, selectedChatId]);

  return (
    <div className="flex h-[calc(100vh-72px)] overflow-hidden">
      {/* Sidebar */}
      <div
        className={`w-full md:w-80 flex-shrink-0 md:border-r border-border flex-col bg-white ${
          view === "chat" ? "hidden md:flex" : "flex"
        }`}
      >
        <ChatList
          chats={chatList.chats}
          selectedChatId={selectedChatId}
          onSelectChat={(id) => {
            setSelectedChatId(id);
            setView("chat");
          }}
          loading={chatList.loading}
          hasMore={chatList.hasMore}
          onLoadMore={chatList.loadMore}
          currentUserId={currentUserId}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          onNewChat={() => setNewChatOpen(true)}
        />
      </div>

      {/* Chat window */}
      <div
        className={`flex-1 flex-col ${
          view === "list" ? "hidden md:flex" : "flex"
        }`}
      >
        {selectedChatId ? (
          <ChatWindow
            chatId={selectedChatId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            isAdmin={false}
            onBack={() => setView("list")}
            onOpenParticipants={() => setParticipantsOpen(true)}
          />
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <p>Выберите чат</p>
          </div>
        )}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onChatCreated={(chatId) => {
          setNewChatOpen(false);
          setSelectedChatId(chatId);
          setView("chat");
          chatList.refresh();
        }}
        isAdmin={false}
        currentUserId={currentUserId}
      />

      {selectedChatId ? (
        <ParticipantsDrawer
          open={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
          chatId={selectedChatId}
          currentUserId={currentUserId}
          isAdmin={false}
          chatKind={selectedChatKind}
        />
      ) : null}
    </div>
  );
}
