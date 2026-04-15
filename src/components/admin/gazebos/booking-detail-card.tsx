"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineBooking } from "@/modules/gazebos/types";

type Props = {
  booking: TimelineBooking;
  resourceName: string;
  pricePerHour: number | null;
  isActiveNow: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
};

export function GazeboBookingDetailCard({
  booking,
  resourceName,
  pricePerHour,
  isActiveNow,
  onClose,
  onStatusChanged,
}: Props) {
  const [actionLoading, setActionLoading] = useState(false);

  const meta = booking.metadata as Record<string, unknown> | null;
  const guestCount = meta?.guestCount as number | undefined;
  const comment = meta?.comment as string | undefined;

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

  const totalCost = pricePerHour ? Math.round(hours * pricePerHour) : null;

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
            <span className="text-zinc-900">{totalCost.toLocaleString("ru-RU")} ₽</span>
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
