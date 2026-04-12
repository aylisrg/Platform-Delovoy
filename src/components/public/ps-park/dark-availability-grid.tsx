"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { AuthModal } from "@/components/ui/auth-modal";
import { DarkDateNavigator } from "@/components/public/ps-park/dark-date-navigator";
import type { DayAvailability } from "@/modules/ps-park/types";
import { pickRandom, TOAST_PS_BOOKING_SUCCESS } from "@/lib/easter-eggs";

type Props = {
  initialAvailability: DayAvailability[];
  initialDate: string;
};

export function DarkAvailabilityGrid({ initialAvailability, initialDate }: Props) {
  const { data: session, status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated" && !!session?.user;

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [availability, setAvailability] = useState(initialAvailability);
  const [loading, setLoading] = useState(false);

  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingSuccessMsg, setBookingSuccessMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadAvailability = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    setSelectedResourceId(null);
    setSelectedSlots([]);
    setBookingSuccess(false);
    setError(null);
    try {
      const res = await fetch(`/api/ps-park/availability?date=${newDate}`);
      const data = await res.json();
      if (data.success) setAvailability(data.data);
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }, []);

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
      const allSlots =
        availability
          .find((a) => a.resource.id === resourceId)
          ?.slots.filter((s) => s.isAvailable)
          .map((s) => s.startTime) ?? [];
      const sortedSelected = [...prev].sort();
      const firstIdx = allSlots.indexOf(sortedSelected[0]);
      const lastIdx = allSlots.indexOf(sortedSelected[sortedSelected.length - 1]);
      const newIdx = allSlots.indexOf(slotStart);
      if (newIdx === firstIdx - 1 || newIdx === lastIdx + 1) return [...prev, slotStart].sort();
      return [slotStart];
    });
  }

  async function submitBooking() {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!selectedResourceId || selectedSlots.length === 0) return;
    const sorted = [...selectedSlots].sort();
    const resource = availability.find((a) => a.resource.id === selectedResourceId);
    const lastSlot = resource?.slots.find((s) => s.startTime === sorted[sorted.length - 1]);
    const endTime = lastSlot?.endTime ?? sorted[sorted.length - 1];

    setBookingLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ps-park/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: selectedResourceId,
          date,
          startTime: sorted[0],
          endTime,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBookingSuccess(true);
        setBookingSuccessMsg(pickRandom(TOAST_PS_BOOKING_SUCCESS));
        setSelectedResourceId(null);
        setSelectedSlots([]);
      } else {
        setError(data.error?.message ?? "Ошибка при бронировании");
      }
    } catch {
      setError("Не удалось отправить бронирование");
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <>
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <DarkDateNavigator currentDate={date} onChange={loadAvailability} />
          {loading && (
            <span className="text-xs text-zinc-500 animate-pulse">Загрузка...</span>
          )}
        </div>

        {bookingSuccess && (
          <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 p-4 text-center">
            <p className="text-violet-300 font-medium text-sm">
              Заявка отправлена! Ожидайте подтверждения от менеджера.
            </p>
            {bookingSuccessMsg && (
              <p className="text-violet-400/70 text-xs mt-1">{bookingSuccessMsg}</p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {availability.map((item) => {
          const isSelected = selectedResourceId === item.resource.id;
          return (
            <div
              key={item.resource.id}
              className={`rounded-2xl border p-5 transition-all ${
                isSelected
                  ? "border-violet-500/60 bg-zinc-900"
                  : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <div className="flex items-center gap-3 mb-4">
                <h3 className="font-semibold text-white text-base">{item.resource.name}</h3>
                {item.resource.capacity && (
                  <span className="text-xs text-zinc-500">
                    до {item.resource.capacity} игроков
                  </span>
                )}
                {item.resource.pricePerHour && (
                  <span className="text-xs font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-0.5">
                    {Number(item.resource.pricePerHour)} ₽/час
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {item.slots.map((slot) => {
                  const isSlotSelected = isSelected && selectedSlots.includes(slot.startTime);
                  return (
                    <button
                      key={slot.startTime}
                      disabled={!slot.isAvailable}
                      onClick={() => toggleSlot(item.resource.id, slot.startTime)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isSlotSelected
                          ? "bg-violet-600 text-white shadow-lg shadow-violet-500/25"
                          : slot.isAvailable
                            ? "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white"
                            : "bg-zinc-900 text-zinc-700 border border-zinc-800 cursor-not-allowed"
                      }`}
                    >
                      {slot.startTime}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {availability.length === 0 && !loading && (
          <p className="text-sm text-zinc-600 text-center py-8">
            Нет доступных столов на эту дату
          </p>
        )}

        {selectedResourceId && selectedSlots.length > 0 && (
          <div className="sticky bottom-4 flex items-center justify-between rounded-2xl bg-zinc-900 border border-violet-500/40 p-4 shadow-2xl shadow-violet-900/20">
            <div className="text-sm text-zinc-300">
              <span className="font-semibold text-white">
                {availability.find((a) => a.resource.id === selectedResourceId)?.resource.name}
              </span>
              <span className="text-zinc-600 mx-2">&middot;</span>
              <span>{selectedSlots.length} ч.</span>
              {(() => {
                const price = availability.find(
                  (a) => a.resource.id === selectedResourceId
                )?.resource.pricePerHour;
                if (!price) return null;
                return (
                  <>
                    <span className="text-zinc-600 mx-2">&middot;</span>
                    <span className="font-bold text-violet-300">
                      {selectedSlots.length * Number(price)} ₽
                    </span>
                  </>
                );
              })()}
            </div>
            <button
              onClick={submitBooking}
              disabled={bookingLoading}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm px-6 py-2.5 rounded-xl transition-colors"
            >
              {bookingLoading ? "Отправка..." : "Забронировать"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
