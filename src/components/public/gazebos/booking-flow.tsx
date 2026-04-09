"use client";

import { useState, useCallback } from "react";
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

type BookingStep = "date" | "slots" | "form" | "done";

export function BookingFlow() {
  // Step state
  const [step, setStep] = useState<BookingStep>("date");

  // Date selection
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  // Availability data
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected resource & slots
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);

  // Form data
  const [guestCount, setGuestCount] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  }, []);

  // Load availability for selected date
  async function loadAvailability() {
    setLoading(true);
    setError(null);
    setSelectedResourceId(null);
    setSelectedSlots([]);

    try {
      const res = await fetch(`/api/gazebos/availability?date=${date}`);
      const data = await res.json();
      if (data.success) {
        setAvailability(data.data);
        setStep("slots");
      } else {
        setError(data.error?.message ?? "Ошибка загрузки");
      }
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  // Toggle slot selection (only consecutive slots allowed)
  function toggleSlot(resourceId: string, slotStart: string) {
    // If switching resource, reset selection
    if (selectedResourceId && selectedResourceId !== resourceId) {
      setSelectedResourceId(resourceId);
      setSelectedSlots([slotStart]);
      return;
    }

    setSelectedResourceId(resourceId);

    setSelectedSlots((prev) => {
      if (prev.includes(slotStart)) {
        // Deselect: only allow removing from edges
        const idx = prev.indexOf(slotStart);
        if (idx === 0 || idx === prev.length - 1) {
          return prev.filter((s) => s !== slotStart);
        }
        // Can't deselect middle slot — deselect all after it
        return prev.slice(0, idx);
      }

      // Select: must be adjacent to existing selection
      if (prev.length === 0) return [slotStart];

      const allSlots = getResourceSlots(resourceId);
      const sortedSelected = [...prev].sort();
      const firstIdx = allSlots.indexOf(sortedSelected[0]);
      const lastIdx = allSlots.indexOf(sortedSelected[sortedSelected.length - 1]);
      const newIdx = allSlots.indexOf(slotStart);

      // Allow extending from either end
      if (newIdx === firstIdx - 1 || newIdx === lastIdx + 1) {
        // Check all slots in between are available
        const newSorted = [...prev, slotStart].sort();
        return newSorted;
      }

      // Not adjacent — start new selection
      return [slotStart];
    });
  }

  function getResourceSlots(resourceId: string): string[] {
    const resource = availability.find((a) => a.resource.id === resourceId);
    if (!resource) return [];
    return resource.slots.filter((s) => s.isAvailable).map((s) => s.startTime);
  }

  function getSelectedResource() {
    return availability.find((a) => a.resource.id === selectedResourceId);
  }

  function getTimeRange(): { startTime: string; endTime: string } | null {
    if (selectedSlots.length === 0 || !selectedResourceId) return null;
    const sorted = [...selectedSlots].sort();
    const resource = availability.find((a) => a.resource.id === selectedResourceId);
    if (!resource) return null;

    const lastSlot = resource.slots.find((s) => s.startTime === sorted[sorted.length - 1]);
    return {
      startTime: sorted[0],
      endTime: lastSlot?.endTime ?? sorted[sorted.length - 1],
    };
  }

  function getTotalPrice(): number {
    const resource = getSelectedResource();
    if (!resource || !resource.resource.pricePerHour) return 0;
    return selectedSlots.length * Number(resource.resource.pricePerHour);
  }

  // Submit booking
  async function submitBooking() {
    const timeRange = getTimeRange();
    if (!selectedResourceId || !timeRange) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/gazebos/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: selectedResourceId,
          date,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          ...(guestCount && { guestCount: parseInt(guestCount, 10) }),
          ...(comment && { comment }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStep("done");
        showToast("Бронирование создано! Ожидайте подтверждения администратора.", "success");
      } else {
        if (res.status === 401) {
          showToast("Для бронирования необходимо войти в аккаунт", "error");
        } else {
          showToast(data.error?.message ?? "Ошибка при бронировании", "error");
        }
      }
    } catch {
      showToast("Не удалось отправить бронирование", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetFlow() {
    setStep("date");
    setSelectedResourceId(null);
    setSelectedSlots([]);
    setGuestCount("");
    setComment("");
    setAvailability([]);
  }

  const selectedResource = getSelectedResource();
  const timeRange = getTimeRange();
  const totalPrice = getTotalPrice();

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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">Забронировать беседку</h2>
            <StepIndicator current={step} />
          </div>
        </CardHeader>

        <CardContent>
          {/* Step 1: Select date */}
          {step === "date" && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600">Выберите дату для бронирования</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="booking-date" className="block text-sm font-medium text-zinc-700 mb-1">
                    Дата
                  </label>
                  <input
                    id="booking-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <Button onClick={loadAvailability} disabled={loading}>
                  {loading ? "Загрузка..." : "Показать доступность"}
                </Button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}

          {/* Step 2: Select gazebo & slots */}
          {step === "slots" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-600">
                  Дата: <span className="font-medium text-zinc-900">{formatDate(date)}</span>
                  <button
                    onClick={() => setStep("date")}
                    className="ml-2 text-blue-600 hover:underline text-xs"
                  >
                    изменить
                  </button>
                </p>
              </div>

              {availability.map((item) => {
                const isSelected = selectedResourceId === item.resource.id;
                const hasAvailable = item.slots.some((s) => s.isAvailable);

                return (
                  <div
                    key={item.resource.id}
                    className={`rounded-xl border-2 p-4 transition-colors ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/50"
                        : "border-zinc-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3 className="font-semibold text-zinc-900">{item.resource.name}</h3>
                      {item.resource.capacity && (
                        <span className="text-xs text-zinc-500">
                          до {item.resource.capacity} чел.
                        </span>
                      )}
                      {item.resource.pricePerHour && (
                        <Badge variant="info">{Number(item.resource.pricePerHour)} ₽/час</Badge>
                      )}
                      {!hasAvailable && (
                        <Badge variant="default">Всё занято</Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.slots.map((slot) => {
                        const isSlotSelected =
                          isSelected && selectedSlots.includes(slot.startTime);

                        return (
                          <button
                            key={slot.startTime}
                            disabled={!slot.isAvailable}
                            onClick={() => toggleSlot(item.resource.id, slot.startTime)}
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                              isSlotSelected
                                ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-300"
                                : slot.isAvailable
                                  ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 hover:border-green-300"
                                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                            }`}
                          >
                            {slot.startTime}–{slot.endTime}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Selection summary */}
              {selectedResourceId && selectedSlots.length > 0 && timeRange && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className="font-medium text-zinc-900">
                        {selectedResource?.resource.name}
                      </span>
                      {" · "}
                      <span className="text-zinc-600">
                        {timeRange.startTime}–{timeRange.endTime} ({selectedSlots.length} ч.)
                      </span>
                      {totalPrice > 0 && (
                        <>
                          {" · "}
                          <span className="font-semibold text-zinc-900">{totalPrice} ₽</span>
                        </>
                      )}
                    </div>
                    <Button onClick={() => setStep("form")} size="sm">
                      Продолжить
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Booking form */}
          {step === "form" && selectedResource && timeRange && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4">
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Беседка</span>
                    <span className="font-medium text-zinc-900">{selectedResource.resource.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Дата</span>
                    <span className="font-medium text-zinc-900">{formatDate(date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Время</span>
                    <span className="font-medium text-zinc-900">
                      {timeRange.startTime}–{timeRange.endTime} ({selectedSlots.length} ч.)
                    </span>
                  </div>
                  {totalPrice > 0 && (
                    <div className="flex justify-between pt-1 border-t border-zinc-200 mt-1">
                      <span className="text-zinc-500">Итого</span>
                      <span className="font-bold text-zinc-900">{totalPrice} ₽</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Guest count */}
              <div>
                <label htmlFor="guest-count" className="block text-sm font-medium text-zinc-700 mb-1">
                  Количество гостей
                  {selectedResource.resource.capacity && (
                    <span className="text-zinc-400 font-normal"> (макс. {selectedResource.resource.capacity})</span>
                  )}
                </label>
                <input
                  id="guest-count"
                  type="number"
                  min="1"
                  max={selectedResource.resource.capacity ?? undefined}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  placeholder="Необязательно"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Comment */}
              <div>
                <label htmlFor="comment" className="block text-sm font-medium text-zinc-700 mb-1">
                  Комментарий
                </label>
                <textarea
                  id="comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Пожелания, особые условия..."
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep("slots")}>
                  Назад
                </Button>
                <Button onClick={submitBooking} disabled={submitting}>
                  {submitting ? "Отправка..." : "Забронировать"}
                </Button>
              </div>

              <p className="text-xs text-zinc-400">
                После отправки заявки администратор подтвердит бронирование.
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-zinc-900">Заявка отправлена!</h3>
              <p className="text-sm text-zinc-600 max-w-md mx-auto">
                Ваше бронирование ожидает подтверждения администратора.
                Вы получите уведомление, когда бронь будет подтверждена.
              </p>
              <Button variant="secondary" onClick={resetFlow}>
                Новое бронирование
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StepIndicator({ current }: { current: BookingStep }) {
  const steps: { key: BookingStep; label: string }[] = [
    { key: "date", label: "Дата" },
    { key: "slots", label: "Время" },
    { key: "form", label: "Детали" },
  ];

  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const isDone = current === "done" || i < currentIdx;
        const isActive = s.key === current;

        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                isDone
                  ? "bg-green-500 text-white"
                  : isActive
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 text-zinc-500"
              }`}
            >
              {isDone ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs hidden sm:inline ${isActive ? "text-zinc-900 font-medium" : "text-zinc-400"}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-4 h-px ${isDone ? "bg-green-400" : "bg-zinc-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}
