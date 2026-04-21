"use client";

import { useEffect, useState } from "react";

export type DeleteConfirmDialogProps = {
  open: boolean;
  title?: string;
  description?: string;
  /** What is being deleted — shown in bold inside the dialog. */
  target?: string;
  confirmLabel?: string;
  onCancel: () => void;
  /**
   * Called with the password and optional reason the user typed.
   * Should throw or return a non-null string to surface an inline error
   * (e.g. "Неверный пароль"). Returning void means success.
   */
  onConfirm: (password: string, reason: string | null) => Promise<string | null | void>;
};

/**
 * SUPERADMIN-only destructive action confirmation.
 * Requires the current user to re-type their password plus (optionally) a reason.
 * Reusable across all "delete" buttons in the admin panel — pair it with a
 * DELETE endpoint guarded by `authorizeSuperadminDeletion` on the server.
 */
export function DeleteConfirmDialog({
  open,
  title = "Подтверждение удаления",
  description = "Действие необратимо для пользователей. В системе сохранится запись в журнале удалений.",
  target,
  confirmLabel = "Удалить",
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset inputs when dialog opens
      setPassword("");
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Введите пароль");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const msg = await onConfirm(password, reason.trim() ? reason.trim() : null);
      if (typeof msg === "string" && msg.length > 0) {
        setError(msg);
        setSubmitting(false);
        return;
      }
      // Success — parent is responsible for closing
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        {target && (
          <p className="mt-1 text-sm text-zinc-700">
            Будет удалено: <span className="font-semibold">{target}</span>
          </p>
        )}
        <p className="mt-2 text-sm text-zinc-500">{description}</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600">
              Пароль <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
              placeholder="Ваш пароль"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600">
              Причина (опционально)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={2}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
              placeholder="Почему удаляем (для журнала)"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {submitting ? "Удаляем..." : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Thin client-side helper around the server contract.
 * Sends `{ password, reason? }` as the DELETE body and returns either
 * `null` (success) or a human-readable error message.
 */
export async function deleteWithPassword(
  url: string,
  password: string,
  reason: string | null
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...(reason ? { reason } : {}) }),
    });
    const json = await res.json().catch(() => null as unknown);
    if (res.ok && (json as { success?: boolean })?.success) return null;
    const err = (json as { error?: { message?: string; code?: string } })?.error;
    if (err?.code === "INVALID_PASSWORD") return "Неверный пароль";
    if (err?.code === "PASSWORD_REQUIRED") return "Введите пароль";
    if (err?.code === "PASSWORD_NOT_SET") return err.message ?? "Пароль не задан";
    if (err?.code === "FORBIDDEN") return "Нет прав на удаление";
    return err?.message ?? `Ошибка (${res.status})`;
  } catch {
    return "Сеть недоступна";
  }
}
