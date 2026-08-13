"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

export type BookingHistoryEntry = {
  id: string;
  action: string;
  label: string;
  actor: string;
  at: string;
  details: string[];
};

type RestoreInfo = {
  available: boolean;
  hoursLeft: number;
  reasonUnavailable: string | null;
};

type HistoryResponse = {
  success: boolean;
  data?: { events: BookingHistoryEntry[]; status: string; restore: RestoreInfo };
  error?: { message?: string };
};

type Props = {
  bookingId: string;
  /** "gazebos" | "ps-park" — определяет базовый путь API. */
  moduleSlug: string;
  /** Что показать в диалоге восстановления. */
  bookingLabel?: string;
  /** Дёрнуть, когда бронь восстановлена, — родитель перечитывает расписание. */
  onRestored?: () => void;
  /**
   * Управление раскрытием снаружи. Передан — компонент прячет собственный
   * заголовок-переключатель: раскрытием командует кнопка «История» в карточке
   * брони. Не передан — рисует свой заголовок (режим таблицы броней).
   */
  open?: boolean;
};

function formatMoment(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Лента событий брони с кнопкой восстановления (#511).
 *
 * Раньше «что случилось с бронью» нельзя было узнать вообще: журнал писался,
 * но нигде не показывался, поэтому исчезнувшая из расписания бронь выглядела
 * как потерянные данные. Сворачиваемый блок — чтобы карточка брони не росла
 * вдвое у тех, кому история не нужна прямо сейчас (AC-6: открывается за одно
 * действие, без перехода на другую страницу).
 */
export function BookingHistory({
  bookingId,
  moduleSlug,
  bookingLabel,
  onRestored,
  open: controlledOpen,
}: Props) {
  const [uncontrolledOpen, setOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<BookingHistoryEntry[]>([]);
  const [restore, setRestore] = useState<RestoreInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/${moduleSlug}/bookings/${bookingId}/history`);
      const body = (await res.json().catch(() => null)) as HistoryResponse | null;
      if (!res.ok || !body?.success || !body.data) {
        setError(body?.error?.message ?? `Не удалось загрузить историю (HTTP ${res.status})`);
        return;
      }
      setEvents(body.data.events);
      setRestore(body.data.restore);
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }, [bookingId, moduleSlug]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function handleRestore(reason: string | null, password: string) {
    try {
      const res = await fetch(`/api/${moduleSlug}/bookings/${bookingId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(reason ? { reason } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success: true }
        | { success: false; error?: { message?: string } }
        | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось восстановить бронь (HTTP ${res.status})`
        );
      }
      setRestoreOpen(false);
      await load();
      onRestored?.();
      return null;
    } catch {
      return "Сетевая ошибка";
    }
  }

  if (isControlled && !open) return null;

  return (
    <div className="border-t border-zinc-100">
      {!isControlled && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          <span>История брони</span>
          <span className="text-zinc-400">{open ? "▲" : "▼"}</span>
        </button>
      )}

      {open && (
        <div className="px-4 pb-3">
          {loading && <p className="py-2 text-xs text-zinc-400">Загружаем…</p>}

          {error && (
            <p role="alert" className="py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="py-2 text-xs text-zinc-400">Событий пока нет.</p>
          )}

          {events.length > 0 && (
            <ol className="space-y-2.5 py-1">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-zinc-200 pl-3 text-xs">
                  <div className="font-medium text-zinc-900">{e.label}</div>
                  <div className="text-zinc-500">
                    {formatMoment(e.at)} · {e.actor}
                  </div>
                  {e.details.length > 0 && (
                    <div className="mt-0.5 text-zinc-600">{e.details.join(" · ")}</div>
                  )}
                </li>
              ))}
            </ol>
          )}

          {restore?.available && (
            <button
              type="button"
              onClick={() => setRestoreOpen(true)}
              className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
            >
              Восстановить бронь ({restore.hoursLeft} ч осталось)
            </button>
          )}

          {restore && !restore.available && restore.reasonUnavailable && (
            <p className="mt-3 text-xs text-zinc-400">{restore.reasonUnavailable}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={restoreOpen}
        title="Восстановить бронь?"
        description="Бронь вернётся в статус «Подтверждена» и снова займёт слот в расписании."
        details={[
          ...(bookingLabel ? [{ label: "Бронь", value: bookingLabel }] : []),
          { label: "Окно восстановления", value: `${restore?.hoursLeft ?? 0} ч осталось` },
        ]}
        warning="Деньги не откатываются: уже проведённая выручка остаётся в отчётах, а возвращённая гостю онлайн-предоплата обратно не спишется — при необходимости запросите оплату заново. Товары, вернувшиеся на склад при отмене, нужно добавить вручную."
        confirmLabel="Восстановить"
        variant="neutral"
        requirePassword
        reason={{
          label: "Причина восстановления",
          placeholder: "Завершили не ту бронь…",
        }}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={handleRestore}
      />
    </div>
  );
}
