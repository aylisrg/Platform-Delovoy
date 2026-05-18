"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  chatId: string;
  currentUserId: string;
  isAdmin: boolean;
  chatKind: "SUPPORT" | "DIRECT" | "GROUP" | "TOPIC_BOOKINGS" | "TOPIC_CONTRACTS";
};

type Participant = {
  userId: string;
  name: string | null;
  image: string | null;
  role: "MEMBER" | "ADMIN" | "OWNER";
  leftAt: string | null;
};

type SearchUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
};

type ParticipantsResponse =
  | { success: true; data: { participants: Participant[] } }
  | { success: false; error: { code: string; message: string } };

type UserSearchResponse =
  | { success: true; data: { users: SearchUser[] } }
  | { success: false; error: { code: string; message: string } };

const SEARCH_DEBOUNCE_MS = 300;
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
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hashColor(s: string): string {
  return HASH_COLORS[hashString(s) % HASH_COLORS.length]!;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function Avatar({ id, name, image }: { id: string; name: string | null; image: string | null }): ReactNode {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white ${hashColor(id)}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  );
}

export function ParticipantsDrawer(props: Props): ReactNode {
  const { open, onClose, chatId, currentUserId, isAdmin, chatKind } = props;

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [adding, setAdding] = useState<boolean>(false);

  const canManage = isAdmin && chatKind === "GROUP";

  const loadParticipants = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/messenger/chats/${chatId}/participants`, {
        credentials: "include",
      });
      const json = (await res.json()) as ParticipantsResponse;
      if (json.success) {
        setParticipants(json.data.participants);
      } else {
        setError(json.error.message);
      }
    } catch {
      setError("Не удалось загрузить участников");
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (!open) return;
    setSearchQuery("");
    setSearchResults([]);
    void loadParticipants();
  }, [open, loadParticipants]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Search users for add
  useEffect(() => {
    if (!open || !canManage) return;
    if (debouncedSearch.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const ctrl = new AbortController();
    fetch(
      `/api/messenger/users/search?q=${encodeURIComponent(debouncedSearch)}&limit=10`,
      { credentials: "include", signal: ctrl.signal },
    )
      .then((r) => r.json() as Promise<UserSearchResponse>)
      .then((json) => {
        if (json.success) {
          const presentIds = new Set(
            participants.filter((p) => !p.leftAt).map((p) => p.userId),
          );
          setSearchResults(
            json.data.users.filter((u) => !presentIds.has(u.id)),
          );
        }
      })
      .catch(() => {
        // ignore
      });
    return () => ctrl.abort();
  }, [debouncedSearch, open, canManage, participants]);

  const removeParticipant = useCallback(
    async (userId: string): Promise<void> => {
      try {
        const res = await fetch(
          `/api/messenger/chats/${chatId}/participants/${userId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) await loadParticipants();
      } catch {
        // ignore
      }
    },
    [chatId, loadParticipants],
  );

  const addParticipant = useCallback(
    async (userId: string): Promise<void> => {
      setAdding(true);
      try {
        const res = await fetch(`/api/messenger/chats/${chatId}/participants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          setSearchQuery("");
          setSearchResults([]);
          await loadParticipants();
        }
      } finally {
        setAdding(false);
      }
    },
    [chatId, loadParticipants],
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed right-0 top-0 z-50 h-full w-80 transform border-l border-border bg-background shadow-xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Участники"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Участники</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              </div>
            ) : error ? (
              <div className="px-4 py-4 text-sm text-red-600">{error}</div>
            ) : participants.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Нет участников
              </div>
            ) : (
              <ul className="flex flex-col">
                {participants.map((p) => {
                  const canRemove =
                    canManage && p.leftAt === null && p.userId !== currentUserId;
                  return (
                    <li
                      key={p.userId}
                      className="flex items-center gap-3 border-b border-border/50 px-4 py-3"
                    >
                      <Avatar id={p.userId} name={p.name} image={p.image} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {p.name ?? "Без имени"}
                          </span>
                          {p.role === "ADMIN" || p.role === "OWNER" ? (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                              Админ
                            </span>
                          ) : null}
                        </div>
                        {p.leftAt && (
                          <div className="text-xs text-muted-foreground">Покинул</div>
                        )}
                      </div>
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => void removeParticipant(p.userId)}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-500/10"
                        >
                          Удалить
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {canManage && (
            <div className="border-t border-border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Добавить участника
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск пользователей"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchResults.length > 0 && (
                <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
                  {searchResults.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={adding}
                        onClick={() => void addParticipant(u.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <Avatar id={u.id} name={u.name} image={u.image} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {u.name ?? "Без имени"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {u.email ?? u.phone ?? ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
