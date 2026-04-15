"use client";

import { useState, useCallback } from "react";

type MergePreview = {
  primary: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    telegramId: string | null;
    bookingCount: number;
    orderCount: number;
  };
  secondary: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    telegramId: string | null;
    bookingCount: number;
    orderCount: number;
  };
  conflicts: string[];
};

type SearchResult = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  telegramId: string | null;
};

export function MergeDialog({
  primaryId,
  primaryName,
  onMerged,
  onClose,
}: {
  primaryId: string;
  primaryName: string;
  onMerged: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const handleSearch = useCallback(async () => {
    if (search.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search: search.trim(), limit: "10" });
      const res = await fetch(`/api/admin/clients?${params}`);
      const data = await res.json();
      if (data.success) {
        setResults(
          (data.data as SearchResult[]).filter((c) => c.id !== primaryId)
        );
      }
    } catch {
      setError("Ошибка поиска");
    } finally {
      setSearching(false);
    }
  }, [search, primaryId]);

  const handleSelect = useCallback(
    async (secondaryId: string) => {
      setSelectedId(secondaryId);
      setLoadingPreview(true);
      setError(null);
      try {
        const params = new URLSearchParams({ primaryId, secondaryId });
        const res = await fetch(`/api/admin/clients/merge/preview?${params}`);
        const data = await res.json();
        if (data.success) {
          setPreview(data.data);
        } else {
          setError(data.error?.message || "Ошибка загрузки preview");
        }
      } catch {
        setError("Ошибка сети");
      } finally {
        setLoadingPreview(false);
      }
    },
    [primaryId]
  );

  const handleMerge = useCallback(async () => {
    if (!selectedId || confirmText !== "ОБЪЕДИНИТЬ") return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, secondaryId: selectedId }),
      });
      const data = await res.json();
      if (data.success) {
        onMerged();
      } else {
        setError(data.error?.message || "Ошибка объединения");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setMerging(false);
    }
  }, [selectedId, confirmText, primaryId, onMerged]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-zinc-900">
            Объединить клиентов
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-zinc-600 mb-4">
          Основной аккаунт: <strong>{primaryName}</strong>. Выберите второй аккаунт для объединения.
          Все данные второго аккаунта будут перенесены в основной.
        </p>

        {/* Search */}
        {!preview && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Имя, email или телефон..."
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                disabled={searching || search.trim().length < 2}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {searching ? "..." : "Найти"}
              </button>
            </div>

            {results.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                      selectedId === r.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <p className="font-medium text-zinc-900">{r.name || "Без имени"}</p>
                    <p className="text-xs text-zinc-500">
                      {[r.email, r.phone, r.telegramId && `TG: ${r.telegramId}`]
                        .filter(Boolean)
                        .join(" · ") || "Нет контактов"}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {loadingPreview && (
              <p className="text-sm text-zinc-400 text-center py-4">Загрузка preview...</p>
            )}
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-xs font-medium text-green-700 mb-1">Основной (останется)</p>
                <p className="text-sm font-medium text-zinc-900">{preview.primary.name || "Без имени"}</p>
                <p className="text-xs text-zinc-500">{preview.primary.email || "—"}</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {preview.primary.bookingCount} броней, {preview.primary.orderCount} заказов
                </p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-medium text-red-700 mb-1">Будет удалён</p>
                <p className="text-sm font-medium text-zinc-900">{preview.secondary.name || "Без имени"}</p>
                <p className="text-xs text-zinc-500">{preview.secondary.email || "—"}</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {preview.secondary.bookingCount} броней, {preview.secondary.orderCount} заказов
                </p>
              </div>
            </div>

            {preview.conflicts.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <p className="text-xs font-medium text-yellow-700 mb-1">Конфликты</p>
                <ul className="space-y-0.5">
                  {preview.conflicts.map((c, i) => (
                    <li key={i} className="text-xs text-yellow-800">{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Confirmation */}
            <div className="space-y-2">
              <p className="text-sm text-zinc-600">
                Для подтверждения напишите <strong>ОБЪЕДИНИТЬ</strong>:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="ОБЪЕДИНИТЬ"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setPreview(null);
                  setSelectedId(null);
                  setConfirmText("");
                }}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Назад
              </button>
              <button
                onClick={handleMerge}
                disabled={merging || confirmText !== "ОБЪЕДИНИТЬ"}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {merging ? "Объединение..." : "Подтвердить объединение"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
