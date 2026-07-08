"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineBooking } from "@/modules/gazebos/types";
import { formatDate, formatTime } from "@/lib/format";

type ResourceOption = { id: string; name: string };

type Props = {
  booking: TimelineBooking;
  onSaved: () => void;
  onCancel: () => void;
};

/** DD-MM-YYYY (from @/lib/format) → YYYY-MM-DD for <input type="date">. */
function toDateInput(d: Date): string {
  return formatDate(d).split("-").reverse().join("-");
}

export function GazeboBookingEditForm({ booking, onSaved, onCancel }: Props) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const meta = booking.metadata as Record<string, unknown> | null;

  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [resourceId, setResourceId] = useState(booking.resourceId);
  const [date, setDate] = useState(toDateInput(start));
  const [startTime, setStartTime] = useState(formatTime(start));
  const [endTime, setEndTime] = useState(formatTime(end));
  const [guestCount, setGuestCount] = useState(
    meta?.guestCount != null ? String(meta.guestCount) : ""
  );
  const [comment, setComment] = useState((meta?.comment as string) ?? "");
  const [clientName, setClientName] = useState(booking.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(booking.clientPhone ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/gazebos");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setResources(
            json.data.map((r: { id: string; name: string }) => ({
              id: r.id,
              name: r.name,
            }))
          );
        }
      } catch {
        // resource list is best-effort; the current resource stays selected
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          date,
          startTime,
          endTime,
          ...(guestCount ? { guestCount: parseInt(guestCount, 10) } : {}),
          comment,
          clientName,
          clientPhone,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message ?? "Не удалось сохранить");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 space-y-3 border-t border-zinc-200 bg-white">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
        Редактирование брони
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Беседка</span>
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          >
            {resources.length === 0 && (
              <option value={booking.resourceId}>Текущая беседка</option>
            )}
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Дата</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Начало</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Конец</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Гостей</span>
          <input
            type="number"
            min={1}
            value={guestCount}
            onChange={(e) => setGuestCount(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Телефон</span>
          <input
            type="tel"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Имя клиента</span>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-zinc-600 mb-1 block">Комментарий</span>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
