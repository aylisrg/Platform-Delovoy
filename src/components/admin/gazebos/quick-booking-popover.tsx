"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type GazeboQuickBookingPopoverProps = {
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string;
  maxEndTime: string;
  pricePerHour: number | null;
  onClose: () => void;
  onCreated: () => void;
};

const CLOSE_TIME = "23:00";

function durationLabel(startHHMM: string, endHHMM: string): string {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const durationMin = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMin <= 0) return "—";
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return h > 0 ? (m > 0 ? `${h}ч ${m}мин` : `${h}ч`) : `${m}мин`;
}

function durationHours(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function addOneHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const next = h + 1;
  if (next >= 23) return CLOSE_TIME;
  return `${String(next).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function GazeboQuickBookingPopover({
  resourceId,
  resourceName,
  date,
  startTime,
  maxEndTime,
  pricePerHour,
  onClose,
  onCreated,
}: GazeboQuickBookingPopoverProps) {
  const router = useRouter();

  const defaultEnd = addOneHour(startTime) <= maxEndTime ? addOneHour(startTime) : maxEndTime;

  const [startInput, setStartInput] = useState(startTime);
  const [endInput, setEndInput] = useState(defaultEnd);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hours = durationHours(startInput, endInput);
  const totalPrice = pricePerHour && hours > 0 ? Math.round(hours * pricePerHour) : null;
  const duration = durationLabel(startInput, endInput);
  const isValid = startInput < endInput && endInput <= maxEndTime;

  useEffect(() => {
    if (endInput <= startInput) {
      const next = addOneHour(startInput);
      setEndInput(next <= maxEndTime ? next : maxEndTime);
    }
  }, [startInput, endInput, maxEndTime]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/gazebos/admin-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          date,
          startTime: startInput,
          endTime: endInput,
          clientName,
          clientPhone,
          ...(guestCount && { guestCount: parseInt(guestCount, 10) }),
        }),
      });

      const data = await res.json();
      if (data.success) {
        onCreated();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка при создании");
      }
    } catch {
      setError("Не удалось создать бронирование");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 mx-4">

        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">{resourceName}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">{date}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Начало</label>
            <input
              type="time"
              value={startInput}
              min="08:00"
              onChange={(e) => setStartInput(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Конец
              <span className="ml-1 text-zinc-400 font-normal text-[10px]">до {maxEndTime}</span>
            </label>
            <input
              type="time"
              value={endInput}
              min={startInput}
              max={maxEndTime}
              onChange={(e) => setEndInput(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 ${
                isValid
                  ? "border-zinc-300 focus:border-blue-500 focus:ring-blue-500"
                  : "border-red-300 focus:border-red-500 focus:ring-red-500"
              }`}
            />
          </div>
        </div>

        {hours > 0 && (
          <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2 mb-3 flex items-center justify-between text-sm">
            <span className="text-zinc-600">{duration}</span>
            {totalPrice !== null && (
              <span className="font-semibold text-zinc-800 tabular-nums">
                {totalPrice.toLocaleString("ru-RU")} ₽
              </span>
            )}
          </div>
        )}

        {!isValid && startInput >= endInput && (
          <p className="text-xs text-red-500 mb-2">Начало должно быть раньше конца</p>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Имя клиента *"
            autoFocus
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="tel"
            required
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="Телефон *"
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
          <button
            type="submit"
            disabled={submitting || !clientName.trim() || !clientPhone.trim() || !isValid}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "Создание..." : "Забронировать"}
          </button>
        </form>
      </div>
    </div>
  );
}
