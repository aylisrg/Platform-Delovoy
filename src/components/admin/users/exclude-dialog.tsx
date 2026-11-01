"use client";

import { useEffect, useState } from "react";
import type { ExclusionPreview, ExclusionResult } from "@/modules/users/types";
import { DialogShell, dangerButtonClass, secondaryButtonClass } from "./dialog-shell";

/**
 * «Исключить из команды» (PRD 2026-10-25 US-A1/US-A2, ADR §7).
 *
 * Loads the preview (`GET /api/users/[id]/exclude`), shows what is removed and
 * what stays, guard messages and the seeded-superadmin warning with its own
 * confirmation «Всё равно исключить», then submits:
 * - `submitVia="exclude"` → `POST /api/users/[id]/exclude`;
 * - `submitVia="role_change"` → `PATCH /api/users/[id] { role: "USER" }` (role
 *   select «Пользователь» — same operation, audited as a role change).
 */

export const EXCLUDE_TEXTS = {
  title: "Исключить из команды",
  action: "Исключить из команды",
  seededConfirm: "Всё равно исключить",
  seededWarning:
    "Этот аккаунт назначен суперадмином в настройках сервера. При ближайшем обновлении платформы роль вернётся автоматически. Чтобы исключение осталось, сначала смените настройку сервера.",
  keeps:
    "Аккаунт останется клиентом. Брони, заказы, задачи, переписка и журнал действий не удаляются.",
} as const;

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error?: { code?: string; message?: string } };

export function ExcludeDialog({
  userId,
  userName,
  submitVia = "exclude",
  onClose,
  onExcluded,
}: {
  userId: string;
  userName: string | null;
  submitVia?: "exclude" | "role_change";
  onClose: () => void;
  onExcluded: (result: ExclusionResult) => void;
}) {
  const [preview, setPreview] = useState<ExclusionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seededRequired, setSeededRequired] = useState(false);
  const [seededConfirmed, setSeededConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/exclude`)
      .then((res) => res.json() as Promise<ApiEnvelope<ExclusionPreview>>)
      .then((body) => {
        if (cancelled) return;
        if (body.success) setPreview(body.data);
        else setLoadError(body.error?.message || "Не удалось загрузить данные");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Ошибка сети");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const name = userName || preview?.user.name || "Без имени";
  const showSeeded = Boolean(preview?.isSeededSuperadmin) || seededRequired;
  const canSubmit = Boolean(preview) && !preview?.guard && !submitting && (!showSeeded || seededConfirmed);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const confirm = showSeeded && seededConfirmed ? { confirmSeeded: true } : {};
    try {
      const res =
        submitVia === "exclude"
          ? await fetch(`/api/users/${userId}/exclude`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(confirm),
            })
          : await fetch(`/api/users/${userId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "USER", ...confirm }),
            });
      const body = (await res.json()) as ApiEnvelope<ExclusionResult | { exclusion?: ExclusionResult }>;
      if (body.success) {
        const result =
          submitVia === "exclude"
            ? (body.data as ExclusionResult)
            : (body.data as { exclusion?: ExclusionResult }).exclusion;
        if (result) {
          onExcluded(result);
          return;
        }
        setSubmitError("Пользователь уже не входит в команду");
        return;
      }
      if (body.error?.code === "SEEDED_SUPERADMIN_CONFIRM_REQUIRED") setSeededRequired(true);
      setSubmitError(body.error?.message || "Не удалось исключить из команды");
    } catch {
      setSubmitError("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  }

  const guard = preview?.guard ?? null;

  return (
    <DialogShell
      title={EXCLUDE_TEXTS.title}
      subtitle={preview ? `${name} — ${ROLE_LABEL[preview.user.role] ?? preview.user.role}` : name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            {guard || loadError ? "Закрыть" : "Отмена"}
          </button>
          {preview && !guard && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={dangerButtonClass}
            >
              {submitting ? "Исключаем..." : EXCLUDE_TEXTS.action}
            </button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      ) : preview && guard ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {guard.message}
        </div>
      ) : preview ? (
        <div className="space-y-4 text-sm text-zinc-700">
          <p>
            Исключить {name} из команды? Роль станет «Пользователь», права и доступ к админке будут
            сняты, личные уведомления выключены. Аккаунт, брони, заказы и история сохранятся.
          </p>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Будет снято</p>
            <ul className="space-y-1.5" data-testid="exclusion-removes">
              <RemoveRow
                label="Разделы админки"
                count={preview.counts.sections}
                items={[...preview.removes.explicitSections, ...preview.removes.sectionsByRole]}
              />
              <RemoveRow label="Назначения на модули" count={preview.counts.modules} items={preview.removes.modules} />
              <RemoveRow
                label="Списки получателей уведомлений"
                count={preview.counts.recipientLists}
                items={preview.removes.recipientLists}
              />
              <RemoveRow
                label="Личные подписки на уведомления"
                count={preview.counts.subscriptions}
                items={preview.removes.subscriptions}
              />
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Активные сессии будут завершены.</p>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Сохранится</p>
            <p>{EXCLUDE_TEXTS.keeps}</p>
          </div>

          {preview.openAssignedTasks > 0 && (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-zinc-600">
              Открытых задач, где он исполнитель: {preview.openAssignedTasks}. Они останутся за ним —
              переназначьте их вручную.
            </p>
          )}

          {showSeeded && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
              <p>{EXCLUDE_TEXTS.seededWarning}</p>
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={seededConfirmed}
                  onChange={(e) => setSeededConfirmed(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                {EXCLUDE_TEXTS.seededConfirm}
              </label>
            </div>
          )}

          {submitError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
              {submitError}
            </div>
          )}
        </div>
      ) : null}
    </DialogShell>
  );
}

function RemoveRow({ label, count, items }: { label: string; count: number; items: string[] }) {
  return (
    <li className="flex flex-col">
      <span className="font-medium text-zinc-900">{`${label} — ${count}`}</span>
      {items.length > 0 && <span className="text-xs text-zinc-500">{items.join(", ")}</span>}
    </li>
  );
}
