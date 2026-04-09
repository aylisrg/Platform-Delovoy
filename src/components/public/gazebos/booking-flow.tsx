"use client";

import { useState, useCallback } from "react";
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

const ACCENT = "#16A34A";

export function BookingFlow() {
  const [step, setStep] = useState<BookingStep>("date");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "", type: "success", visible: false,
  });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  }, []);

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
        if (idx === 0 || idx === prev.length - 1) return prev.filter((s) => s !== slotStart);
        return prev.slice(0, idx);
      }
      if (prev.length === 0) return [slotStart];
      const allSlots = getAvailableSlots(resourceId);
      const sortedSelected = [...prev].sort();
      const firstIdx = allSlots.indexOf(sortedSelected[0]);
      const lastIdx = allSlots.indexOf(sortedSelected[sortedSelected.length - 1]);
      const newIdx = allSlots.indexOf(slotStart);
      if (newIdx === firstIdx - 1 || newIdx === lastIdx + 1) return [...prev, slotStart].sort();
      return [slotStart];
    });
  }

  function getAvailableSlots(resourceId: string): string[] {
    return availability.find((a) => a.resource.id === resourceId)
      ?.slots.filter((s) => s.isAvailable).map((s) => s.startTime) ?? [];
  }

  function getSelectedResource() {
    return availability.find((a) => a.resource.id === selectedResourceId);
  }

  function getTimeRange() {
    if (selectedSlots.length === 0 || !selectedResourceId) return null;
    const sorted = [...selectedSlots].sort();
    const resource = availability.find((a) => a.resource.id === selectedResourceId);
    if (!resource) return null;
    const lastSlot = resource.slots.find((s) => s.startTime === sorted[sorted.length - 1]);
    return { startTime: sorted[0], endTime: lastSlot?.endTime ?? sorted[sorted.length - 1] };
  }

  function getTotalPrice() {
    const resource = getSelectedResource();
    if (!resource?.resource.pricePerHour) return 0;
    return selectedSlots.length * Number(resource.resource.pricePerHour);
  }

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
        showToast("Бронирование создано!", "success");
      } else {
        showToast(data.error?.message ?? "Ошибка при бронировании", "error");
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

      <div
        className="rounded-[16px] border border-white/5 overflow-hidden"
        style={{ boxShadow: "rgba(0, 153, 255, 0.06) 0px 0px 0px 1px" }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h2
            className="font-[family-name:var(--font-manrope)] font-semibold text-white text-xl"
            style={{ letterSpacing: "-0.4px" }}
          >
            Забронировать беседку
          </h2>
          <StepIndicator current={step} />
        </div>

        {/* Content */}
        <div className="px-6 py-6">

          {/* Step 1: Date */}
          {step === "date" && (
            <div className="space-y-5">
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)]">
                Выберите дату для бронирования
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="booking-date"
                    className="block text-white/60 text-xs font-[family-name:var(--font-inter)] mb-1.5"
                  >
                    Дата
                  </label>
                  <input
                    id="booking-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0099ff] transition-colors [color-scheme:dark]"
                  />
                </div>
                <button
                  onClick={loadAvailability}
                  disabled={loading}
                  className="bg-white text-black font-medium text-sm py-3 px-6 rounded-full hover:bg-white/90 transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {loading ? "Загрузка..." : "Показать доступность"}
                </button>
              </div>
              {error && (
                <p className="text-red-400 text-xs font-[family-name:var(--font-inter)]">{error}</p>
              )}
            </div>
          )}

          {/* Step 2: Slots */}
          {step === "slots" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)]">
                  {formatDate(date)}
                </p>
                <button
                  onClick={() => setStep("date")}
                  className="text-[#0099ff] hover:text-[#0099ff]/80 text-xs font-[family-name:var(--font-inter)] transition-colors"
                >
                  изменить
                </button>
              </div>

              {availability.map((item) => {
                const isSelected = selectedResourceId === item.resource.id;
                const hasAvailable = item.slots.some((s) => s.isAvailable);

                return (
                  <div
                    key={item.resource.id}
                    className={`rounded-[14px] p-5 border transition-all ${
                      isSelected
                        ? "border-[#16A34A]/40 bg-[#16A34A]/[0.04]"
                        : "border-white/5 hover:border-white/10"
                    }`}
                    style={isSelected ? { boxShadow: `${ACCENT}1A 0px 0px 0px 1px` } : {}}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3
                        className="font-[family-name:var(--font-manrope)] font-semibold text-white text-base"
                        style={{ letterSpacing: "-0.3px" }}
                      >
                        {item.resource.name}
                      </h3>
                      {item.resource.capacity && (
                        <span className="text-white/30 text-xs font-[family-name:var(--font-inter)]">
                          до {item.resource.capacity} чел.
                        </span>
                      )}
                      {item.resource.pricePerHour && (
                        <span
                          className="text-xs font-medium px-2.5 py-0.5 rounded-full font-[family-name:var(--font-inter)]"
                          style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                        >
                          {Number(item.resource.pricePerHour)} ₽/час
                        </span>
                      )}
                      {!hasAvailable && (
                        <span className="text-white/30 text-xs font-[family-name:var(--font-inter)] bg-white/5 px-2.5 py-0.5 rounded-full">
                          Всё занято
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.slots.map((slot) => {
                        const isSlotSelected = isSelected && selectedSlots.includes(slot.startTime);
                        return (
                          <button
                            key={slot.startTime}
                            disabled={!slot.isAvailable}
                            onClick={() => toggleSlot(item.resource.id, slot.startTime)}
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition-all font-[family-name:var(--font-inter)] ${
                              isSlotSelected
                                ? "bg-[#16A34A] text-white shadow-lg shadow-[#16A34A]/20"
                                : slot.isAvailable
                                  ? "bg-white/5 text-white/70 border border-white/10 hover:border-white/20 hover:text-white"
                                  : "bg-white/[0.02] text-white/15 cursor-not-allowed"
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
                <div
                  className="rounded-[14px] p-4 border flex flex-wrap items-center justify-between gap-3"
                  style={{
                    backgroundColor: `${ACCENT}08`,
                    borderColor: `${ACCENT}30`,
                  }}
                >
                  <div className="text-sm font-[family-name:var(--font-inter)]">
                    <span className="text-white font-medium">
                      {selectedResource?.resource.name}
                    </span>
                    <span className="text-white/40 mx-2">·</span>
                    <span className="text-white/60">
                      {timeRange.startTime}–{timeRange.endTime} ({selectedSlots.length} ч.)
                    </span>
                    {totalPrice > 0 && (
                      <>
                        <span className="text-white/40 mx-2">·</span>
                        <span className="text-white font-semibold">{totalPrice} ₽</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setStep("form")}
                    className="text-white text-sm font-medium px-5 py-2.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
                    style={{
                      backgroundColor: `${ACCENT}20`,
                      border: `1px solid ${ACCENT}40`,
                    }}
                  >
                    Продолжить →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Form */}
          {step === "form" && selectedResource && timeRange && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="rounded-[14px] border border-white/5 p-5 space-y-2">
                {[
                  ["Беседка", selectedResource.resource.name],
                  ["Дата", formatDate(date)],
                  ["Время", `${timeRange.startTime}–${timeRange.endTime} (${selectedSlots.length} ч.)`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm font-[family-name:var(--font-inter)]">
                    <span className="text-white/40">{label}</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                ))}
                {totalPrice > 0 && (
                  <div className="flex justify-between text-sm font-[family-name:var(--font-inter)] pt-2 border-t border-white/5 mt-2">
                    <span className="text-white/40">Итого</span>
                    <span className="text-white font-bold">{totalPrice} ₽</span>
                  </div>
                )}
              </div>

              {/* Guest count */}
              <div>
                <label
                  htmlFor="guest-count"
                  className="block text-white/60 text-xs font-[family-name:var(--font-inter)] mb-1.5"
                >
                  Количество гостей
                  {selectedResource.resource.capacity && (
                    <span className="text-white/30"> (макс. {selectedResource.resource.capacity})</span>
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0099ff] transition-colors"
                />
              </div>

              {/* Comment */}
              <div>
                <label
                  htmlFor="comment"
                  className="block text-white/60 text-xs font-[family-name:var(--font-inter)] mb-1.5"
                >
                  Комментарий
                </label>
                <textarea
                  id="comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Пожелания, особые условия..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0099ff] transition-colors resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep("slots")}
                  className="bg-white/10 hover:bg-white/15 text-white text-sm px-6 py-3 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium border border-white/10"
                >
                  Назад
                </button>
                <button
                  onClick={submitBooking}
                  disabled={submitting}
                  className="bg-white text-black font-medium text-sm py-3 px-6 rounded-full hover:bg-white/90 transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {submitting ? "Отправка..." : "Забронировать"}
                </button>
              </div>

              <p className="text-white/20 text-xs font-[family-name:var(--font-inter)]">
                После отправки заявки администратор подтвердит бронирование.
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && (
            <div className="text-center py-10 space-y-4">
              <div className="text-[#16A34A] text-4xl mb-2">✓</div>
              <h3
                className="font-[family-name:var(--font-manrope)] font-semibold text-white text-lg"
                style={{ letterSpacing: "-0.3px" }}
              >
                Заявка отправлена!
              </h3>
              <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] max-w-md mx-auto">
                Ваше бронирование ожидает подтверждения администратора.
                Вы получите уведомление, когда бронь будет подтверждена.
              </p>
              <button
                onClick={resetFlow}
                className="bg-white/10 hover:bg-white/15 text-white text-sm px-6 py-3 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium border border-white/10 mt-2"
              >
                Новое бронирование
              </button>
            </div>
          )}
        </div>
      </div>
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
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium font-[family-name:var(--font-inter)] transition-colors ${
                isDone
                  ? "bg-[#16A34A] text-white"
                  : isActive
                    ? "bg-white/10 text-white border border-white/20"
                    : "bg-white/5 text-white/30"
              }`}
            >
              {isDone ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs hidden sm:inline font-[family-name:var(--font-inter)] ${
                isActive ? "text-white" : "text-white/30"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-4 h-px ${isDone ? "bg-[#16A34A]/50" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
}
