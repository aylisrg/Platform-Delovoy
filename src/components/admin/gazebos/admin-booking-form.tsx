"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toast } from "@/components/ui/toast";

type TimeSlot = {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
};

type ResourceAvailability = {
  date: string;
  resource: {
    id: string;
    name: string;
    pricePerHour: string | number | null;
    capacity: number | null;
  };
  slots: TimeSlot[];
};

export function AdminBookingForm() {
  const router = useRouter();

  // Date & availability
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSlots, setShowSlots] = useState(false);

  // Selection
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);

  // Client info
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [comment, setComment] = useState("");

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  }, []);

  async function loadAvailability() {
    setLoading(true);
    try {
      const res = await fetch(`/api/gazebos/availability?date=${date}`);
      const data = await res.json();
      if (data.success) {
        setAvailability(data.data);
        setShowSlots(true);
        setSelectedResourceId(null);
        setSelectedSlots([]);
      }
    } catch {
      showToast("Не удалось загрузить доступность", "error");
    } finally {
      setLoading(false);
    }
  }

  function toggleSlot(resourceId: string, slotStart: string) {
    if (selectedResourceId && selectedResourceId !== resourceId) {
      setSelectedResourceId(resourceId);
      setSelectedSlots([slotStart]);
      return;
    }

    setSelectedResourceId(resourceId);

    setSelectedSlots((prev) => {
      if (prev.includes(slotStart)) {
        const idx = prev.indexOf(slotStart);
        if (idx === 0 || idx === prev.length - 1) {
          return prev.filter((s) => s !== slotStart);
        }
        return prev.slice(0, idx);
      }

      if (prev.length === 0) return [slotStart];

      const allSlots = availability
        .find((a) => a.resource.id === resourceId)
        ?.slots.filter((s) => s.isAvailable)
        .map((s) => s.startTime) ?? [];

      const sortedSelected = [...prev].sort();
      const firstIdx = allSlots.indexOf(sortedSelected[0]);
      const lastIdx = allSlots.indexOf(sortedSelected[sortedSelected.length - 1]);
      const newIdx = allSlots.indexOf(slotStart);

      if (newIdx === firstIdx - 1 || newIdx === lastIdx + 1) {
        return [...prev, slotStart].sort();
      }

      return [slotStart];
    });
  }

  function getTimeRange() {
    if (selectedSlots.length === 0 || !selectedResourceId) return null;
    const sorted = [...selectedSlots].sort();
    const resource = availability.find((a) => a.resource.id === selectedResourceId);
    if (!resource) return null;
    const lastSlot = resource.slots.find((s) => s.startTime === sorted[sorted.length - 1]);
    return { startTime: sorted[0], endTime: lastSlot?.endTime ?? sorted[sorted.length - 1] };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const timeRange = getTimeRange();
    if (!selectedResourceId || !timeRange) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/gazebos/admin-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: selectedResourceId,
          date,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          clientName,
          clientPhone,
          ...(guestCount && { guestCount: parseInt(guestCount, 10) }),
          ...(comment && { comment }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        showToast("Бронирование создано и подтверждено", "success");
        // Reset form
        setClientName("");
        setClientPhone("");
        setGuestCount("");
        setComment("");
        setSelectedResourceId(null);
        setSelectedSlots([]);
        setShowSlots(false);
        router.refresh();
      } else {
        showToast(data.error?.message ?? "Ошибка при создании", "error");
      }
    } catch {
      showToast("Не удалось создать бронирование", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const timeRange = getTimeRange();
  const selectedResource = availability.find((a) => a.resource.id === selectedResourceId);
  const totalPrice = selectedResource?.resource.pricePerHour
    ? selectedSlots.length * Number(selectedResource.resource.pricePerHour)
    : 0;

  return (
    <>
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-zinc-900">Забронировать для клиента</h2>
          <p className="text-sm text-zinc-500 mt-1">Бронирование будет сразу подтверждено</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Date picker */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="admin-date" className="block text-sm font-medium text-zinc-700 mb-1">
                  Дата
                </label>
                <input
                  id="admin-date"
                  type="date"
                  value={date}
                  onChange={(e) => { setDate(e.target.value); setShowSlots(false); }}
                  min={new Date().toISOString().split("T")[0]}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <Button type="button" variant="secondary" onClick={loadAvailability} disabled={loading}>
                {loading ? "Загрузка..." : "Показать слоты"}
              </Button>
            </div>

            {/* Slots */}
            {showSlots && availability.map((item) => (
              <div
                key={item.resource.id}
                className={`rounded-lg border p-3 transition-colors ${
                  selectedResourceId === item.resource.id
                    ? "border-blue-500 bg-blue-50/50"
                    : "border-zinc-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm text-zinc-900">{item.resource.name}</span>
                  {item.resource.capacity && (
                    <span className="text-xs text-zinc-400">до {item.resource.capacity} чел.</span>
                  )}
                  {item.resource.pricePerHour && (
                    <Badge variant="info">{Number(item.resource.pricePerHour)} ₽/ч</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.slots.map((slot) => {
                    const isSelected = selectedResourceId === item.resource.id && selectedSlots.includes(slot.startTime);
                    return (
                      <button
                        key={slot.startTime}
                        type="button"
                        disabled={!slot.isAvailable}
                        onClick={() => toggleSlot(item.resource.id, slot.startTime)}
                        className={`rounded px-2 py-1 text-xs font-medium transition-all ${
                          isSelected
                            ? "bg-blue-600 text-white"
                            : slot.isAvailable
                              ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                              : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                        }`}
                      >
                        {slot.startTime}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Summary */}
            {timeRange && selectedResource && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm">
                <span className="font-medium">{selectedResource.resource.name}</span>
                {" · "}
                {timeRange.startTime}–{timeRange.endTime} ({selectedSlots.length} ч.)
                {totalPrice > 0 && <> · <span className="font-semibold">{totalPrice} ₽</span></>}
              </div>
            )}

            {/* Client info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="client-name" className="block text-sm font-medium text-zinc-700 mb-1">
                  Имя клиента *
                </label>
                <input
                  id="client-name"
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Иванов Иван"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="client-phone" className="block text-sm font-medium text-zinc-700 mb-1">
                  Телефон клиента *
                </label>
                <input
                  id="client-phone"
                  type="tel"
                  required
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="+7 (999) 123-45-67"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="admin-guests" className="block text-sm font-medium text-zinc-700 mb-1">
                  Кол-во гостей
                </label>
                <input
                  id="admin-guests"
                  type="number"
                  min="1"
                  max={selectedResource?.resource.capacity ?? undefined}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="admin-comment" className="block text-sm font-medium text-zinc-700 mb-1">
                  Комментарий
                </label>
                <input
                  id="admin-comment"
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Доп. информация"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting || !selectedResourceId || selectedSlots.length === 0 || !clientName || !clientPhone}
            >
              {submitting ? "Создание..." : "Создать бронирование"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
