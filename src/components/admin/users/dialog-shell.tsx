"use client";

import { useEffect, useId, type ReactNode } from "react";

/**
 * Modal frame shared by the users admin dialogs (exclusion, delete-blocked,
 * permissions, confirmations). The whole box is capped to the viewport and only
 * the body scrolls — header and footer stay put on short mobile screens (#485).
 */
export function DialogShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-zinc-900">
              {title}
            </h2>
            {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors";
export const dangerButtonClass =
  "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors";
export const primaryButtonClass =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors";

/** Replaces `window.alert()`: a message and «Закрыть». */
export function MessageDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <DialogShell
      title={title}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Закрыть
        </button>
      }
    >
      <p className="text-sm text-zinc-700">{message}</p>
    </DialogShell>
  );
}

/** Replaces `window.confirm()`; errors of the action are shown inside. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  error = null,
  tone = "danger",
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <DialogShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={tone === "danger" ? dangerButtonClass : primaryButtonClass}
          >
            {busy ? "..." : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-zinc-700">
        {message}
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            {error}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
