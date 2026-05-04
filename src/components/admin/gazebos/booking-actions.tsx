"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";
import { GazeboBillModal, type PaymentSplit } from "./gazebo-bill-modal";

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
  const [completing, setCompleting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  async function updateStatus(status: BookingStatus) {
    const res = await fetch(`/api/gazebos/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  async function handleConfirmBill(split: PaymentSplit) {
    setCompleting(true);
    setApiError(null);
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
      const data = await res.json();
      if (data.success) {
        setBillOpen(false);
        router.refresh();
      } else {
        setApiError(data.error?.message ?? "Ошибка при завершении");
      }
    } catch {
      setApiError("Не удалось завершить бронь");
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
        <Button size="sm" variant="danger" onClick={() => updateStatus("CANCELLED")}>
          Отменить
        </Button>
      </div>

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
    </>
  );
}
