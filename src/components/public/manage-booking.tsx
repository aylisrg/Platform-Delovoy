"use client";

import { useState } from "react";
import Link from "next/link";
import type { ManagedBookingView } from "@/modules/booking/manage";
import { buildCancellationSummary } from "@/modules/booking/cancellation-summary";
import { OfferAcceptance, type SummaryLine } from "@/components/public/offer-acceptance";
import { formatDate } from "@/lib/format";

/**
 * Управление бронью без регистрации (ТЗ §8).
 *
 * Кнопка отмены не прячется, не требует переписки с оператором и не ведёт в
 * чат: право на отказ безусловное, любое трение здесь — риск по пп. 3 п. 2
 * ст. 16 ЗоЗПП. Сумма к возврату и расшифровка удержаний показываются ДО
 * подтверждения, а не после.
 */

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Ожидает оплаты",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Вы на месте",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
  NO_SHOW: "Неявка",
};

const fmtRub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export function ManageBooking({
  token,
  initial,
}: {
  token: string;
  initial: ManagedBookingView;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelled, setCancelled] = useState(initial.status === "CANCELLED");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(initial.date);
  const [newStart, setNewStart] = useState(initial.startTime);
  const [newEnd, setNewEnd] = useState(initial.endTime);

  const summary = buildCancellationSummary();

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message ?? "Не удалось выполнить действие");
        return null;
      }
      return data.data;
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const data = await call({ action: "cancel", confirmRefund: confirmingCancel });
    if (!data) return;
    if (data.confirmationRequired) {
      setConfirmingCancel(true);
      return;
    }
    setCancelled(true);
  }

  async function reschedule() {
    const data = await call({
      action: "reschedule",
      date: newDate,
      startTime: newStart,
      endTime: newEnd,
    });
    if (!data) return;
    setView(data as ManagedBookingView);
    setRescheduleOpen(false);
  }

  async function payWithAcceptance(acceptance: {
    acceptMarketing: boolean;
    offerVersionSlug: string;
  }) {
    const data = await call({
      action: "pay",
      acceptOffer: true,
      offerVersionSlug: acceptance.offerVersionSlug,
      acceptMarketing: acceptance.acceptMarketing,
    });
    if (data?.confirmationUrl) {
      window.location.href = data.confirmationUrl as string;
    } else if (data) {
      setError("Онлайн-оплата сейчас недоступна. Мы свяжемся с вами для подтверждения.");
    }
  }

  const orderLines: SummaryLine[] = [
    { label: `${view.resourceName} · ${formatDate(view.date + "T00:00:00")}`, value: "", muted: true },
    { label: `Время ${view.startTime}–${view.endTime}`, value: "", muted: true },
    ...view.items.map((item) => ({
      label: `${item.name} × ${item.quantity}`,
      value: fmtRub(item.price * item.quantity),
    })),
  ];

  if (cancelled) {
    return (
      <div className="rounded-2xl border border-black/[0.08] p-8 text-center">
        <div className="text-4xl">✓</div>
        <h1 className="mt-4 font-[family-name:var(--font-manrope)] text-xl font-semibold text-[#1d1d1f]">
          Бронирование {view.number} отменено
        </h1>
        {view.refund.paidAmount > 0 && (
          <p className="mt-3 text-sm leading-relaxed text-[#5a5a5f]">
            {view.refund.refundAmount > 0
              ? `К возврату ${fmtRub(view.refund.refundAmount)} — деньги вернутся тем же способом, которым вы платили, в течение 10 календарных дней.`
              : "По условиям оферты стоимость аренды при отмене в этот срок не возвращается."}
          </p>
        )}
        <Link
          href="/gazebos"
          className="mt-6 inline-block rounded-full bg-[#16A34A] px-6 py-3 text-sm font-medium text-white"
        >
          Забронировать снова
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-[#86868b]">Бронирование</p>
        <h1 className="mt-1 font-[family-name:var(--font-manrope)] text-2xl font-semibold tracking-tight text-[#1d1d1f]">
          {view.number}
        </h1>
        <p className="mt-2 text-sm text-[#5a5a5f]">{STATUS_LABEL[view.status] ?? view.status}</p>
      </header>

      <div className="rounded-2xl border border-black/[0.08] p-5">
        <dl className="space-y-2 text-sm">
          {[
            ["Беседка", view.resourceName],
            ["Дата", formatDate(view.date + "T00:00:00")],
            ["Время", `${view.startTime}–${view.endTime}`],
            ...(view.guestName ? [["Гость", view.guestName]] : []),
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-[#86868b]">{label}</dt>
              <dd className="font-medium text-[#1d1d1f]">{value}</dd>
            </div>
          ))}
          {view.items.map((item) => (
            <div key={item.name} className="flex justify-between gap-4">
              <dt className="text-[#86868b]">
                {item.name} × {item.quantity}
              </dt>
              <dd className="font-medium text-[#1d1d1f]">{fmtRub(item.price * item.quantity)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-black/[0.06] pt-2">
            <dt className="font-semibold text-[#1d1d1f]">Итого</dt>
            <dd className="font-bold text-[#1d1d1f]">{fmtRub(view.totalPrice)}</dd>
          </div>
          {view.paidAmount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-[#86868b]">Оплачено онлайн</dt>
              <dd className="font-medium text-[#16A34A]">{fmtRub(view.paidAmount)}</dd>
            </div>
          )}
        </dl>

        {view.offer && (
          <p className="mt-4 border-t border-black/[0.06] pt-3 text-xs text-[#86868b]">
            Договор заключён на условиях{" "}
            <Link
              href={`/oferta/v/${view.offer.slug}`}
              className="text-[#0071e3] underline underline-offset-2"
            >
              редакции № {view.offer.number} публичной оферты
            </Link>
            .
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Бронь от оператора/бота: акцепт и оплата здесь */}
      {view.acceptanceRequired && view.status === "PENDING" && (
        <section className="rounded-2xl border border-[#0071e3]/20 bg-[#0071e3]/[0.03] p-5">
          <h2 className="font-[family-name:var(--font-manrope)] text-base font-semibold text-[#1d1d1f]">
            Подтвердите и оплатите бронирование
          </h2>
          <p className="mt-1 mb-4 text-sm text-[#5a5a5f]">
            Бронь оформлена для вас — ознакомьтесь с условиями и оплатите, чтобы она вступила в силу.
          </p>
          <OfferAcceptance
            lines={orderLines}
            total={view.totalPrice}
            submitting={busy}
            onSubmit={payWithAcceptance}
          />
        </section>
      )}

      {/* Незавершённая оплата уже акцептованной брони */}
      {!view.acceptanceRequired && view.paymentUrl && view.status === "PENDING" && (
        <a
          href={view.paymentUrl}
          className="block rounded-full bg-[#16A34A] px-6 py-3 text-center text-sm font-medium text-white"
        >
          Продолжить оплату — {fmtRub(view.totalPrice)}
        </a>
      )}

      {/* Перенос */}
      {view.reschedule.allowed ? (
        <section className="rounded-2xl border border-black/[0.08] p-5">
          <h2 className="font-[family-name:var(--font-manrope)] text-base font-semibold text-[#1d1d1f]">
            Перенести на другую дату
          </h2>
          <p className="mt-1 text-sm text-[#5a5a5f]">{summary.lines[1]}</p>
          {rescheduleOpen ? (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-[#86868b]">Дата</span>
                  <input
                    type="date"
                    value={newDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-[#86868b]">Начало</span>
                  <input
                    type="time"
                    step={3600}
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="w-full rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-[#86868b]">Окончание</span>
                  <input
                    type="time"
                    step={3600}
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="w-full rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm"
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setRescheduleOpen(false)}
                  className="rounded-full bg-[#1d1d1f]/[0.06] px-5 py-2.5 text-sm font-medium text-[#1d1d1f]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={reschedule}
                  disabled={busy}
                  className="rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Переносим…" : "Перенести"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRescheduleOpen(true)}
              className="mt-4 rounded-full bg-[#1d1d1f]/[0.06] px-5 py-2.5 text-sm font-medium text-[#1d1d1f]"
            >
              Выбрать другую дату
            </button>
          )}
        </section>
      ) : (
        <p className="text-sm text-[#86868b]">{view.reschedule.reason}</p>
      )}

      {/* Отмена — всегда доступна, без объяснения причин */}
      <section className="rounded-2xl border border-black/[0.08] p-5">
        <h2 className="font-[family-name:var(--font-manrope)] text-base font-semibold text-[#1d1d1f]">
          Отменить бронирование
        </h2>

        <div className="mt-3 space-y-1.5 text-sm text-[#5a5a5f]">
          {view.refund.paidAmount > 0 ? (
            <>
              <p>
                Оплачено {fmtRub(view.refund.paidAmount)} · к возврату{" "}
                <strong className="text-[#1d1d1f]">{fmtRub(view.refund.refundAmount)}</strong>
              </p>
              {view.refund.deductions.map((deduction) => (
                <p key={deduction.label} className="text-[#86868b]">
                  Удерживается {fmtRub(deduction.amount)} — {deduction.label.toLowerCase()}
                </p>
              ))}
              {view.refund.deductions.length === 0 && (
                <p className="text-[#86868b]">Удержаний нет — вернём всю сумму.</p>
              )}
            </>
          ) : (
            <p>Оплата по брони не проходила — удерживать нечего.</p>
          )}
          <p className="text-[#86868b]">
            Подробно — в{" "}
            <Link
              href={summary.detailsHref}
              target="_blank"
              rel="noopener"
              className="text-[#0071e3] underline underline-offset-2"
            >
              {summary.detailsLabel}
            </Link>
            .
          </p>
        </div>

        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          data-testid="cancel-booking"
          className="mt-4 rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
        >
          {busy
            ? "Отменяем…"
            : confirmingCancel
              ? `Подтвердить отмену — к возврату ${fmtRub(view.refund.refundAmount)}`
              : "Отменить бронирование"}
        </button>
      </section>
    </div>
  );
}
