"use client";

import { useEffect, useState } from "react";
import type { AccountBrief, MergeRequestItem } from "@/modules/clients/types";
import { ConfirmDialog, primaryButtonClass, secondaryButtonClass } from "./dialog-shell";

/**
 * Очередь «Запросы на объединение» (PRD 2026-10-25 US-E4 / AC-E4.3, ADR §7).
 * «Объединить» — отдаёт пару наверх (`onMerge`), там открывается мастер
 * слияния с предзаполненной парой; «Это разные люди» — `PATCH
 * /api/users/merge-requests/[id]`, пара больше не предлагается (AC-E4.4).
 *
 * Not wired into a page here — the team tab mounts it.
 */

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

type Envelope<T> =
  | { success: true; data: T; meta?: { total?: number } }
  | { success: false; error?: { code?: string; message?: string } };

export type MergeRequestsPanelProps = {
  onMerge: (pair: { userAId: string; userBId: string; mergeRequestId: string }) => void;
};

export function MergeRequestsPanel({ onMerge }: MergeRequestsPanelProps) {
  const [items, setItems] = useState<MergeRequestItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [dismissTarget, setDismissTarget] = useState<MergeRequestItem | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/merge-requests")
      .then((res) => res.json() as Promise<Envelope<MergeRequestItem[]>>)
      .then((body) => {
        if (cancelled) return;
        if (body.success) setItems(body.data);
        else setLoadError(body.error?.message || "Не удалось загрузить запросы");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Ошибка сети");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismiss() {
    if (!dismissTarget) return;
    setDismissing(true);
    setDismissError(null);
    try {
      const res = await fetch(`/api/users/merge-requests/${encodeURIComponent(dismissTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      const body = (await res.json()) as Envelope<{ id: string }>;
      // 409 «уже закрыт» — тоже убрать из списка: в очереди его больше нет.
      if (body.success || body.error?.code === "MERGE_REQUEST_CLOSED") {
        setItems((prev) => (prev ?? []).filter((i) => i.id !== dismissTarget.id));
        setDismissTarget(null);
        return;
      }
      setDismissError(body.error?.message || "Не удалось закрыть запрос");
    } catch {
      setDismissError("Ошибка сети");
    } finally {
      setDismissing(false);
    }
  }

  const count = items?.length ?? 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white" data-testid="merge-requests-panel">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-zinc-900">
          Запросы на объединение: {items === null && !loadError ? "…" : count}
        </span>
        <span className="text-xs text-zinc-500">{expanded ? "Свернуть" : "Показать"}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          {loadError ? (
            <p role="alert" className="text-red-600">
              {loadError}
            </p>
          ) : items === null ? (
            <div className="h-8 animate-pulse rounded-lg bg-zinc-100" />
          ) : items.length === 0 ? (
            <p className="text-zinc-500">Открытых запросов нет.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border border-zinc-200 p-3" data-testid="merge-request-item">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{item.reasonLabel}</span>
                    <span>{new Date(item.detectedAt).toLocaleDateString("ru-RU")}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {item.users.map((u) => (
                      <UserBrief key={u.id} user={u} />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDismissError(null);
                        setDismissTarget(item);
                      }}
                      className={secondaryButtonClass}
                    >
                      Это разные люди
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onMerge({ userAId: item.users[0].id, userBId: item.users[1].id, mergeRequestId: item.id })
                      }
                      className={primaryButtonClass}
                    >
                      Объединить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dismissTarget && (
        <ConfirmDialog
          title="Это разные люди?"
          message="Запрос закроется без объединения, и эта пара больше не будет предлагаться."
          confirmLabel="Это разные люди"
          tone="primary"
          busy={dismissing}
          error={dismissError}
          onConfirm={dismiss}
          onClose={() => setDismissTarget(null)}
        />
      )}
    </section>
  );
}

function UserBrief({ user }: { user: AccountBrief }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-2">
      <p className="font-medium text-zinc-900">
        {user.name || "Без имени"} <span className="text-xs font-normal text-zinc-500">{ROLE_LABEL[user.role]}</span>
      </p>
      <p className="text-xs text-zinc-600">
        {[user.email, user.phone, user.hasTelegram ? "Telegram привязан" : null].filter(Boolean).join(" · ") ||
          "Нет контактов"}
      </p>
    </div>
  );
}
