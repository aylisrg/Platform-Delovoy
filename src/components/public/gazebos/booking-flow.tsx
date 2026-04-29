"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { reachGoal } from "@/lib/metrika";
import { Toast } from "@/components/ui/toast";
import { AuthModal } from "@/components/ui/auth-modal";
import { InventoryItemPicker, type BookingItem, itemsToPayload } from "@/components/inventory-item-picker";
import { pickRandom, TOAST_BOOKING_SUCCESS } from "@/lib/easter-eggs";
import { formatDate as formatDateUnified } from "@/lib/format";

type TimeSlot = {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
};

type ResourcePricing = {
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
  hourRate: number;
  dayRate: number;
  isWeekend: boolean;
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
  pricing: ResourcePricing | null;
};

type BookingStep = "date" | "slots" | "form" | "done";

const ACCENT = "#16A34A";

export function BookingFlow() {
  const { data: session, status: sessionStatus } = useSession();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [step, setStep] = useState<BookingStep>("date");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState("");
  const [comment, setComment] = useState("");
  const [selectedItems, setSelectedItems] = useState<BookingItem[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "", type: "success", visible: false,
  });

  const isAuthenticated = sessionStatus === "authenticated" && !!session?.user;

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

  function getPriceBreakdown() {
    const resource = getSelectedResource();
    const hours = selectedSlots.length;
    if (!resource || hours === 0) return null;
    const pricing = resource.pricing;
    if (pricing) {
      const hourlyTotal = hours * pricing.hourRate;
      const useDayRate = pricing.dayRate > 0 && pricing.dayRate < hourlyTotal;
      const total = useDayRate ? pricing.dayRate : hourlyTotal;
      return {
        hours,
        hourRate: pricing.hourRate,
        dayRate: pricing.dayRate,
        isWeekend: pricing.isWeekend,
        hourlyTotal,
        total,
        appliedDayRate: useDayRate,
        savings: useDayRate ? hourlyTotal - pricing.dayRate : 0,
      };
    }
    // Fallback for resources without priceList
    if (!resource.resource.pricePerHour) return null;
    const rate = Number(resource.resource.pricePerHour);
    const total = hours * rate;
    return {
      hours,
      hourRate: rate,
      dayRate: 0,
      isWeekend: false,
      hourlyTotal: total,
      total,
      appliedDayRate: false,
      savings: 0,
    };
  }

  async function submitBooking() {
    const timeRange = getTimeRange();
    if (!selectedResourceId || !timeRange) return;
    setSubmitting(true);
    reachGoal("gazebo_booking_submit");
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
          items: itemsToPayload(selectedItems),
          ...(!isAuthenticated && { guestName: guestName.trim(), guestPhone: guestPhone.trim() }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        reachGoal("gazebo_booking_success");
        setStep("done");
        showToast(pickRandom(TOAST_BOOKING_SUCCESS), "success");
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
    setSelectedItems([]);
    setAvailability([]);
    setGuestName("");
    setGuestPhone("");
  }

  const selectedResource = getSelectedResource();
  const timeRange = getTimeRange();
  const breakdown = getPriceBreakdown();
  const totalPrice = breakdown?.total ?? 0;
  const fmtRub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

  return (
    <>
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />

      <div className="rounded-2xl border border-black/[0.08] overflow-hidden bg-white">
        {/* Header */}
        <div className="px-6 py-5 border-b border-black/[0.04] flex items-center justify-between">
          <h2
            className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-xl"
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
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)]">
                Выберите дату для бронирования
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="booking-date"
                    className="block text-[#86868b] text-xs font-[family-name:var(--font-inter)] mb-1.5"
                  >
                    Дата
                  </label>
                  <input
                    id="booking-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 transition-colors"
                  />
                </div>
                <button
                  onClick={loadAvailability}
                  disabled={loading}
                  className="bg-[#0071e3] text-white font-medium text-sm py-3 px-6 rounded-full hover:bg-[#0077ED] transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {loading ? "Загрузка..." : "Показать доступность"}
                </button>
              </div>
              {error && (
                <p className="text-red-500 text-xs font-[family-name:var(--font-inter)]">{error}</p>
              )}
            </div>
          )}

          {/* Step 2: Slots */}
          {step === "slots" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)]">
                  {formatDate(date)}
                </p>
                <button
                  onClick={() => setStep("date")}
                  className="text-[#0071e3] hover:text-[#0071e3]/80 text-xs font-[family-name:var(--font-inter)] transition-colors"
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
                    className={`rounded-2xl p-5 border transition-all ${
                      isSelected
                        ? "border-[#16A34A]/40 bg-[#16A34A]/[0.04]"
                        : "border-black/[0.06] hover:border-black/[0.12]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3
                        className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-base"
                        style={{ letterSpacing: "-0.3px" }}
                      >
                        {item.resource.name}
                      </h3>
                      {item.resource.capacity && (
                        <span className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">
                          до {item.resource.capacity} чел.
                        </span>
                      )}
                      {item.pricing ? (
                        <span
                          className="text-xs font-medium px-2.5 py-0.5 rounded-full font-[family-name:var(--font-inter)]"
                          style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                          title={item.pricing.isWeekend ? "Тариф Пт-Вс" : "Тариф Пн-Чт"}
                        >
                          {item.pricing.hourRate.toLocaleString("ru-RU")} ₽/час
                          <span className="text-[10px] opacity-70 ml-1">
                            · {item.pricing.isWeekend ? "Пт–Вс" : "Пн–Чт"}
                          </span>
                        </span>
                      ) : item.resource.pricePerHour ? (
                        <span
                          className="text-xs font-medium px-2.5 py-0.5 rounded-full font-[family-name:var(--font-inter)]"
                          style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                        >
                          {Number(item.resource.pricePerHour)} ₽/час
                        </span>
                      ) : null}
                      {!hasAvailable && (
                        <span className="text-[#86868b] text-xs font-[family-name:var(--font-inter)] bg-[#f5f5f7] px-2.5 py-0.5 rounded-full">
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
                                  ? "bg-[#f5f5f7] text-[#1d1d1f]/70 border border-black/[0.06] hover:border-black/[0.12]"
                                  : "bg-[#f5f5f7]/50 text-[#1d1d1f]/20 cursor-not-allowed"
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
                  className="rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-3 bg-[#16A34A]/[0.04] border-[#16A34A]/20"
                >
                  <div className="text-sm font-[family-name:var(--font-inter)]">
                    <span className="text-[#1d1d1f] font-medium">
                      {selectedResource?.resource.name}
                    </span>
                    <span className="text-[#86868b] mx-2">·</span>
                    <span className="text-[#86868b]">
                      {timeRange.startTime}–{timeRange.endTime} ({selectedSlots.length} ч.)
                    </span>
                    {totalPrice > 0 && (
                      <>
                        <span className="text-[#86868b] mx-2">·</span>
                        <span className="text-[#1d1d1f] font-semibold">{fmtRub(totalPrice)}</span>
                        {breakdown?.appliedDayRate && (
                          <span
                            className="ml-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                          >
                            дневной тариф · −{fmtRub(breakdown.savings)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setStep("form")}
                    className="text-white text-sm font-medium px-5 py-2.5 rounded-full transition-all font-[family-name:var(--font-inter)]"
                    style={{
                      backgroundColor: ACCENT,
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
              <div className="rounded-2xl border border-black/[0.08] p-5 space-y-2">
                {[
                  ["Беседка", selectedResource.resource.name],
                  ["Дата", formatDate(date)],
                  ["Время", `${timeRange.startTime}–${timeRange.endTime} (${selectedSlots.length} ч.)`],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between text-sm font-[family-name:var(--font-inter)]">
                    <span className="text-[#86868b]">{label}</span>
                    <span className="text-[#1d1d1f] font-medium">{val}</span>
                  </div>
                ))}
                {breakdown && breakdown.total > 0 && (
                  <div className="pt-2 border-t border-black/[0.04] mt-2 space-y-1.5 font-[family-name:var(--font-inter)] text-sm">
                    {breakdown.appliedDayRate ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[#86868b]">
                            Дневной тариф{" "}
                            <span className="text-[#86868b]/60 text-xs">
                              ({breakdown.isWeekend ? "Пт–Вс" : "Пн–Чт"})
                            </span>
                          </span>
                          <span className="text-[#1d1d1f] font-medium">{fmtRub(breakdown.dayRate)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[#86868b]/70 line-through">
                            {breakdown.hours} ч × {fmtRub(breakdown.hourRate)}
                          </span>
                          <span style={{ color: ACCENT }} className="font-medium">
                            экономия {fmtRub(breakdown.savings)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-[#86868b]">
                          {breakdown.hours} ч × {fmtRub(breakdown.hourRate)}{" "}
                          <span className="text-[#86868b]/60 text-xs">
                            ({breakdown.isWeekend ? "Пт–Вс" : "Пн–Чт"})
                          </span>
                        </span>
                        <span className="text-[#1d1d1f] font-medium">{fmtRub(breakdown.total)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inventory item picker */}
              <InventoryItemPicker value={selectedItems} onChange={setSelectedItems} />

              {/* Guest count */}
              <div>
                <label
                  htmlFor="guest-count"
                  className="block text-[#86868b] text-xs font-[family-name:var(--font-inter)] mb-1.5"
                >
                  Количество гостей
                  {selectedResource.resource.capacity && (
                    <span className="text-[#86868b]/50"> (макс. {selectedResource.resource.capacity})</span>
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
                  className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b]/50 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 transition-colors"
                />
              </div>

              {/* Comment */}
              <div>
                <label
                  htmlFor="comment"
                  className="block text-[#86868b] text-xs font-[family-name:var(--font-inter)] mb-1.5"
                >
                  Комментарий
                </label>
                <textarea
                  id="comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Пожелания, особые условия..."
                  className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b]/50 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 transition-colors resize-none"
                />
              </div>

              {/* Guest contacts — only when not authenticated */}
              {!isAuthenticated && (
                <div className="rounded-2xl bg-[#f5f5f7] border border-black/[0.04] p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[#1d1d1f] text-sm font-medium font-[family-name:var(--font-inter)]">
                        Бронирование без регистрации
                      </p>
                      <p className="text-[#86868b] text-xs mt-0.5 font-[family-name:var(--font-inter)]">
                        Администратор свяжется с вами по телефону для подтверждения
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAuthModal(true)}
                      className="text-[#0071e3] text-xs font-medium hover:underline font-[family-name:var(--font-inter)] shrink-0 mt-0.5"
                    >
                      Войти вместо этого
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="guest-name"
                        className="block text-[#86868b] text-xs font-[family-name:var(--font-inter)] mb-1.5"
                      >
                        Ваше имя
                      </label>
                      <input
                        id="guest-name"
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Иван"
                        required
                        autoComplete="name"
                        className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b]/50 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 transition-colors"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="guest-phone"
                        className="block text-[#86868b] text-xs font-[family-name:var(--font-inter)] mb-1.5"
                      >
                        Телефон
                      </label>
                      <input
                        id="guest-phone"
                        type="tel"
                        value={guestPhone}
                        onChange={(e) => setGuestPhone(e.target.value)}
                        placeholder="+7 (___) ___-__-__"
                        required
                        autoComplete="tel"
                        className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b]/50 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep("slots")}
                  className="bg-[#1d1d1f]/[0.06] hover:bg-[#1d1d1f]/[0.1] text-[#1d1d1f] text-sm px-6 py-3 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium"
                >
                  Назад
                </button>
                <button
                  onClick={submitBooking}
                  disabled={
                    submitting ||
                    (!isAuthenticated && (!guestName.trim() || !guestPhone.trim()))
                  }
                  className="bg-[#0071e3] text-white font-medium text-sm py-3 px-6 rounded-full hover:bg-[#0077ED] transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {submitting ? "Отправка..." : "Забронировать"}
                </button>
              </div>

              <p className="text-[#86868b]/60 text-xs font-[family-name:var(--font-inter)]">
                После отправки заявки администратор подтвердит бронирование.
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && (
            <div className="text-center py-10 space-y-4">
              <div className="text-[#16A34A] text-4xl mb-2">✓</div>
              <h3
                className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-lg"
                style={{ letterSpacing: "-0.3px" }}
              >
                Заявка отправлена!
              </h3>
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] max-w-md mx-auto">
                Ваше бронирование ожидает подтверждения администратора.
                {isAuthenticated
                  ? " Вы получите уведомление, когда бронь будет подтверждена."
                  : " Мы позвоним вам для подтверждения."}
              </p>

              {!isAuthenticated && (
                <div className="mx-auto max-w-md rounded-2xl border border-[#0071e3]/20 bg-[#0071e3]/[0.04] p-4 text-left">
                  <p className="text-[#1d1d1f] text-sm font-medium font-[family-name:var(--font-inter)]">
                    Получайте уведомления автоматически
                  </p>
                  <p className="text-[#86868b] text-xs mt-1 mb-3 font-[family-name:var(--font-inter)]">
                    Войдите через Telegram или Яндекс — статус брони придёт сам, не придётся ждать звонка.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAuthModal(true)}
                    className="bg-[#0071e3] text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-[#0077ED] transition-all font-[family-name:var(--font-inter)]"
                  >
                    Подключить уведомления
                  </button>
                </div>
              )}

              <button
                onClick={resetFlow}
                className="bg-[#1d1d1f]/[0.06] hover:bg-[#1d1d1f]/[0.1] text-[#1d1d1f] text-sm px-6 py-3 rounded-full transition-all font-[family-name:var(--font-inter)] font-medium mt-2"
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
                    ? "bg-[#1d1d1f]/10 text-[#1d1d1f] border border-black/[0.1]"
                    : "bg-[#f5f5f7] text-[#86868b]"
              }`}
            >
              {isDone ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs hidden sm:inline font-[family-name:var(--font-inter)] ${
                isActive ? "text-[#1d1d1f]" : "text-[#86868b]"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-4 h-px ${isDone ? "bg-[#16A34A]/50" : "bg-black/[0.08]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  return formatDateUnified(dateStr + "T00:00:00");
}
