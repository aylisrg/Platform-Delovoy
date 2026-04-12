"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthModal } from "@/components/ui/auth-modal";
import { DateNavigator } from "@/components/admin/ps-park/date-navigator";
import type { DayAvailability } from "@/modules/ps-park/types";

type PublicAvailabilityGridProps = {
  initialAvailability: DayAvailability[];
  initialDate: string;
};

export function PublicAvailabilityGrid({
  initialAvailability,
  initialDate,
}: PublicAvailabilityGridProps) {
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
      const allSlots = availability.find((a) => a.resource.id === resourceId)
        ?.slots.filter((s) => s.isAvailable).map((s) => s.startTime) ?? [];
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

      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <DateNavigator currentDate={date} onChange={loadAvailability} />
          {loading && (
            <span className="text-xs text-zinc-400 animate-pulse">Загрузка...</span>
          )}
        </div>

        {bookingSuccess && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-medium text-sm">
              Заявка отправлена! Ожидайте подтверждения от менеджера.
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Grid: tables x time slots */}
        {availability.map((item) => {
          const isSelected = selectedResourceId === item.resource.id;
          return (
            <Card
              key={item.resource.id}
              className={`transition-all ${isSelected ? "border-blue-300 shadow-md" : ""}`}
            >
              <CardContent>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-zinc-900">{item.resource.name}</h3>
                  {item.resource.capacity && (
                    <span className="text-xs text-zinc-400">
                      до {item.resource.capacity} игроков
                    </span>
                  )}
                  {item.resource.pricePerHour && (
                    <Badge variant="info">
                      {Number(item.resource.pricePerHour)} ₽/час
                    </Badge>
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
                            ? "bg-blue-600 text-white shadow-md"
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
              </CardContent>
            </Card>
          );
        })}

        {availability.length === 0 && !loading && (
          <p className="text-sm text-zinc-400 text-center py-8">
            Нет доступных столов на эту дату
          </p>
        )}

        {/* Booking action bar */}
        {selectedResourceId && selectedSlots.length > 0 && (
          <div className="sticky bottom-4 flex items-center justify-between rounded-xl bg-blue-50 border border-blue-200 p-4 shadow-lg">
            <div className="text-sm text-zinc-700">
              <span className="font-medium">
                {availability.find((a) => a.resource.id === selectedResourceId)?.resource.name}
              </span>
              <span className="text-zinc-400 mx-2">&middot;</span>
              <span>{selectedSlots.length} ч.</span>
              {(() => {
                const price = availability.find((a) => a.resource.id === selectedResourceId)?.resource.pricePerHour;
                if (!price) return null;
                return (
                  <>
                    <span className="text-zinc-400 mx-2">&middot;</span>
                    <span className="font-semibold">{selectedSlots.length * Number(price)} ₽</span>
                  </>
                );
              })()}
            </div>
            <Button onClick={submitBooking} disabled={bookingLoading}>
              {bookingLoading ? "Отправка..." : "Забронировать"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
