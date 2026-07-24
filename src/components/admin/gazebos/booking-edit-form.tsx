"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { TimelineBooking } from "@/modules/gazebos/types";
import { formatTime, formatDate } from "@/lib/format";

type Props = {
  booking: TimelineBooking;
  resourceName: string;
  /** Применённая ставка часа (из metadata, учитывает выходные) — для превью. */
  appliedRate: number | null;
  onClose: () => void;
  onSaved: () => void;
};

const CLOSE_TIME = "23:00";
const OPEN_TIME = "08:00";

function durationHours(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

/**
 * Редактирование существующей брони админом: время и контакт клиента.
 * Отправляет PATCH /api/gazebos/bookings/:id без поля status (режим правки).
 * Дата брони не меняется в этой форме — только время в рамках дня.
 */
export function GazeboBookingEditForm({
  booking,
  resourceName,
  appliedRate,
  onClose,
  onSaved,
}: Props) {
  const router = useRouter();
  const meta = booking.metadata as Record<string, unknown> | null;

  const [startInput, setStartInput] = useState(formatTime(booking.startTime));
  const [endInput, setEndInput] = useState(formatTime(booking.endTime));
  const [clientName, setClientName] = useState(booking.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(booking.clientPhone ?? "");
  const [guestCount, setGuestCount] = useState(
    typeof meta?.guestCount === "number" ? String(meta.guestCount) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hours = durationHours(startInput, endInput);
  const validTime =
    startInput >= OPEN_TIME &&
    endInput <= CLOSE_TIME &&
    startInput < endInput;
  const estimate =
    appliedRate && hours > 0 ? Math.round(hours * appliedRate) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validTime || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: startInput,
          endTime: endInput,
          ...(clientName.trim() && { clientName: clientName.trim() }),
          ...(clientPhone.trim() && { clientPhone: clientPhone.trim() }),
          ...(guestCount && { guestCount: parseInt(guestCount, 10) }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Не удалось сохранить изменения");
      }
    } catch {
      setError("Не удалось сохранить изменения");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              Изменить бронь
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {resourceName} · {formatDate(booking.startTime)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Начало
              </label>
              <input
                type="time"
                value={startInput}
                min={OPEN_TIME}
                max={CLOSE_TIME}
                onChange={(e) => setStartInput(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Конец
              </label>
              <input
                type="time"
                value={endInput}
                min={OPEN_TIME}
                max={CLOSE_TIME}
                onChange={(e) => setEndInput(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 ${
                  validTime
                    ? "border-zinc-300 focus:border-blue-500 focus:ring-blue-500"
                    : "border-red-300 focus:border-red-500 focus:ring-red-500"
                }`}
              />
            </div>
          </div>

          {!validTime && (
            <p className="text-xs text-red-500">
              Проверьте время: {OPEN_TIME}–{CLOSE_TIME}, начало раньше конца.
            </p>
          )}

          {estimate !== null && validTime && (
            <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2 flex items-center justify-between text-sm">
              <span className="text-zinc-600">{hours} ч</span>
              <span className="text-zinc-800">
                ≈ {estimate.toLocaleString("ru-RU")} ₽{" "}
                <span className="text-xs text-zinc-400">(пересчитается)</span>
              </span>
            </div>
          )}

          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Имя клиента"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="tel"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="Телефон"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="number"
            value={guestCount}
            onChange={(e) => setGuestCount(e.target.value)}
            placeholder="Кол-во гостей"
            min="1"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={submitting || !validTime}
              className="flex-1"
            >
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
