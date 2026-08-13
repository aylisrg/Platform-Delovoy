"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  /** Остаток к оплате — им предзаполняем поле «наличные». */
  outstanding: number;
  bookingLabel: string;
  onCancel: () => void;
  /** Возврат непустой строки — inline-ошибка; null — успех. */
  onConfirm: (cashAmount: number, cardAmount: number) => Promise<string | null>;
};

function formatMoney(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

/**
 * Приём оплаты без завершения брони (#511).
 *
 * Владелец просил «статус ОПЛАЧЕНО», который можно поставить. Поставить его
 * напрямую нельзя — оплата это деньги, а не флаг, — поэтому пункт «ОПЛАЧЕНО»
 * в списке статусов открывает это окно: менеджер вводит принятую сумму, она
 * уходит в кассу и в историю, бейдж загорается зелёным. Бронь при этом
 * остаётся в расписании.
 */
export function BookingPaymentModal({
  open,
  outstanding,
  bookingLabel,
  onCancel,
  onConfirm,
}: Props) {
  const [cashRaw, setCashRaw] = useState(String(Math.max(0, Math.round(outstanding))));
  const [cardRaw, setCardRaw] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const cash = parseFloat(cashRaw) || 0;
  const card = parseFloat(cardRaw) || 0;
  const total = cash + card;
  const left = Math.round((outstanding - total) * 100) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (total <= 0) {
      setError("Укажите сумму оплаты");
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await onConfirm(cash, card);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="Приём оплаты"
        className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-zinc-900">Отметить оплату</h2>
        <p className="mt-1.5 text-sm text-zinc-600">
          Деньги попадут в кассу и в историю брони. Бронь останется в расписании —
          завершать её сейчас не нужно.
        </p>

        <dl className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-3 py-0.5">
            <dt className="text-zinc-500">Бронь</dt>
            <dd className="text-right font-medium text-zinc-900">{bookingLabel}</dd>
          </div>
          <div className="flex justify-between gap-3 py-0.5">
            <dt className="text-zinc-500">Осталось оплатить</dt>
            <dd className="text-right font-medium text-zinc-900">{formatMoney(outstanding)}</dd>
          </div>
        </dl>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pay-cash" className="block text-xs font-medium text-emerald-700">
              💵 Наличные
            </label>
            <input
              id="pay-cash"
              type="number"
              min={0}
              step={1}
              autoFocus
              value={cashRaw}
              onChange={(e) => setCashRaw(e.target.value)}
              disabled={submitting}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="pay-card" className="block text-xs font-medium text-blue-700">
              💳 Карта
            </label>
            <input
              id="pay-card"
              type="number"
              min={0}
              step={1}
              value={cardRaw}
              onChange={(e) => setCardRaw(e.target.value)}
              disabled={submitting}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          Принимаем {formatMoney(total)}.{" "}
          {left > 0
            ? `После этого останется ${formatMoney(left)} — бейдж будет «Оплачено частично».`
            : "Счёт закроется полностью — бейдж станет «ОПЛАЧЕНО»."}
        </p>

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
            Не сейчас
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "Записываем..." : "Записать оплату"}
          </button>
        </div>
      </form>
    </div>
  );
}
