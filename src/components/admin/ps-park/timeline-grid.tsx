"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { DateNavigator } from "./date-navigator";
import { QuickBookingPopover } from "./quick-booking-popover";
import { BookingDetailCard } from "./booking-detail-card";
import type { TimelineData, TimelineBooking } from "@/modules/ps-park/types";

type TimelineGridProps = {
  initialData: TimelineData;
  initialDate: string;
};

type PopoverState = {
  resourceId: string;
  resourceName: string;
  startTime: string;
  pricePerHour: number | null;
  availableConsecutiveSlots: number;
} | null;

const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;

export function TimelineGrid({ initialData, initialDate }: TimelineGridProps) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [popover, setPopover] = useState<PopoverState>(null);
  const [selectedBooking, setSelectedBooking] = useState<TimelineBooking | null>(null);
  const [currentHourOffset, setCurrentHourOffset] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const hours = data.hours;

  // Update current time marker every minute
  useEffect(() => {
    function updateNowMarker() {
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      if (date !== today) {
        setCurrentHourOffset(null);
        return;
      }
      const totalMinutes = now.getHours() * 60 + now.getMinutes();
      const openMinutes = OPEN_HOUR * 60;
      const closeMinutes = CLOSE_HOUR * 60;
      if (totalMinutes < openMinutes || totalMinutes > closeMinutes) {
        setCurrentHourOffset(null);
        return;
      }
      setCurrentHourOffset(
        ((totalMinutes - openMinutes) / (closeMinutes - openMinutes)) * 100
      );
    }

    updateNowMarker();
    const interval = setInterval(updateNowMarker, 60_000);
    return () => clearInterval(interval);
  }, [date]);

  const loadTimeline = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/ps-park/timeline?date=${newDate}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // keep old data on failure
    } finally {
      setLoading(false);
    }
  }, []);

  function getBookingsForResource(resourceId: string): TimelineBooking[] {
    return data.bookings.filter((b) => b.resourceId === resourceId);
  }

  function getBookingStyle(booking: TimelineBooking) {
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;
    const totalHours = CLOSE_HOUR - OPEN_HOUR;
    const left = ((startHour - OPEN_HOUR) / totalHours) * 100;
    const width = ((endHour - startHour) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  }

  function isSlotFree(resourceId: string, hour: number): boolean {
    const slotStart = new Date(`${date}T${hour.toString().padStart(2, "0")}:00:00`);
    const slotEnd = new Date(`${date}T${(hour + 1).toString().padStart(2, "0")}:00:00`);
    return !data.bookings.some(
      (b) =>
        b.resourceId === resourceId &&
        new Date(b.startTime) < slotEnd &&
        new Date(b.endTime) > slotStart
    );
  }

  function countConsecutiveFreeSlots(resourceId: string, fromHour: number): number {
    let count = 0;
    for (let h = fromHour; h < CLOSE_HOUR; h++) {
      if (isSlotFree(resourceId, h)) count++;
      else break;
    }
    return count;
  }

  function handleSlotClick(resourceId: string, hour: number) {
    if (!isSlotFree(resourceId, hour)) return;
    const resource = data.resources.find((r) => r.id === resourceId);
    if (!resource) return;

    setPopover({
      resourceId,
      resourceName: resource.name,
      startTime: `${hour.toString().padStart(2, "0")}:00`,
      pricePerHour: resource.pricePerHour ? Number(resource.pricePerHour) : null,
      availableConsecutiveSlots: countConsecutiveFreeSlots(resourceId, hour),
    });
  }

  function handleBookingCreated() {
    setPopover(null);
    loadTimeline(date);
  }

  function handleBookingClick(booking: TimelineBooking, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedBooking(selectedBooking?.id === booking.id ? null : booking);
    setPopover(null);
  }

  function handleBookingStatusChanged() {
    setSelectedBooking(null);
    loadTimeline(date);
  }

  function getResourceName(resourceId: string): string {
    return data.resources.find((r) => r.id === resourceId)?.name ?? "—";
  }

  function getResourcePrice(resourceId: string): number | null {
    const r = data.resources.find((r) => r.id === resourceId);
    return r?.pricePerHour ? Number(r.pricePerHour) : null;
  }

  // Check if a booking is currently active (happening right now)
  function isActiveNow(booking: TimelineBooking): boolean {
    const now = new Date();
    return (
      booking.status === "CONFIRMED" &&
      new Date(booking.startTime) <= now &&
      new Date(booking.endTime) > now
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <DateNavigator currentDate={date} onChange={loadTimeline} />
        {loading && (
          <span className="text-xs text-zinc-400 animate-pulse">
            Загрузка...
          </span>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 overflow-hidden" ref={gridRef}>
        {/* Header row: hours */}
        <div className="flex border-b border-zinc-200 bg-zinc-50">
          <div className="w-36 min-w-[144px] shrink-0 px-3 py-2 text-xs font-medium text-zinc-500 border-r border-zinc-200">
            Стол
          </div>
          <div className="flex-1 relative overflow-x-auto">
            <div className="flex min-w-[900px]">
              {hours.map((h) => (
                <div
                  key={h}
                  className="flex-1 px-1 py-2 text-center text-xs font-medium text-zinc-500 border-r border-zinc-100 last:border-r-0"
                >
                  {h}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Resource rows */}
        {data.resources.map((resource) => {
          const bookings = getBookingsForResource(resource.id);
          return (
            <div key={resource.id} className="flex border-b border-zinc-100 last:border-b-0 group">
              {/* Resource label */}
              <div className="w-36 min-w-[144px] shrink-0 px-3 py-3 border-r border-zinc-200 bg-white">
                <div className="text-sm font-medium text-zinc-900 leading-tight">
                  {resource.name}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {resource.capacity && `${resource.capacity} игр.`}
                  {resource.capacity && resource.pricePerHour && " · "}
                  {resource.pricePerHour && `${Number(resource.pricePerHour)} ₽/ч`}
                </div>
              </div>

              {/* Timeline cells */}
              <div className="flex-1 relative overflow-x-auto">
                <div className="relative min-w-[900px] h-16">
                  {/* Hour grid lines + clickable slots */}
                  <div className="absolute inset-0 flex">
                    {hours.map((h) => {
                      const hour = parseInt(h.split(":")[0], 10);
                      const free = isSlotFree(resource.id, hour);
                      return (
                        <div
                          key={h}
                          onClick={() => free && handleSlotClick(resource.id, hour)}
                          className={`flex-1 border-r border-zinc-50 last:border-r-0 transition-colors ${
                            free
                              ? "cursor-pointer hover:bg-emerald-50/50"
                              : ""
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Booking blocks */}
                  {bookings.map((booking) => {
                    const style = getBookingStyle(booking);
                    const active = isActiveNow(booking);
                    const isPending = booking.status === "PENDING";
                    const isSelected = selectedBooking?.id === booking.id;
                    const meta = booking.metadata as Record<string, unknown> | null;
                    const playerCount = meta?.playerCount as number | undefined;

                    return (
                      <div
                        key={booking.id}
                        className={`absolute top-1 bottom-1 rounded-lg px-2 py-1 overflow-hidden text-xs leading-tight transition-all cursor-pointer select-none ${
                          isSelected
                            ? "bg-blue-100 border-2 border-blue-500 shadow-md ring-2 ring-blue-300/50 z-20"
                            : active
                            ? "bg-emerald-100 border-2 border-emerald-400 shadow-sm hover:shadow-md hover:brightness-95"
                            : isPending
                            ? "bg-amber-50 border border-dashed border-amber-300 hover:bg-amber-100/70"
                            : "bg-emerald-50 border border-emerald-200 hover:bg-emerald-100/70"
                        }`}
                        style={style}
                        title={`${booking.clientName ?? "—"} · Нажмите для подробностей`}
                        onClick={(e) => handleBookingClick(booking, e)}
                      >
                        <div className="flex items-center gap-1">
                          {active && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          )}
                          <span className="font-medium text-zinc-900 truncate">
                            {booking.clientName ?? "—"}
                          </span>
                        </div>
                        {playerCount && (
                          <span className="text-zinc-500">{playerCount} игр.</span>
                        )}
                      </div>
                    );
                  })}

                  {/* Current time marker */}
                  {currentHourOffset !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 pointer-events-none"
                      style={{ left: `${currentHourOffset}%` }}
                    >
                      <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-400" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {data.resources.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            Нет активных столов
          </div>
        )}
      </div>

      {/* Booking detail card */}
      {selectedBooking && (
        <BookingDetailCard
          booking={selectedBooking}
          resourceName={getResourceName(selectedBooking.resourceId)}
          pricePerHour={getResourcePrice(selectedBooking.resourceId)}
          isActiveNow={isActiveNow(selectedBooking)}
          onClose={() => setSelectedBooking(null)}
          onStatusChanged={handleBookingStatusChanged}
        />
      )}

      {/* Quick booking popover */}
      {popover && (
        <QuickBookingPopover
          resourceId={popover.resourceId}
          resourceName={popover.resourceName}
          date={date}
          startTime={popover.startTime}
          availableConsecutiveSlots={popover.availableConsecutiveSlots}
          pricePerHour={popover.pricePerHour}
          onClose={() => setPopover(null)}
          onCreated={handleBookingCreated}
        />
      )}
    </div>
  );
}
