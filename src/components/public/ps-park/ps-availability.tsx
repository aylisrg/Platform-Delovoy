"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthModal } from "@/components/ui/auth-modal";
import { InventoryItemPicker, type BookingItem, itemsToPayload } from "@/components/inventory-item-picker";

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

export function PSAvailability() {
  const { data: session, status: sessionStatus } = useSession();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<BookingItem[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);

  const isAuthenticated = sessionStatus === "authenticated" && !!session?.user;

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
    try {
      const res = await fetch("/api/ps-park/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: selectedResourceId,
          date,
          startTime: sorted[0],
          endTime,
          items: itemsToPayload(selectedItems),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBookingSuccess(true);
        setSelectedResourceId(null);
        setSelectedSlots([]);
        setSelectedItems([]);
      } else {
        setError(data.error?.message ?? "Ошибка при бронировании");
      }
    } catch {
      setError("Не удалось отправить бронирование");
    } finally {
      setBookingLoading(false);
    }
  }

  async function checkAvailability() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ps-park/availability?date=${date}`);
      const data = await res.json();
      if (data.success) {
        setAvailability(data.data);
      } else {
        setError(data.error?.message ?? "Ошибка загрузки");
      }
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-zinc-700">
                Дата
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setBookingSuccess(false); }}
                min={new Date().toISOString().split("T")[0]}
                className="mt-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button onClick={checkAvailability} disabled={loading}>
              {loading ? "Загрузка..." : "Проверить"}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          {bookingSuccess && (
            <div className="mb-4 rounded-xl bg-green-50 border border-green-200 p-4 text-center">
              <p className="text-green-700 font-medium text-sm">Заявка отправлена! Ожидайте подтверждения.</p>
            </div>
          )}

          {availability.length === 0 && !loading && !error && (
            <p className="text-sm text-zinc-400">
              Выберите дату и нажмите «Проверить» для просмотра доступных слотов
            </p>
          )}

          {availability.map((item) => {
            const isSelected = selectedResourceId === item.resource.id;
            return (
              <div key={item.resource.id} className={`mb-6 last:mb-0 rounded-xl p-4 transition-all ${isSelected ? "bg-blue-50/50 border border-blue-200" : ""}`}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-zinc-900">{item.resource.name}</h3>
                  {item.resource.capacity && (
                    <span className="text-xs text-zinc-400">
                      до {item.resource.capacity} игроков
                    </span>
                  )}
                  {item.resource.pricePerHour && (
                    <Badge variant="info">{Number(item.resource.pricePerHour)} ₽/час</Badge>
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
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          isSlotSelected
                            ? "bg-blue-600 text-white shadow-md"
                            : slot.isAvailable
                              ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
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

          {/* Booking action */}
          {selectedResourceId && selectedSlots.length > 0 && (
            <div className="mt-4 space-y-3">
              {/* Items picker */}
              <div className="rounded-xl border border-zinc-200 p-4">
                <InventoryItemPicker
                  value={selectedItems}
                  onChange={setSelectedItems}
                  variant="compact"
                />
              </div>

              {/* Summary + submit */}
              <div className="flex items-center justify-between rounded-xl bg-blue-50 border border-blue-200 p-4">
                <div className="text-sm text-zinc-700">
                  <span className="font-medium">
                    {availability.find((a) => a.resource.id === selectedResourceId)?.resource.name}
                  </span>
                  <span className="text-zinc-400 mx-2">·</span>
                  <span>{selectedSlots.length} ч.</span>
                  {(() => {
                    const price = availability.find((a) => a.resource.id === selectedResourceId)?.resource.pricePerHour;
                    if (!price) return null;
                    return (
                      <>
                        <span className="text-zinc-400 mx-2">·</span>
                        <span className="font-semibold">{selectedSlots.length * Number(price)} ₽</span>
                      </>
                    );
                  })()}
                  {selectedItems.length > 0 && (
                    <span className="text-zinc-400 ml-2">+ товары</span>
                  )}
                </div>
                <Button onClick={submitBooking} disabled={bookingLoading}>
                  {bookingLoading ? "Отправка..." : "Забронировать"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
