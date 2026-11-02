"use client";

import { useState, useCallback, useRef } from "react";
import { reachGoal } from "@/lib/metrika";
import { sendFunnelBeacon } from "@/lib/funnel-beacon";
import { DarkDateNavigator } from "@/components/public/ps-park/dark-date-navigator";
import type { DayAvailability } from "@/modules/ps-park/types";

type Props = {
  initialAvailability: DayAvailability[];
  initialDate: string;
  offer: { slug: string } | null;
};

export function DarkAvailabilityGrid({ initialAvailability, initialDate, offer }: Props) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [email, setEmail] = useState("");
  const [acceptOffer, setAcceptOffer] = useState(false);
  const checkoutRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const submitting = useRef(false);
  const [date, setDate] = useState(initialDate);
  const [availability, setAvailability] = useState(initialAvailability);
  const [loading, setLoading] = useState(false);

  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slotSelectedFired = useRef(false);

  const loadAvailability = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    setSelectedResourceId(null);
    setSelectedSlots([]);
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
    // First-party воронка (US-1 эпика #583, ADR 2026-09-16) — раз за визит.
    if (!slotSelectedFired.current) {
      slotSelectedFired.current = true;
      sendFunnelBeacon("ps-park", "slot_selected");
    }
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
    if (submitting.current || !offer || !acceptOffer || !selectedResourceId || selectedSlots.length === 0) return;
    const sorted = [...selectedSlots].sort();
    const resource = availability.find((a) => a.resource.id === selectedResourceId);
    const lastSlot = resource?.slots.find((s) => s.startTime === sorted[sorted.length - 1]);
    const endTime = lastSlot?.endTime ?? sorted[sorted.length - 1];

    submitting.current = true;
    setBookingLoading(true);
    setError(null);
    reachGoal("pspark_booking_submit");
    const payload = {
      resourceId: selectedResourceId, date, startTime: sorted[0], endTime,
      guestName, guestPhone, email, acceptOffer, offerVersionSlug: offer.slug,
    };
    const fingerprint = JSON.stringify(payload);
    if (checkoutRequest.current?.fingerprint !== fingerprint) {
      checkoutRequest.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const res = await fetch("/api/ps-park/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: checkoutRequest.current.requestId }),
      });
      const data = await res.json();
      if (data.success && data.data?.payment?.confirmationUrl) {
        window.location.assign(data.data.payment.confirmationUrl);
      } else {
        if (["PAYMENT_CANCELED", "CHECKOUT_CHANGED"].includes(data.error?.code)) checkoutRequest.current = null;
        setError(data.error?.message ?? "Не удалось перейти к оплате. Повторите попытку.");
      }
    } catch {
      setError("Не удалось отправить бронирование");
    } finally {
      submitting.current = false;
      setBookingLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-4" data-testid="availability-grid">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <DarkDateNavigator currentDate={date} onChange={loadAvailability} />
          {loading && (
            <span className="text-xs text-zinc-500 animate-pulse">Загрузка...</span>
          )}
        </div>

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
          <form onSubmit={(event) => { event.preventDefault(); void submitBooking(); }} className="space-y-4 rounded-2xl bg-zinc-900 border border-violet-500/40 p-4">
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
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-zinc-300">Имя<input required maxLength={200} autoComplete="name" value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1 block w-full rounded-lg bg-zinc-800 p-2" /></label>
              <label className="text-sm text-zinc-300">Телефон<input required type="tel" pattern="\+7[0-9]{10}" placeholder="+79991234567" autoComplete="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className="mt-1 block w-full rounded-lg bg-zinc-800 p-2" /></label>
              <label className="text-sm text-zinc-300">Email для чека<input required type="email" maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg bg-zinc-800 p-2" /></label>
            </div>
            {offer ? <label className="flex gap-2 text-sm text-zinc-300">
              <input type="checkbox" required checked={acceptOffer} onChange={(e) => setAcceptOffer(e.target.checked)} />
              <span>Согласен с <a className="underline" href={`/ps-park/oferta/${offer.slug}`} target="_blank" rel="noreferrer">офертой Плей Парка</a> и <a className="underline" href="/privacy" target="_blank" rel="noreferrer">политикой обработки данных</a>.</span>
            </label> : <p className="text-sm text-zinc-300">Онлайн-бронирование временно недоступно.</p>}
            <p className="text-xs text-zinc-400">Предоплата 100%. Бронь подтвердится автоматически после успешной оплаты.</p>
            <p className="text-xs text-zinc-400">Изменить планы можно переносом через администратора с сохранением оплаченного времени. Автоматический возврат на сайте не выполняется. Условия и порядок обращений — в оферте.</p>
            <button
              type="submit"
              disabled={bookingLoading || !offer || !acceptOffer}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm px-6 py-2.5 rounded-xl transition-colors"
            >
              {bookingLoading ? "Переходим к оплате…" : "Оплатить"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
