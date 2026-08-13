"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";
import { GazeboBillModal, type PaymentSplit } from "./gazebo-bill-modal";
import { ConfirmDialog } from "@/components/admin/shared/confirm-dialog";

type Props = {
  bookingId: string;
  currentStatus: BookingStatus;
  totalPrice?: number;
  resourceName?: string;
  clientName?: string;
  date?: string;        // YYYY-MM-DD
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  maxDiscountPercent?: number;
};

export function BookingActions({
  bookingId,
  currentStatus,
  totalPrice = 0,
  resourceName = "—",
  clientName = "—",
  date = "",
  startTime = "",
  endTime = "",
  maxDiscountPercent = 30,
}: Props) {
  const router = useRouter();
  const [billOpen, setBillOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Счёт заполнен, но PATCH ещё не ушёл — ждём явного «Да, завершить» (AC-1).
  const [pendingSplit, setPendingSplit] = useState<PaymentSplit | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  /** Возвращает текст ошибки или null при успехе. */
  async function updateStatus(
    status: BookingStatus,
    extra?: Record<string, unknown>
  ): Promise<string | null> {
    try {
      const res = await fetch(`/api/gazebos/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success: true }
        | { success: false; error?: { message?: string } }
        | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось обновить статус (HTTP ${res.status})`
        );
      }
      router.refresh();
      return null;
    } catch {
      return "Сетевая ошибка";
    }
  }

  async function handleConfirmCancel(reason: string | null) {
    const message = await updateStatus("CANCELLED", reason ? { reason } : undefined);
    if (message) return message;
    setCancelOpen(false);
    return null;
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

      const res = await fetch(`/api/gazebos/bookings/${bookingId}`, {
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
      router.refresh();
      return null;
    } catch {
      return "Не удалось завершить бронь";
    } finally {
      setCompleting(false);
    }
  }

  if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
    return null;
  }

  const canComplete = currentStatus === "CONFIRMED" || currentStatus === "CHECKED_IN";

  return (
    <>
      <div className="flex gap-2">
        {currentStatus === "PENDING" && (
          <Button size="sm" onClick={() => updateStatus("CONFIRMED")}>
            Подтвердить
          </Button>
        )}
        {canComplete && (
          <Button size="sm" variant="secondary" onClick={() => { setApiError(null); setBillOpen(true); }}>
            Завершить
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
          Отменить
        </Button>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="Отменить бронь?"
        description="Бронь исчезнет из расписания, слот освободится и его сможет занять другой гость."
        details={[
          { label: "Гость", value: clientName },
          { label: "Беседка", value: resourceName },
          {
            label: "Время",
            value: [date, [startTime, endTime].filter(Boolean).join("–")]
              .filter(Boolean)
              .join(", ") || "—",
          },
          ...(totalPrice > 0
            ? [{ label: "Сумма", value: `${totalPrice.toLocaleString("ru-RU")} ₽` }]
            : []),
        ]}
        warning="Отмена не восстанавливается автоматически — вернуть бронь сможет только суперадмин."
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
          bill={{ resourceName, clientName, date, startTime, endTime, totalBill: totalPrice }}
          isOpen={billOpen}
          onClose={() => { setBillOpen(false); setApiError(null); }}
          onConfirm={handleConfirmBill}
          confirming={completing}
          maxDiscountPercent={maxDiscountPercent}
          apiError={apiError}
        />
      )}

      {/* Последний вопрос перед необратимым завершением (AC-1). */}
      <ConfirmDialog
        open={pendingSplit !== null}
        title="Завершить бронь?"
        description="Бронь пропадёт из расписания, слот станет доступен для новых броней."
        details={[
          { label: "Гость", value: clientName },
          { label: "Беседка", value: resourceName },
          {
            label: "Время",
            value: [date, [startTime, endTime].filter(Boolean).join("–")]
              .filter(Boolean)
              .join(", ") || "—",
          },
          {
            label: "Наличные",
            value: `${(pendingSplit?.cashAmount ?? 0).toLocaleString("ru-RU")} ₽`,
          },
          {
            label: "Карта",
            value: `${(pendingSplit?.cardAmount ?? 0).toLocaleString("ru-RU")} ₽`,
          },
        ]}
        warning="Завершение нельзя отменить самостоятельно — переоткрыть бронь сможет только суперадмин."
        confirmLabel="Да, завершить"
        variant="neutral"
        onCancel={() => setPendingSplit(null)}
        onConfirm={handleConfirmComplete}
      />
    </>
  );
}
