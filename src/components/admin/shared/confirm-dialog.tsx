"use client";

import { useEffect, useState } from "react";

export type ConfirmDialogDetail = {
  label: string;
  value: string;
};

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Что именно произойдёт. Пишем последствие, а не «вы уверены?». */
  description?: string;
  /** Пары «поле → значение» с фактами о брони: беседка, время, клиент, сумма. */
  details?: ConfirmDialogDetail[];
  /** Красная плашка внизу — необратимость, потеря слота и т.п. */
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger — красная кнопка (отмена брони), neutral — тёмная (завершение). */
  variant?: "danger" | "neutral";
  /** Поле «причина». Пусто — поля нет вовсе. */
  reason?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    /** Минимальная длина, когда причина обязательна. По умолчанию 3. */
    minLength?: number;
  };
  onCancel: () => void;
  /**
   * Возврат непустой строки — показать её как inline-ошибку и оставить диалог
   * открытым. void/null — успех, закрывает родитель.
   */
  onConfirm: (reason: string | null) => Promise<string | null | void>;
};

/**
 * Подтверждение необратимого действия над бронью.
 *
 * Появился из-за #511: «Завершить» и «Отменить» срабатывали с одного клика,
 * бронь мгновенно уходила из сетки расписания (её статус выпадал из
 * `ACTIVE_BOOKING_STATUSES`), а обратного перехода в FSM не было — вернуть
 * ошибочно завершённую бронь было нечем. Диалог не чинит необратимость, но
 * гарантирует, что менеджер видит, что именно и с какой бронью произойдёт.
 *
 * Отличие от `DeleteConfirmDialog`: тот требует пароль и предназначен для
 * SUPERADMIN-удалений. Здесь пароля нет — это рутинные действия сменного
 * менеджера, пароль на каждую вторую бронь заставил бы его кликать вслепую.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  details,
  warning,
  confirmLabel,
  cancelLabel = "Не сейчас",
  variant = "danger",
  reason,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [reasonText, setReasonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- сброс полей при открытии
      setReasonText("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const minLength = reason?.minLength ?? 3;
  const trimmed = reasonText.trim();
  const reasonMissing = Boolean(reason?.required) && trimmed.length < minLength;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reasonMissing) {
      setError(`Укажите причину — минимум ${minLength} символа`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const message = await onConfirm(trimmed.length > 0 ? trimmed : null);
      if (typeof message === "string" && message.length > 0) {
        setError(message);
        setSubmitting(false);
        return;
      }
      // Успех — закрывает родитель.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
      setSubmitting(false);
    }
  }

  const confirmClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-zinc-900 hover:bg-zinc-800";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-1.5 text-sm text-zinc-600">{description}</p>}

        {details && details.length > 0 && (
          <dl className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
            {details.map((d) => (
              <div key={d.label} className="flex justify-between gap-3 py-0.5">
                <dt className="text-zinc-500">{d.label}</dt>
                <dd className="text-right font-medium text-zinc-900">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {warning && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {warning}
          </p>
        )}

        {reason && (
          <div className="mt-4">
            <label htmlFor="confirm-reason" className="block text-xs font-medium text-zinc-600">
              {reason.label}
              {reason.required && <span className="text-red-500"> *</span>}
            </label>
            <textarea
              id="confirm-reason"
              autoFocus
              rows={2}
              maxLength={500}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              disabled={submitting}
              placeholder={reason.placeholder}
              className="mt-1 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={submitting || reasonMissing}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {submitting ? "Выполняем..." : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
