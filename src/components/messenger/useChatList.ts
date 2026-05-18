"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatPreview = {
  id: string;
  kind: "SUPPORT" | "DIRECT" | "GROUP" | "TOPIC_BOOKINGS" | "TOPIC_CONTRACTS";
  title: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  participants: Array<{ userId: string; name: string | null; image: string | null }>;
};

type ListFilter = "ALL" | "UNREAD" | "SUPPORT" | "DIRECT" | "GROUP";

type Options = {
  search?: string;
  filter?: ListFilter;
};

type Result = {
  chats: ChatPreview[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  addOrUpdateChat: (chat: ChatPreview) => void;
};

type ApiResponse =
  | { success: true; data: { chats: ChatPreview[]; nextCursor: string | null } }
  | { success: false; error: { code: string; message: string } };

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

function filterToKind(filter: ListFilter | undefined): string | null {
  if (!filter || filter === "ALL" || filter === "UNREAD") return null;
  return filter;
}

function sortByLastMessage(list: ChatPreview[]): ChatPreview[] {
  return [...list].sort((a, b) => {
    const av = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bv = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return bv - av;
  });
}

export function useChatList(options?: Options): Result {
  const search = options?.search ?? "";
  const filter = options?.filter ?? "ALL";

  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(search);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (nextCursor: string | null, replace: boolean): Promise<void> => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const kind = filterToKind(filter);
      if (kind) params.set("kind", kind);
      if (nextCursor) params.set("cursor", nextCursor);
      params.set("limit", String(PAGE_SIZE));

      try {
        const res = await fetch(`/api/messenger/chats?${params.toString()}`, {
          signal: ctrl.signal,
          credentials: "include",
        });
        const json = (await res.json()) as ApiResponse;
        if (!json.success) {
          setError(json.error.message);
          setLoading(false);
          return;
        }
        const incoming = filter === "UNREAD"
          ? json.data.chats.filter((c) => c.unreadCount > 0)
          : json.data.chats;
        setChats((prev) => {
          if (replace) return sortByLastMessage(incoming);
          const map = new Map<string, ChatPreview>();
          for (const c of prev) map.set(c.id, c);
          for (const c of incoming) map.set(c.id, c);
          return sortByLastMessage(Array.from(map.values()));
        });
        setCursor(json.data.nextCursor);
        setHasMore(json.data.nextCursor !== null);
        setLoading(false);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить чаты");
        setLoading(false);
      }
    },
    [debouncedSearch, filter],
  );

  useEffect(() => {
    void fetchPage(null, true);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchPage, reloadKey]);

  const loadMore = useCallback((): void => {
    if (!hasMore || loading) return;
    void fetchPage(cursor, false);
  }, [hasMore, loading, cursor, fetchPage]);

  const refresh = useCallback((): void => {
    setReloadKey((k) => k + 1);
  }, []);

  const addOrUpdateChat = useCallback((chat: ChatPreview): void => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      const next = idx === -1 ? [...prev, chat] : prev.map((c, i) => (i === idx ? chat : c));
      return sortByLastMessage(next);
    });
  }, []);

  return { chats, loading, error, hasMore, loadMore, refresh, addOrUpdateChat };
}
