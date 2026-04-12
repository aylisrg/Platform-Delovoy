"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type QuickBookingPopoverProps = {
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string; // "10:00"
  availableConsecutiveSlots: number; // max hours available from startTime
  pricePerHour: number | null;
  onClose: () => void;
  onCreated: () => void;
};

export function QuickBookingPopover({
  resourceId,
  resourceName,
  date,
  startTime,
  availableConsecutiveSlots,
  pricePerHour,
  onClose,
  onCreated,
}: QuickBookingPopoverProps) {
  const router = useRouter();

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [duration, setDuration] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDuration = Math.min(availableConsecutiveSlots, 5);
  const endHour = parseInt(startTime.split(":")[0], 10) + duration;
  const endTime = `${endHour.toString().padStart(2, "0")}:00`;
  const totalPrice = pricePerHour ? duration * pricePerHour : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/ps-park/admin-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          date,
          startTime,
          endTime,
          clientName,
          ...(clientPhone && { clientPhone }),
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
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 mx-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              {resourceName}
            </h3>
            <p className="text-xs text-zinc-500">
              {startTime}–{endTime} ({duration} ч.)
              {totalPrice !== null && (
                <span className="ml-1 font-medium text-zinc-700">
                  · {totalPrice} ₽
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="text"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Имя клиента *"
              autoFocus
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <input
              type="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Телефон (необязательно)"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {maxDuration > 1 && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Длительность
              </label>
              <div className="flex gap-1.5">
                {Array.from({ length: maxDuration }, (_, i) => i + 1).map(
                  (h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setDuration(h)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        duration === h
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      {h} ч.
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !clientName.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "Создание..." : "Забронировать"}
          </button>
        </form>
      </div>
    </div>
  );
}
