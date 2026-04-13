"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineBooking } from "@/modules/ps-park/types";

type Props = {
  booking: TimelineBooking;
  resourceName: string;
  pricePerHour: number | null;
  isActiveNow: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
};

export function BookingDetailCard({
  booking,
  resourceName,
  pricePerHour,
  isActiveNow,
  onClose,
  onStatusChanged,
}: Props) {
  const [actionLoading, setActionLoading] = useState(false);

  const meta = booking.metadata as Record<string, unknown> | null;
  const playerCount = meta?.playerCount as number | undefined;
  const comment = meta?.comment as string | undefined;
  const items = meta?.items as Array<{ skuName: string; quantity: number; price: number }> | undefined;
  const itemsTotal = meta?.itemsTotal as number | undefined;
  const totalPrice = meta?.totalPrice as number | undefined;

  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;

  const isPending = booking.status === "PENDING";

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const formatDate = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  async function updateStatus(status: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/ps-park/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) onStatusChanged();
    } finally {
      setActionLoading(false);
    }
  }

  // Compute cost
  const hoursCost = pricePerHour ? hours * pricePerHour : null;
  const totalBill = (hoursCost ?? 0) + (itemsTotal ?? 0);

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
      {/* Header */}
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
            {isActiveNow ? "Играет" : isPending ? "Ожидает" : "Подтверждена"}
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

      {/* Body */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {/* Resource */}
        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Стол</div>
          <div className="font-medium text-zinc-900">{resourceName}</div>
        </div>

        {/* Date & Time */}
        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Время</div>
          <div className="font-medium text-zinc-900">
            {formatDate(start)}, {formatTime(start)}–{formatTime(end)}
          </div>
        </div>

        {/* Duration */}
        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Длительность</div>
          <div className="font-medium text-zinc-900">{hours} ч</div>
        </div>

        {/* Players */}
        <div>
          <div className="text-xs text-zinc-400 mb-0.5">Игроков</div>
          <div className="font-medium text-zinc-900">{playerCount ?? "—"}</div>
        </div>

        {/* Phone */}
        {booking.clientPhone && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Телефон</div>
            <a href={`tel:${booking.clientPhone}`} className="font-medium text-blue-600 hover:underline">
              {booking.clientPhone}
            </a>
          </div>
        )}

        {/* Price per hour */}
        {pricePerHour && (
          <div>
            <div className="text-xs text-zinc-400 mb-0.5">Тариф</div>
            <div className="font-medium text-zinc-900">{pricePerHour} ₽/ч</div>
          </div>
        )}

        {/* Comment */}
        {comment && (
          <div className="col-span-2 sm:col-span-4">
            <div className="text-xs text-zinc-400 mb-0.5">Комментарий</div>
            <div className="text-zinc-700">{comment}</div>
          </div>
        )}
      </div>

      {/* Items (if any) */}
      {items && items.length > 0 && (
        <div className="px-4 pb-3 border-t border-zinc-100 pt-3">
          <div className="text-xs text-zinc-400 mb-1.5">Товары</div>
          <div className="space-y-1">
            {items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-zinc-700">
                  {item.skuName} <span className="text-zinc-400">x{item.quantity}</span>
                </span>
                <span className="text-zinc-900 font-medium">{item.price * item.quantity} ₽</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bill summary */}
      {(hoursCost !== null || (itemsTotal && itemsTotal > 0)) && (
        <div className="px-4 pb-3 border-t border-zinc-100 pt-3">
          <div className="flex justify-between text-sm">
            {hoursCost !== null && (
              <>
                <span className="text-zinc-500">Аренда ({hours} ч × {pricePerHour} ₽)</span>
                <span className="text-zinc-900">{hoursCost} ₽</span>
              </>
            )}
          </div>
          {itemsTotal && itemsTotal > 0 && (
            <div className="flex justify-between text-sm mt-1">
              <span className="text-zinc-500">Товары</span>
              <span className="text-zinc-900">{itemsTotal} ₽</span>
            </div>
          )}
          <div className="flex justify-between text-sm mt-2 pt-2 border-t border-zinc-100 font-semibold">
            <span className="text-zinc-900">Итого</span>
            <span className="text-zinc-900">{totalPrice ?? totalBill} ₽</span>
          </div>
        </div>
      )}

      {/* Actions */}
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
        {booking.status === "CONFIRMED" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => updateStatus("COMPLETED")}
            disabled={actionLoading}
          >
            Завершить
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
