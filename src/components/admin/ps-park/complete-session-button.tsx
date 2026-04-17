"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SessionBillModal, type PaymentSplit } from "./session-bill-modal";
import type { BookingBill } from "@/modules/ps-park/types";

type Props = {
  bookingId: string;
  onCompleted: () => void;
};

export function CompleteSessionButton({ bookingId, onCompleted }: Props) {
  const router = useRouter();
  const [bill, setBill] = useState<BookingBill | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoadingBill(true);
    setError(null);
    try {
      const res = await fetch(`/api/ps-park/bookings/${bookingId}/bill`);
      const data = await res.json();
      if (data.success) {
        setBill(data.data);
      } else {
        setError(data.error?.message ?? "Не удалось загрузить счёт");
      }
    } catch {
      setError("Ошибка при загрузке счёта");
    } finally {
      setLoadingBill(false);
    }
  }

  async function handleConfirm({ cashAmount, cardAmount, discountPercent, discountReason, discountNote }: PaymentSplit) {
    setConfirming(true);
    try {
      const payload: Record<string, unknown> = { status: "COMPLETED", cashAmount, cardAmount };
      if (discountPercent && discountPercent > 0 && discountReason) {
        payload.discountPercent = discountPercent;
        payload.discountReason = discountReason;
        if (discountNote) payload.discountNote = discountNote;
      }
      const res = await fetch(`/api/ps-park/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setBill(null);
        onCompleted();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка при завершении");
      }
    } catch {
      setError("Не удалось завершить сессию");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loadingBill}
        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        {loadingBill ? "..." : "Завершить"}
      </button>

      {error && !bill && (
        <span className="text-xs text-red-500 ml-2">{error}</span>
      )}

      {bill && (
        <SessionBillModal
          bill={bill}
          isOpen={!!bill}
          onClose={() => setBill(null)}
          onConfirm={handleConfirm}
          confirming={confirming}
        />
      )}
    </>
  );
}
