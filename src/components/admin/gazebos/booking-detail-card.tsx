"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineBooking } from "@/modules/gazebos/types";
import {
  DISCOUNT_REASONS,
  DISCOUNT_REASON_LABELS,
  type DiscountReason,
} from "@/modules/booking/discount";

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
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState<DiscountReason | "">("");
  const [discountNote, setDiscountNote] = useState("");

  const meta = booking.metadata as Record<string, unknown> | null;
  const guestCount = meta?.guestCount as number | undefined;
  const comment = meta?.comment as string | undefined;

  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;

  const isPending = booking.status === "PENDING";
  const canComplete = booking.status === "CONFIRMED";

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const formatDate = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  const totalCost = pricePerHour ? Math.round(hours * pricePerHour) : null;
  const totalFromMeta = Number(meta?.totalPrice ?? totalCost ?? 0);
  const discountAmount = discountPercent > 0 ? Math.round(totalFromMeta * discountPercent / 100) : 0;
  const finalAmount = totalFromMeta - discountAmount;

  const discountValid = !showDiscount || discountPercent === 0 || (
    discountPercent > 0 &&
    discountPercent <= maxDiscountPercent &&
    discountReason !== "" &&
    (discountReason !== "other" || discountNote.length >= 5)
  );

  async function updateStatus(status: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) onStatusChanged();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    setActionLoading(true);
    try {
      const payload: Record<string, unknown> = { status: "COMPLETED" };
      if (showDiscount && discountPercent > 0 && discountReason) {
        payload.discountPercent = discountPercent;
        payload.discountReason = discountReason;
        if (discountReason === "other" && discountNote) {
          payload.discountNote = discountNote;
        }
      }
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) onStatusChanged();
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
      <div className={`px-4 py-3 flex items-center justify-between ${
        isActiveNow
          ? "bg-emerald-50 border-b border-emerald-200"
          : isPending
          ? "bg-amber-50 border-b border-amber-200"
          : "bg-zinc-50 border-b border-zinc-200"
      }`}>
        <div className="flex items-center gap-2">
          {isActiveNow && (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
          <h3 className="text-sm font-semibold text-zinc-900">
            {booking.clientName ?? "Без имени"}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isActiveNow
              ? "bg-emerald-200 text-emerald-800"
              : isPending
              ? "bg-amber-200 text-amber-800"
              : "bg-emerald-100 text-emerald-700"
          }`}>
            {isActiveNow ? "Отдыхает" : isPending ? "Ожидает" : "Подтверждена"}
          </span>
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

        {pricePerHour && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Тариф</div>
            <div className="font-medium text-zinc-900">{pricePerHour} ₽/ч</div>
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
            <span className="text-zinc-900">Итого ({hours} ч × {pricePerHour} ₽)</span>
            <span className="text-zinc-900">
              {showDiscount && discountPercent > 0 ? (
                <>
                  <span className="line-through text-zinc-400 font-normal mr-2">{totalFromMeta.toLocaleString("ru-RU")} ₽</span>
                  {finalAmount.toLocaleString("ru-RU")} ₽
                </>
              ) : (
                <>{totalFromMeta.toLocaleString("ru-RU")} ₽</>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Discount form (inline, shown when completing) */}
      {showDiscount && canComplete && (
        <div className="px-4 pb-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Скидка</span>
              <button
                onClick={() => { setShowDiscount(false); setDiscountPercent(0); setDiscountReason(""); setDiscountNote(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-700"
              >
                Убрать
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">% (макс. {maxDiscountPercent})</label>
                <input
                  type="number"
                  min={1}
                  max={maxDiscountPercent}
                  value={discountPercent || ""}
                  onChange={(e) => setDiscountPercent(Math.min(Number(e.target.value) || 0, maxDiscountPercent))}
                  className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  placeholder="0"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-zinc-600 mb-1">Причина</label>
                <select
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value as DiscountReason)}
                  className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Выберите</option>
                  {DISCOUNT_REASONS.map((r) => (
                    <option key={r} value={r}>{DISCOUNT_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>

            {discountReason === "other" && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Пояснение (мин. 5 символов)</label>
                <textarea
                  value={discountNote}
                  onChange={(e) => setDiscountNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                  placeholder="Укажите причину..."
                />
              </div>
            )}

            {discountPercent > 0 && (
              <div className="flex items-center justify-between text-xs text-amber-800 border-t border-amber-200 pt-2">
                <span>Скидка {discountPercent}%</span>
                <span className="font-semibold">−{discountAmount.toLocaleString("ru-RU")} ₽</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center gap-2">
        {isPending && (
          <Button
            size="sm"
            onClick={() => updateStatus("CONFIRMED")}
            disabled={actionLoading}
          >
            Подтвердить
          </Button>
        )}
        {canComplete && !showDiscount && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleComplete}
              disabled={actionLoading}
            >
              Завершить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDiscount(true)}
              disabled={actionLoading}
            >
              Со скидкой
            </Button>
          </>
        )}
        {canComplete && showDiscount && (
          <Button
            size="sm"
            onClick={handleComplete}
            disabled={actionLoading || !discountValid}
          >
            {actionLoading ? "..." : "Завершить со скидкой"}
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => updateStatus("CANCELLED")}
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
    </div>
  );
}
