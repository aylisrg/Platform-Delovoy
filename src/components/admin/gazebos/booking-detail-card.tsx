"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GazeboBookingEditForm } from "./booking-edit-form";
import { GazeboBillModal, type PaymentSplit } from "./gazebo-bill-modal";
import { ConfirmDialog } from "@/components/admin/shared/confirm-dialog";
import { BookingHistory } from "@/components/admin/shared/booking-history";
import { PaymentBadge } from "@/components/admin/shared/payment-badge";
import { BookingStatusSelect, PAID_OPTION, type StatusSelectValue } from "@/components/admin/shared/booking-status-select";
import { BookingPaymentModal } from "@/components/admin/shared/booking-payment-modal";
import { getBookingPaymentSummary } from "@/modules/booking/payment-status";
import type { TimelineBooking } from "@/modules/gazebos/types";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified, toISODate } from "@/lib/format";

type ApiErrorBody = { success: false; error?: { code?: string; message?: string } };
type ApiOkBody = { success: true; data: unknown };

type Props = {
  booking: TimelineBooking;
  resourceName: string;
  pricePerHour: number | null;
  isActiveNow: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
  maxDiscountPercent?: number;
};

export function GazeboBookingDetailCard({
  booking,
  resourceName,
  pricePerHour,
  isActiveNow,
  onClose,
  onStatusChanged,
  maxDiscountPercent = 30,
}: Props) {
  const [actionLoading, setActionLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Счёт заполнен, но PATCH ещё не ушёл — ждём явного «Да, завершить» (AC-1).
  const [pendingSplit, setPendingSplit] = useState<PaymentSplit | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const meta = booking.metadata as Record<string, unknown> | null;
  const guestCount = meta?.guestCount as number | undefined;
  const comment = meta?.comment as string | undefined;
  const email = meta?.email as string | undefined;

  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;

  const isPending = booking.status === "PENDING";
  const isCheckedIn = booking.status === "CHECKED_IN";
  // CHECKED_IN → COMPLETED разрешён FSM (state-machine.ts), но до #436
  // CHECKED_IN был недостижим вручную, поэтому заехавшую бронь было нечем
  // завершить в этой карточке — только отсюда, где её и открывают.
  const canComplete = booking.status === "CONFIRMED" || booking.status === "CHECKED_IN";
  const canEdit = ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(
    booking.status,
  );
  // #436: роуты /checkin и /no-show существовали, но ни одна кнопка их не
  // вызывала — статус CHECKED_IN был недостижим вручную.
  const canCheckIn = booking.status === "CONFIRMED";
  const canMarkNoShow = booking.status === "CONFIRMED";

  const formatTime = (d: Date) => formatTimeUnified(d);

  const formatDate = (d: Date) => formatDateUnified(d);

  // Применённая ставка часа снапшотится в metadata при создании/переносе
  // брони (учитывает выходные). Проп pricePerHour — только fallback (будний).
  const payment = getBookingPaymentSummary(booking);
  const appliedRate = Number(meta?.pricePerHour ?? pricePerHour ?? 0) || null;
  const totalCost = appliedRate ? Math.round(hours * appliedRate) : null;
  const totalFromMeta = Number(meta?.totalPrice ?? totalCost ?? 0);

  /**
   * Возвращает текст ошибки или null при успехе — чтобы вызов из
   * ConfirmDialog показал ошибку внутри диалога, а не за его спиной.
   */
  async function updateStatus(
    status: string,
    extra?: Record<string, unknown>
  ): Promise<string | null> {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      const body = (await res.json().catch(() => null)) as ApiOkBody | ApiErrorBody | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось обновить статус (HTTP ${res.status})`
        );
      }
      onStatusChanged();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Сетевая ошибка";
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInlineStatus(status: string) {
    setApiError(null);
    const message = await updateStatus(status);
    if (message) setApiError(message);
  }

  /**
   * Заезд/неявка идут через выделенные роуты (`/checkin`, `/no-show`), а не
   * общий PATCH { status } — в них живёт конфликт-чек под блокировкой слота
   * для позднего заезда NO_SHOW → CHECKED_IN (#478); общий PATCH его не
   * повторяет (#436).
   */
  async function updateStatusVia(endpoint: "checkin" | "no-show"): Promise<string | null> {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}/${endpoint}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as ApiOkBody | ApiErrorBody | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось выполнить действие (HTTP ${res.status})`
        );
      }
      onStatusChanged();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Сетевая ошибка";
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCheckIn() {
    setApiError(null);
    const message = await updateStatusVia("checkin");
    if (message) setApiError(message);
  }

  async function handleMarkNoShow() {
    setApiError(null);
    const message = await updateStatusVia("no-show");
    if (message) setApiError(message);
  }

  async function handleConfirmCancel(reason: string | null) {
    const message = await updateStatus("CANCELLED", reason ? { reason } : undefined);
    if (message) return message;
    setCancelOpen(false);
    return null;
  }

  /** Единая точка входа из выпадающего списка статусов. */
  function handleStatusSelect(value: StatusSelectValue) {
    setApiError(null);
    if (value === PAID_OPTION) return setPayOpen(true);
    if (value === "COMPLETED") return setBillOpen(true);
    if (value === "CANCELLED") return setCancelOpen(true);
    void handleInlineStatus(value);
  }

  async function handleRecordPayment(cashAmount: number, cardAmount: number) {
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashAmount, cardAmount }),
      });
      const body = (await res.json().catch(() => null)) as ApiOkBody | ApiErrorBody | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось записать оплату (HTTP ${res.status})`
        );
      }
      setPayOpen(false);
      onStatusChanged();
      return null;
    } catch {
      return "Сетевая ошибка";
    }
  }

  /** Счёт заполнен — показываем последний вопрос вместо немедленного PATCH. */
  function handleConfirmBill(split: PaymentSplit) {
    setApiError(null);
    setPendingSplit(split);
  }

  async function handleConfirmComplete(): Promise<string | null> {
    const split = pendingSplit;
    if (!split) return "Счёт не заполнен";
    setCompleting(true);
    try {
      const payload: Record<string, unknown> = {
        status: "COMPLETED",
        cashAmount: split.cashAmount,
        cardAmount: split.cardAmount,
      };
      if (split.discountPercent && split.discountPercent > 0 && split.discountReason) {
        payload.discountPercent = split.discountPercent;
        payload.discountReason = split.discountReason;
        if (split.discountNote) payload.discountNote = split.discountNote;
      }
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        return data?.error?.message ?? "Ошибка при завершении";
      }
      setPendingSplit(null);
      setBillOpen(false);
      onStatusChanged();
      return null;
    } catch {
      return "Не удалось завершить бронь";
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
      <div className={`px-4 py-3 flex items-center justify-between ${
        isActiveNow || isCheckedIn
          ? "bg-emerald-50 border-b border-emerald-200"
          : isPending
          ? "bg-amber-50 border-b border-amber-200"
          : "bg-zinc-50 border-b border-zinc-200"
      }`}>
        <div className="flex items-center gap-2">
          {(isActiveNow || isCheckedIn) && (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
          <h3 className="text-sm font-semibold text-zinc-900">
            {booking.clientName ?? "Без имени"}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isActiveNow || isCheckedIn
              ? "bg-emerald-200 text-emerald-800"
              : isPending
              ? "bg-amber-200 text-amber-800"
              : "bg-emerald-100 text-emerald-700"
          }`}>
            {isCheckedIn
              ? "Заехал"
              : isActiveNow
              ? "Отдыхает"
              : isPending
              ? "Ожидает"
              : "Подтверждена"}
          </span>
          <PaymentBadge booking={booking} />
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600 transition-colors p-1 -m-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Единый переключатель статуса — раньше «как поменять статус» было
          неочевидно: кнопки зависели от состояния, заезд и неявка вообще
          отсутствовали. */}
      <div className="px-4 py-2.5 border-b border-zinc-100 bg-white">
        <BookingStatusSelect
          currentStatus={booking.status}
          startTime={start}
          paymentState={payment.state}
          disabled={actionLoading}
          onSelect={handleStatusSelect}
        />
      </div>

      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Беседка</div>
          <div className="font-medium text-zinc-900">{resourceName}</div>
        </div>

        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Время</div>
          <div className="font-medium text-zinc-900">
            {formatDate(start)}, {formatTime(start)}–{formatTime(end)}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Длительность</div>
          <div className="font-medium text-zinc-900">{hours} ч</div>
        </div>

        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Гостей</div>
          <div className="font-medium text-zinc-900">{guestCount ?? "—"}</div>
        </div>

        {booking.clientPhone && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Телефон</div>
            <a href={`tel:${booking.clientPhone}`} className="font-medium text-blue-600 hover:underline">
              {booking.clientPhone}
            </a>
          </div>
        )}

        {email && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Email</div>
            <a href={`mailto:${email}`} className="font-medium text-blue-600 hover:underline">
              {email}
            </a>
          </div>
        )}

        {appliedRate && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Тариф</div>
            <div className="font-medium text-zinc-900">{appliedRate} ₽/ч</div>
          </div>
        )}

        {comment && (
          <div className="col-span-2 sm:col-span-4">
            <div className="text-xs text-zinc-400 mb-0.5">Комментарий</div>
            <div className="text-zinc-700">{comment}</div>
          </div>
        )}
      </div>

      {totalCost !== null && (
        <div className="px-4 pb-3 border-t border-zinc-100 pt-3">
          <div className="flex justify-between text-sm font-semibold">
            <span className="text-zinc-900">Итого ({hours} ч × {appliedRate} ₽)</span>
            <span className="text-zinc-900">{totalFromMeta.toLocaleString("ru-RU")} ₽</span>
          </div>
        </div>
      )}

      {apiError && !billOpen && (
        <p role="alert" className="px-4 pb-2 text-xs text-red-600">
          {apiError}
        </p>
      )}

      <BookingHistory
        bookingId={booking.id}
        moduleSlug="gazebos"
        bookingLabel={`${resourceName} · ${formatDate(start)} · ${booking.clientName ?? "без имени"}`}
        onRestored={onStatusChanged}
        open={historyOpen}
      />

      <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center gap-2 flex-wrap">
        {canEdit && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowEdit(true)}
            disabled={actionLoading}
          >
            Изменить
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setHistoryOpen((v) => !v)}
          disabled={actionLoading}
        >
          {historyOpen ? "Скрыть историю" : "История"}
        </Button>
        {isPending && (
          <Button
            size="sm"
            onClick={() => handleInlineStatus("CONFIRMED")}
            disabled={actionLoading}
          >
            Подтвердить
          </Button>
        )}
        {canCheckIn && (
          <Button
            size="sm"
            onClick={handleCheckIn}
            disabled={actionLoading}
          >
            Заехал
          </Button>
        )}
        {canMarkNoShow && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleMarkNoShow}
            disabled={actionLoading}
          >
            Не пришёл
          </Button>
        )}
        {canComplete && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { setApiError(null); setBillOpen(true); }}
            disabled={actionLoading}
          >
            Завершить
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => { setApiError(null); setCancelOpen(true); }}
          disabled={actionLoading}
        >
          Отменить
        </Button>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          Закрыть
        </button>
      </div>

      {showEdit && (
        <GazeboBookingEditForm
          booking={booking}
          resourceName={resourceName}
          appliedRate={appliedRate}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            onStatusChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={cancelOpen}
        title="Отменить бронь?"
        description="Бронь исчезнет из расписания, слот освободится и его сможет занять другой гость."
        details={[
          { label: "Гость", value: booking.clientName ?? "Без имени" },
          { label: "Беседка", value: resourceName },
          {
            label: "Время",
            value: `${formatDate(start)}, ${formatTime(start)}–${formatTime(end)}`,
          },
          ...(totalCost !== null
            ? [{ label: "Сумма", value: `${totalFromMeta.toLocaleString("ru-RU")} ₽` }]
            : []),
        ]}
        warning="Вернуть бронь сможет только суперадмин и только в течение 24 часов — через «Историю брони», если слот к тому моменту свободен."
        confirmLabel="Да, отменить бронь"
        variant="danger"
        reason={{
          label: "Причина отмены",
          placeholder: "Гость отказался, погода, дубль…",
        }}
        onCancel={() => setCancelOpen(false)}
        onConfirm={handleConfirmCancel}
      />

      {billOpen && (
        <GazeboBillModal
          bill={{
            resourceName,
            clientName: booking.clientName ?? "Без имени",
            date: toISODate(booking.startTime),
            startTime: formatTime(start),
            endTime: formatTime(end),
            totalBill: totalFromMeta,
          }}
          isOpen={billOpen}
          onClose={() => { setBillOpen(false); setApiError(null); }}
          onConfirm={handleConfirmBill}
          confirming={completing}
          maxDiscountPercent={maxDiscountPercent}
          apiError={apiError}
        />
      )}

      {/* Последний вопрос перед необратимым завершением (AC-1). Рендерится
          после модалки счёта, чтобы лечь поверх неё: закрытие диалога
          возвращает менеджера к заполненному счёту, а не к пустому. */}
      <ConfirmDialog
        open={pendingSplit !== null}
        title="Завершить бронь?"
        description="Бронь пропадёт из расписания, слот станет доступен для новых броней."
        details={[
          { label: "Гость", value: booking.clientName ?? "Без имени" },
          { label: "Беседка", value: resourceName },
          {
            label: "Время",
            value: `${formatDate(start)}, ${formatTime(start)}–${formatTime(end)}`,
          },
          {
            label: "Наличные",
            value: `${(pendingSplit?.cashAmount ?? 0).toLocaleString("ru-RU")} ₽`,
          },
          {
            label: "Карта",
            value: `${(pendingSplit?.cardAmount ?? 0).toLocaleString("ru-RU")} ₽`,
          },
          // AC-2: онлайн-предоплата уже проведена вебхуком — показываем явно,
          // чтобы менеджер не взял с гостя эти деньги второй раз.
          ...(payment.online > 0
            ? [{
                label: "Оплачено онлайн",
                value: `${payment.online.toLocaleString("ru-RU")} ₽ (уже учтено)`,
              }]
            : []),
        ]}
        warning="Переоткрыть бронь сможет только суперадмин и только в течение 24 часов — через «Историю брони»."
        confirmLabel="Да, завершить"
        variant="neutral"
        onCancel={() => setPendingSplit(null)}
        onConfirm={handleConfirmComplete}
      />

      <BookingPaymentModal
        open={payOpen}
        outstanding={payment.outstanding > 0 ? payment.outstanding : totalFromMeta}
        bookingLabel={`${resourceName} · ${booking.clientName ?? "без имени"}`}
        onCancel={() => setPayOpen(false)}
        onConfirm={handleRecordPayment}
      />
    </div>
  );
}
