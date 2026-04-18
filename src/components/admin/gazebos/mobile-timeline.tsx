"use client";

import { useCallback, useState } from "react";
import { DateNavigator } from "@/components/admin/shared/date-navigator";
import { GazeboMobileBookingSheet } from "./mobile-booking-sheet";
import { GazeboBookingDetailCard } from "./booking-detail-card";
import {
  generateHalfHourSlots,
  getMaxEndFromBookings,
  isSlotFree,
} from "@/lib/booking-time";
import type { TimelineData, TimelineBooking } from "@/modules/gazebos/types";

const MOSCOW_TZ = "Europe/Moscow";

function toHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone: MOSCOW_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SlotState = {
  resourceId: string;
  resourceName: string;
  startTime: string;
  maxEndTime: string;
  pricePerHour: number | null;
} | null;

type Props = {
  initialData: TimelineData;
  initialDate: string;
};

export function GazeboMobileTimeline({ initialData, initialDate }: Props) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState<SlotState>(null);
  const [selectedBooking, setSelectedBooking] =
    useState<TimelineBooking | null>(null);

  const slots = generateHalfHourSlots();

  const loadTimeline = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/gazebos/timeline?date=${newDate}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }, []);

  function getResourceBookings(resourceId: string) {
    return data.bookings
      .filter((b) => b.resourceId === resourceId)
      .map((b) => ({
        id: b.id,
        booking: b,
        startHHMM: toHHMM(b.startTime),
        endHHMM: toHHMM(b.endTime),
      }));
  }

  function handleSlotClick(resourceId: string, startHHMM: string) {
    const bookings = getResourceBookings(resourceId).map((b) => ({
      startHHMM: b.startHHMM,
      endHHMM: b.endHHMM,
    }));
    if (!isSlotFree(startHHMM, bookings)) return;
    const resource = data.resources.find((r) => r.id === resourceId);
    if (!resource) return;
    setSlot({
      resourceId,
      resourceName: resource.name,
      startTime: startHHMM,
      maxEndTime: getMaxEndFromBookings(startHHMM, bookings),
      pricePerHour: resource.pricePerHour ? Number(resource.pricePerHour) : null,
    });
  }

  function handleCreated() {
    setSlot(null);
    loadTimeline(date);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <DateNavigator currentDate={date} onChange={loadTimeline} />
        {loading && (
          <span className="text-xs text-zinc-400 animate-pulse whitespace-nowrap">
            Загрузка...
          </span>
        )}
      </div>

      {data.resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
          Нет активных беседок
        </div>
      ) : (
        <ul className="space-y-3">
          {data.resources.map((resource) => {
            const bookings = getResourceBookings(resource.id);
            const bookingsHHMM = bookings.map((b) => ({
              startHHMM: b.startHHMM,
              endHHMM: b.endHHMM,
            }));
            return (
              <li
                key={resource.id}
                className="rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <div className="flex items-start justify-between px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900">
                      {resource.name}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {resource.capacity && `${resource.capacity} чел.`}
                      {resource.capacity && resource.pricePerHour && " · "}
                      {resource.pricePerHour &&
                        `${Number(resource.pricePerHour)} ₽/ч`}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto px-3 pb-3 snap-x">
                  {slots.map((s) => {
                    const free = isSlotFree(s, bookingsHHMM);
                    const activeBooking = bookings.find((b) => {
                      return b.startHHMM <= s && s < b.endHHMM;
                    });
                    if (activeBooking) {
                      const isStart = activeBooking.startHHMM === s;
                      if (!isStart) return null;
                      const startIdx = slots.indexOf(activeBooking.startHHMM);
                      const endIdx = slots.findIndex(
                        (x) => x >= activeBooking.endHHMM,
                      );
                      const span = (endIdx === -1 ? slots.length : endIdx) - startIdx;
                      const widthPx = span * 72 + (span - 1) * 8;
                      const isPending = activeBooking.booking.status === "PENDING";
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            setSelectedBooking(activeBooking.booking)
                          }
                          style={{ minWidth: `${widthPx}px` }}
                          className={`flex h-14 flex-col items-center justify-center rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap snap-start ${
                            isPending
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-emerald-300 bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          <span className="truncate max-w-[200px]">
                            {activeBooking.booking.clientName ?? "—"}
                          </span>
                          <span className="tabular-nums text-[10px] opacity-70">
                            {activeBooking.startHHMM}–{activeBooking.endHHMM}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!free}
                        onClick={() => handleSlotClick(resource.id, s)}
                        className={`flex h-14 min-w-[72px] shrink-0 items-center justify-center rounded-lg border text-sm font-medium tabular-nums snap-start transition-colors ${
                          free
                            ? "border-zinc-200 bg-white text-zinc-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100"
                            : "border-zinc-100 bg-zinc-50 text-zinc-300 cursor-not-allowed"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {slot && (
        <GazeboMobileBookingSheet
          open={true}
          onClose={() => setSlot(null)}
          onCreated={handleCreated}
          resourceId={slot.resourceId}
          resourceName={slot.resourceName}
          date={date}
          startTime={slot.startTime}
          maxEndTime={slot.maxEndTime}
          pricePerHour={slot.pricePerHour}
        />
      )}

      {selectedBooking && (
        <GazeboBookingDetailCard
          booking={selectedBooking}
          resourceName={
            data.resources.find((r) => r.id === selectedBooking.resourceId)
              ?.name ?? "—"
          }
          pricePerHour={(() => {
            const r = data.resources.find(
              (r) => r.id === selectedBooking.resourceId,
            );
            return r?.pricePerHour ? Number(r.pricePerHour) : null;
          })()}
          isActiveNow={false}
          onClose={() => setSelectedBooking(null)}
          onStatusChanged={() => {
            setSelectedBooking(null);
            loadTimeline(date);
          }}
        />
      )}
    </div>
  );
}
