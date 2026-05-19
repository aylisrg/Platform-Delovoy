"use client";

import { type ReactNode } from "react";
import type { ChatPreview } from "@/components/messenger/useChatList";

type ListFilter = "ALL" | "UNREAD" | "SUPPORT" | "DIRECT" | "GROUP";

type Props = {
  chats: ChatPreview[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  search: string;
  onSearch: (q: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  onNewChat: () => void;
};

const FILTER_OPTIONS: Array<{ value: ListFilter; label: string }> = [
  { value: "ALL", label: "Все" },
  { value: "UNREAD", label: "Непрочитанные" },
  { value: "SUPPORT", label: "Поддержка" },
  { value: "DIRECT", label: "Личные" },
  { value: "GROUP", label: "Группы" },
];

const HASH_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-red-500",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function hashColor(str: string): string {
  return HASH_COLORS[hashString(str) % HASH_COLORS.length]!;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function getChatDisplayName(chat: ChatPreview, currentUserId: string): string {
  switch (chat.kind) {
    case "SUPPORT":
      return "Поддержка";
    case "TOPIC_BOOKINGS":
      return "Бронирования";
    case "TOPIC_CONTRACTS":
      return "Договоры";
    case "GROUP":
      return chat.title ?? "Группа";
    case "DIRECT": {
      const other = chat.participants.find((p) => p.userId !== currentUserId);
      return other?.name ?? chat.title ?? "Личный чат";
    }
    default:
      return chat.title ?? "Чат";
  }
}

function getOtherParticipantImage(chat: ChatPreview, currentUserId: string): string | null {
  if (chat.kind !== "DIRECT") return null;
  const other = chat.participants.find((p) => p.userId !== currentUserId);
  return other?.image ?? null;
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffMs = now - t;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin}м`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}ч`;

  const date = new Date(t);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, yesterday)) return "вчера";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

function ShieldIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-white"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function PencilIcon(): ReactNode {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function SearchIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-muted-foreground"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function Avatar({ chat, currentUserId }: { chat: ChatPreview; currentUserId: string }): ReactNode {
  if (chat.kind === "SUPPORT") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600">
        <ShieldIcon />
      </div>
    );
  }

  const image = getOtherParticipantImage(chat, currentUserId);
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }

  const name = getChatDisplayName(chat, currentUserId);
  const colorSeed = chat.id;
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white ${hashColor(colorSeed)}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  );
}

function Spinner(): ReactNode {
  return (
    <div className="flex justify-center py-6" role="status" aria-label="Загрузка">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

export function ChatList(props: Props): ReactNode {
  const {
    chats,
    selectedChatId,
    onSelectChat,
    loading,
    hasMore,
    onLoadMore,
    currentUserId,
    search,
    onSearch,
    filter,
    onFilter,
    onNewChat,
  } = props;

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">Чаты</h2>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Новый чат"
        >
          <PencilIcon />
        </button>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Поиск"
            className="w-full rounded-lg border border-border bg-muted/40 py-2 pl-9 pr-3 text-sm focus:border-primary focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 py-3">
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFilter(opt.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && chats.length === 0 ? (
          <Spinner />
        ) : chats.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Чатов пока нет
          </div>
        ) : (
          <ul className="flex flex-col">
            {chats.map((chat) => {
              const active = chat.id === selectedChatId;
              const name = getChatDisplayName(chat, currentUserId);
              const time = chat.lastMessageAt ? formatRelativeTime(chat.lastMessageAt) : "";
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                      active ? "bg-accent" : "hover:bg-muted/60"
                    }`}
                  >
                    <Avatar chat={chat} currentUserId={currentUserId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {name}
                        </span>
                        {time && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {time}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-muted-foreground">
                          {chat.lastMessagePreview ?? "Нет сообщений"}
                        </span>
                        {chat.unreadCount > 0 && (
                          <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">
                            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && !loading && (
          <div className="p-3">
            <button
              type="button"
              onClick={onLoadMore}
              className="w-full rounded-lg border border-border bg-background py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Загрузить ещё
            </button>
          </div>
        )}

        {loading && chats.length > 0 && <Spinner />}
      </div>
    </div>
  );
}
