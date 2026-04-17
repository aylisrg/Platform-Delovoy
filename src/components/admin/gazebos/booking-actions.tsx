"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";
import {
  DISCOUNT_REASONS,
  DISCOUNT_REASON_LABELS,
  type DiscountReason,
} from "@/modules/booking/discount";

type Props = {
  bookingId: string;
  currentStatus: BookingStatus;
  totalPrice?: number;
  maxDiscountPercent?: number;
};

export function BookingActions({ bookingId, currentStatus, totalPrice = 0, maxDiscountPercent = 30 }: Props) {
  const router = useRouter();
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState<DiscountReason | "">("");
  const [discountNote, setDiscountNote] = useState("");
  const [completing, setCompleting] = useState(false);

  const discountAmount = discountPercent > 0 ? Math.round(totalPrice * discountPercent / 100) : 0;
  const finalAmount = totalPrice - discountAmount;

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

  async function handleComplete() {
    setCompleting(true);
    try {
      const payload: Record<string, unknown> = { status: "COMPLETED" };
      if (showDiscount && discountPercent > 0 && discountReason) {
        payload.discountPercent = discountPercent;
        payload.discountReason = discountReason;
        if (discountReason === "other" && discountNote) {
          payload.discountNote = discountNote;
        }
      }

      const res = await fetch(`/api/gazebos/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.refresh();
      }
    } finally {
      setCompleting(false);
    }
  }

  if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
    return null;
  }

  const canComplete = currentStatus === "CONFIRMED" || currentStatus === "CHECKED_IN";
  const discountValid = !showDiscount || discountPercent === 0 || (
    discountPercent > 0 &&
    discountPercent <= maxDiscountPercent &&
    discountReason !== "" &&
    (discountReason !== "other" || discountNote.length >= 5)
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {currentStatus === "PENDING" && (
          <Button size="sm" onClick={() => updateStatus("CONFIRMED")}>
            Подтвердить
          </Button>
        )}
        {canComplete && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!showDiscount) {
                handleComplete();
              }
            }}
          >
            Зав��ршить
          </Button>
        )}
        {canComplete && !showDiscount && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDiscount(true)}
          >
            Завершить со скидкой
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => updateStatus("CANCELLED")}>
          Отменить
        </Button>
      </div>

      {showDiscount && canComplete && (
        <div className="rounded-xl border border-zinc-200 p-4 space-y-3 bg-zinc-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-900">Скидка при чекауте</span>
            <button
              onClick={() => { setShowDiscount(false); setDiscountPercent(0); setDiscountReason(""); setDiscountNote(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-700"
            >
              Отмена
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">
              Скидка, % (макс. {maxDiscountPercent}%)
            </label>
            <input
              type="number"
              min={1}
              max={maxDiscountPercent}
              value={discountPercent || ""}
              onChange={(e) => setDiscountPercent(Math.min(Number(e.target.value) || 0, maxDiscountPercent))}
              className="w-24 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="0"
            />
          </div>

          {discountPercent > 0 && (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Причина</label>
                <select
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value as DiscountReason)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Выберите причину</option>
                  {DISCOUNT_REASONS.map((r) => (
                    <option key={r} value={r}>{DISCOUNT_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              {discountReason === "other" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Пояснение (мин. 5 симво��ов)</label>
                  <textarea
                    value={discountNote}
                    onChange={(e) => setDiscountNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    placeholder="Укажите причину..."
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-sm border-t border-zinc-200 pt-2">
                <span className="text-zinc-600">
                  <span className="line-through text-zinc-400">{totalPrice.toLocaleString("ru-RU")} ₽</span>
                  {" → "}
                  <span className="font-semibold text-zinc-900">{finalAmount.toLocaleString("ru-RU")} ₽</span>
                </span>
                <span className="text-xs text-zinc-500">
                  −{discountAmount.toLocaleString("ru-RU")} ₽ ({discountPercent}%)
                </span>
              </div>
            </>
          )}

          <Button
            size="sm"
            onClick={handleComplete}
            disabled={completing || !discountValid}
            className="w-full"
          >
            {completing ? "Завершение..." : "Завершить со скидкой"}
          </Button>
        </div>
      )}
    </div>
  );
}
