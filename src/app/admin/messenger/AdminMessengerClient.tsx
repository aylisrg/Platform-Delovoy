"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChatList } from "@/components/messenger/ChatList";
import { ChatWindow } from "@/components/messenger/ChatWindow";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { ParticipantsDrawer } from "@/components/messenger/ParticipantsDrawer";
import { useChatList } from "@/components/messenger/useChatList";
import { useChatStream, type StreamEvent } from "@/components/messenger/useChatStream";

type ListFilter = "ALL" | "UNREAD" | "SUPPORT" | "DIRECT" | "GROUP";

type Props = {
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  initialChatId?: string;
};

function EmptyChatIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-16 h-16 mx-auto mb-4 opacity-20"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
      />
    </svg>
  );
}

export default function AdminMessengerClient({
  currentUserId,
  currentUserName,
  isAdmin,
  initialChatId,
}: Props): ReactNode {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatId ?? null);
  const [search, setSearch] = useState<string>("");
  const [filter, setFilter] = useState<ListFilter>("ALL");
  const [newChatOpen, setNewChatOpen] = useState<boolean>(false);
  const [participantsOpen, setParticipantsOpen] = useState<boolean>(false);

  const { chats, loading, hasMore, loadMore, refresh, addOrUpdateChat } = useChatList({
    search,
    filter,
  });

  const handleStreamEvent = useCallback(
    (event: StreamEvent): void => {
      if (event.type !== "message.created") return;
      const existing = chats.find((c) => c.id === event.chatId);
      if (!existing) {
        // Unknown chat — trigger a refresh so the list catches up with server state.
        refresh();
        return;
      }
      addOrUpdateChat({
        ...existing,
        lastMessageAt: event.message.createdAt,
        lastMessagePreview: event.message.body,
        unreadCount:
          event.chatId === selectedChatId || event.message.senderUserId === currentUserId
            ? existing.unreadCount
            : existing.unreadCount + 1,
      });
    },
    [chats, addOrUpdateChat, refresh, selectedChatId, currentUserId],
  );

  useChatStream({
    chatIds: chats.map((c) => c.id),
    isAdmin,
    onEvent: handleStreamEvent,
  });

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K — focus search
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("[data-messenger-search]");
        el?.focus();
        return;
      }

      // Escape — close dialogs/drawer
      if (e.key === "Escape") {
        if (newChatOpen) {
          setNewChatOpen(false);
          return;
        }
        if (participantsOpen) {
          setParticipantsOpen(false);
          return;
        }
        return;
      }

      // Cmd/Ctrl+ArrowUp/Down — navigate chats
      if (isMod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (chats.length === 0) return;
        e.preventDefault();
        const currentIdx = selectedChatId
          ? chats.findIndex((c) => c.id === selectedChatId)
          : -1;
        let nextIdx: number;
        if (e.key === "ArrowDown") {
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, chats.length - 1);
        } else {
          nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
        }
        const next = chats[nextIdx];
        if (next) setSelectedChatId(next.id);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chats, selectedChatId, newChatOpen, participantsOpen]);

  const selectedChat = selectedChatId
    ? chats.find((c) => c.id === selectedChatId) ?? null
    : null;

  return (
    <div className="flex h-full">
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-white">
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={(id) => setSelectedChatId(id)}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          currentUserId={currentUserId}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          onNewChat={() => setNewChatOpen(true)}
        />
      </div>

      <div className="flex-1 flex flex-col">
        {selectedChatId ? (
          <ChatWindow
            chatId={selectedChatId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            isAdmin={isAdmin}
            onOpenParticipants={() => setParticipantsOpen(true)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <EmptyChatIcon />
              <p className="text-lg">Выберите чат</p>
            </div>
          </div>
        )}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onChatCreated={(chatId) => {
          setNewChatOpen(false);
          setSelectedChatId(chatId);
          refresh();
        }}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
      />

      {selectedChatId && (
        <ParticipantsDrawer
          open={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
          chatId={selectedChatId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          chatKind={selectedChat?.kind ?? "SUPPORT"}
        />
      )}
    </div>
  );
}
