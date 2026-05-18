"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onChatCreated: (chatId: string) => void;
  isAdmin: boolean;
  currentUserId: string;
};

type Tab = "SUPPORT" | "DIRECT" | "GROUP";

type SearchUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  eligible?: boolean;
};

type UserSearchResponse =
  | { success: true; data: { users: SearchUser[] } }
  | { success: false; error: { code: string; message: string } };

type EligibilityResponse =
  | { success: true; data: { eligible: boolean; reason?: string } }
  | { success: false; error: { code: string; message: string } };

type CreateChatResponse =
  | { success: true; data: { id: string } }
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

function UserAvatar({ user }: { user: SearchUser }): ReactNode {
  if (user.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white ${hashColor(user.id)}`}
      aria-hidden="true"
    >
      {getInitials(user.name)}
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function NewChatDialog(props: Props): ReactNode {
  const { open, onClose, onChatCreated, isAdmin, currentUserId } = props;
  const [tab, setTab] = useState<Tab>("SUPPORT");
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Direct tab state
  const [directQuery, setDirectQuery] = useState<string>("");
  const debouncedDirect = useDebouncedValue(directQuery, SEARCH_DEBOUNCE_MS);
  const [directResults, setDirectResults] = useState<SearchUser[]>([]);
  const [directSearching, setDirectSearching] = useState<boolean>(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [creating, setCreating] = useState<boolean>(false);

  // Group tab state
  const [groupTitle, setGroupTitle] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState<string>("");
  const debouncedGroup = useDebouncedValue(groupQuery, SEARCH_DEBOUNCE_MS);
  const [groupResults, setGroupResults] = useState<SearchUser[]>([]);
  const [groupSelected, setGroupSelected] = useState<SearchUser[]>([]);
  const [groupSearching, setGroupSearching] = useState<boolean>(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (!open) return;
    setTab("SUPPORT");
    setDirectQuery("");
    setDirectResults([]);
    setDirectError(null);
    setGroupTitle("");
    setGroupQuery("");
    setGroupResults([]);
    setGroupSelected([]);
    setGroupError(null);
  }, [open]);

  // Escape key + focus trap
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    requestAnimationFrame(() => {
      if (dialogRef.current) {
        const first = dialogRef.current.querySelector<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        first?.focus();
      }
    });
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Search users for direct tab
  useEffect(() => {
    if (!open || tab !== "DIRECT") return;
    if (debouncedDirect.trim().length === 0) {
      setDirectResults([]);
      return;
    }
    const ctrl = new AbortController();
    setDirectSearching(true);
    fetch(
      `/api/messenger/users/search?q=${encodeURIComponent(debouncedDirect)}&limit=10`,
      { credentials: "include", signal: ctrl.signal },
    )
      .then((r) => r.json() as Promise<UserSearchResponse>)
      .then((json) => {
        if (json.success) {
          setDirectResults(json.data.users.filter((u) => u.id !== currentUserId));
        }
        setDirectSearching(false);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setDirectSearching(false);
      });
    return () => ctrl.abort();
  }, [debouncedDirect, open, tab, currentUserId]);

  // Search users for group tab
  useEffect(() => {
    if (!open || tab !== "GROUP") return;
    if (debouncedGroup.trim().length === 0) {
      setGroupResults([]);
      return;
    }
    const ctrl = new AbortController();
    setGroupSearching(true);
    fetch(
      `/api/messenger/users/search?q=${encodeURIComponent(debouncedGroup)}&limit=10`,
      { credentials: "include", signal: ctrl.signal },
    )
      .then((r) => r.json() as Promise<UserSearchResponse>)
      .then((json) => {
        if (json.success) {
          setGroupResults(json.data.users.filter((u) => u.id !== currentUserId));
        }
        setGroupSearching(false);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setGroupSearching(false);
      });
    return () => ctrl.abort();
  }, [debouncedGroup, open, tab, currentUserId]);

  const createSupportChat = useCallback(async (): Promise<void> => {
    setCreating(true);
    try {
      const res = await fetch("/api/messenger/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind: "SUPPORT" }),
      });
      const json = (await res.json()) as CreateChatResponse;
      if (json.success) onChatCreated(json.data.id);
    } finally {
      setCreating(false);
    }
  }, [onChatCreated]);

  const createDirectChat = useCallback(
    async (user: SearchUser): Promise<void> => {
      setDirectError(null);
      setCreating(true);
      try {
        const eligRes = await fetch("/api/messenger/eligibility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ otherUserId: user.id }),
        });
        const eligJson = (await eligRes.json()) as EligibilityResponse;
        if (!eligJson.success || !eligJson.data.eligible) {
          setDirectError("Нет общей связи с этим пользователем");
          setCreating(false);
          return;
        }
        const res = await fetch("/api/messenger/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ kind: "DIRECT", otherUserId: user.id }),
        });
        const json = (await res.json()) as CreateChatResponse;
        if (json.success) onChatCreated(json.data.id);
        else setDirectError(json.error.message);
      } catch {
        setDirectError("Не удалось создать чат");
      } finally {
        setCreating(false);
      }
    },
    [onChatCreated],
  );

  const createGroupChat = useCallback(async (): Promise<void> => {
    setGroupError(null);
    if (groupTitle.trim().length === 0) {
      setGroupError("Введите название группы");
      return;
    }
    if (groupSelected.length === 0) {
      setGroupError("Выберите хотя бы одного участника");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/messenger/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "GROUP",
          title: groupTitle.trim(),
          participantUserIds: groupSelected.map((u) => u.id),
        }),
      });
      const json = (await res.json()) as CreateChatResponse;
      if (json.success) onChatCreated(json.data.id);
      else setGroupError(json.error.message);
    } catch {
      setGroupError("Не удалось создать чат");
    } finally {
      setCreating(false);
    }
  }, [groupTitle, groupSelected, onChatCreated]);

  const toggleGroupParticipant = (user: SearchUser): void => {
    setGroupSelected((prev) => {
      if (prev.some((u) => u.id === user.id)) {
        return prev.filter((u) => u.id !== user.id);
      }
      return [...prev, user];
    });
  };

  if (!open) return null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "SUPPORT", label: "Поддержка" },
    { id: "DIRECT", label: "Личное" },
  ];
  if (isAdmin) tabs.push({ id: "GROUP", label: "Группа" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chat-dialog-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-chat-dialog-title" className="text-lg font-semibold">
            Новый чат
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "SUPPORT" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Создайте чат с командой поддержки. Мы ответим в течение рабочего дня.
            </p>
            <button
              type="button"
              onClick={() => void createSupportChat()}
              disabled={creating}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Начать чат с поддержкой
            </button>
          </div>
        )}

        {tab === "DIRECT" && (
          <div className="space-y-3">
            <input
              type="search"
              value={directQuery}
              onChange={(e) => setDirectQuery(e.target.value)}
              placeholder="Поиск пользователя"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {directError && (
              <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-600">
                {directError}
              </div>
            )}
            <div className="max-h-72 overflow-y-auto">
              {directSearching && directResults.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Поиск…
                </div>
              ) : directResults.length === 0 && debouncedDirect.length > 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Никого не найдено
                </div>
              ) : (
                <ul className="flex flex-col">
                  {directResults.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => void createDirectChat(user)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted disabled:opacity-50"
                      >
                        <UserAvatar user={user} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {user.name ?? "Без имени"}
                            </span>
                            {user.eligible && (
                              <span className="shrink-0 text-xs text-emerald-600">
                                ✓ Связан
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {user.email ?? user.phone ?? ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "GROUP" && isAdmin && (
          <div className="space-y-3">
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Название группы"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />

            {groupSelected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {groupSelected.map((user) => (
                  <span
                    key={user.id}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    {user.name ?? "Без имени"}
                    <button
                      type="button"
                      onClick={() => toggleGroupParticipant(user)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Убрать ${user.name ?? "пользователя"}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              type="search"
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder="Поиск участников"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <div className="max-h-52 overflow-y-auto">
              {groupSearching && groupResults.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Поиск…
                </div>
              ) : groupResults.length === 0 && debouncedGroup.length > 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Никого не найдено
                </div>
              ) : (
                <ul className="flex flex-col">
                  {groupResults.map((user) => {
                    const selected = groupSelected.some((u) => u.id === user.id);
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => toggleGroupParticipant(user)}
                          className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${
                            selected ? "bg-accent" : "hover:bg-muted"
                          }`}
                        >
                          <UserAvatar user={user} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {user.name ?? "Без имени"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {user.email ?? user.phone ?? ""}
                            </div>
                          </div>
                          {selected && (
                            <span className="text-sm text-primary" aria-hidden="true">
                              ✓
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {groupError && (
              <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-600">
                {groupError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void createGroupChat()}
              disabled={creating}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Создать группу
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
