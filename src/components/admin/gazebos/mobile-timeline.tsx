"use client";

import { useCallback, useMemo, useState } from "react";
import { DateNavigator } from "@/components/admin/shared/date-navigator";
import { GazeboMobileBookingSheet } from "./mobile-booking-sheet";
import { GazeboBookingDetailCard } from "./booking-detail-card";
import {
  CLOSE_HHMM,
  generateHalfHourSlots,
  getMaxEndFromBookings,
  isSlotFree,
  parseHHMM,
} from "@/lib/booking-time";
import type { TimelineData, TimelineBooking } from "@/modules/gazebos/types";
import { getResourcePricing, type ResourcePricing } from "@/modules/gazebos/pricing";
import { formatTime } from "@/lib/format";

function toHHMM(iso: string): string {
  return formatTime(iso);
}

type SlotState = {
  resourceId: string;
  resourceName: string;
  startTime: string;
  maxEndTime: string;
  pricePerHour: number | null;
  pricing: ResourcePricing | null;
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
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    initialData.resources[0]?.id ?? null,
  );

  const slots = generateHalfHourSlots();
  const bufferMin = data.cleaningBufferMinutes ?? 0;

  const loadTimeline = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/gazebos/timeline?date=${newDate}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        // Держим выбранную беседку валидной для новой даты.
        setSelectedResourceId((prev) =>
          json.data.resources.some(
            (r: { id: string }) => r.id === prev,
          )
            ? prev
            : (json.data.resources[0]?.id ?? null),
        );
      }
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

  const selectedResource = useMemo(
    () => data.resources.find((r) => r.id === selectedResourceId) ?? null,
    [data.resources, selectedResourceId],
  );

  function handleSlotClick(resourceId: string, startHHMM: string) {
    const bookings = getResourceBookings(resourceId).map((b) => ({
      startHHMM: b.startHHMM,
      endHHMM: b.endHHMM,
    }));
    if (!isSlotFree(startHHMM, bookings)) return;
    const resource = data.resources.find((r) => r.id === resourceId);
    if (!resource) return;
    const pricePerHour = resource.pricePerHour
      ? Number(resource.pricePerHour)
      : null;
    setSlot({
      resourceId,
      resourceName: resource.name,
      startTime: startHHMM,
      maxEndTime: getMaxEndFromBookings(startHHMM, bookings, CLOSE_HHMM, bufferMin),
      pricePerHour,
      pricing: getResourcePricing(resource.metadata, pricePerHour, date),
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
        <>
          {/* Селектор беседки — одна колонка за раз, чтобы вертикальный день
              был читаемым на телефоне. */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 snap-x">
            {data.resources.map((resource) => {
              const active = resource.id === selectedResourceId;
              const count = data.bookings.filter(
                (b) => b.resourceId === resource.id,
              ).length;
              return (
                <button
                  key={resource.id}
                  type="button"
                  onClick={() => setSelectedResourceId(resource.id)}
                  className={`shrink-0 snap-start rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                  }`}
                >
                  {resource.name}
                  {count > 0 && (
                    <span
                      className={`ml-1.5 text-xs ${
                        active ? "text-blue-100" : "text-zinc-400"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedResource && (
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2.5">
                <p className="text-sm font-semibold text-zinc-900">
                  {selectedResource.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {selectedResource.capacity && `${selectedResource.capacity} чел.`}
                  {selectedResource.capacity &&
                    selectedResource.pricePerHour &&
                    " · "}
                  {selectedResource.pricePerHour &&
                    `${Number(selectedResource.pricePerHour)} ₽/ч`}
                </p>
              </div>

              {/* Вертикальная лента дня: время сверху вниз, без горизонтального
                  скролла. Свободный час — тап создаёт бронь; занятый блок — тап
                  открывает детали. */}
              <ul className="divide-y divide-zinc-50">
                {(() => {
                  const resourceBookings = getResourceBookings(
                    selectedResource.id,
                  );
                  const bookingsHHMM = resourceBookings.map((b) => ({
                    startHHMM: b.startHHMM,
                    endHHMM: b.endHHMM,
                  }));
                  return slots.map((s) => {
                    const activeBooking = resourceBookings.find(
                      (b) => b.startHHMM <= s && s < b.endHHMM,
                    );
                    if (activeBooking) {
                      // Рисуем блок только на его стартовом слоте, остальные
                      // покрытые слоты пропускаем.
                      if (activeBooking.startHHMM !== s) return null;
                      const isPending =
                        activeBooking.booking.status === "PENDING";
                      const spanSlots = Math.max(
                        1,
                        Math.round(
                          (parseHHMM(activeBooking.endHHMM) -
                            parseHHMM(activeBooking.startHHMM)) /
                            30,
                        ),
                      );
                      return (
                        <li key={s}>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedBooking(activeBooking.booking)
                            }
                            style={{ minHeight: `${spanSlots * 40}px` }}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                              isPending
                                ? "bg-amber-50"
                                : "bg-emerald-50"
                            }`}
                          >
                            <span className="w-24 shrink-0 text-xs font-medium tabular-nums text-zinc-500">
                              {activeBooking.startHHMM}–{activeBooking.endHHMM}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-zinc-900">
                                {activeBooking.booking.clientName ?? "Без имени"}
                              </span>
                              <span
                                className={`text-xs font-medium ${
                                  isPending
                                    ? "text-amber-700"
                                    : "text-emerald-700"
                                }`}
                              >
                                {isPending ? "Ожидает" : "Подтверждена"}
                              </span>
                            </span>
                            <span className="shrink-0 text-zinc-300">›</span>
                          </button>
                        </li>
                      );
                    }

                    const free = isSlotFree(s, bookingsHHMM, bufferMin);
                    // Сюда попадаем только если бронь не покрывает слот; значит
                    // !free = слот занят часом на уборку после предыдущей брони.
                    const isCleaning = !free;
                    return (
                      <li key={s}>
                        <button
                          type="button"
                          disabled={!free}
                          onClick={() => handleSlotClick(selectedResource.id, s)}
                          className={`flex h-10 w-full items-center gap-3 px-3 text-left text-sm transition-colors ${
                            free
                              ? "text-zinc-600 hover:bg-blue-50 active:bg-blue-100"
                              : isCleaning
                                ? "cursor-not-allowed bg-amber-50/40 text-amber-600"
                                : "cursor-not-allowed text-zinc-300"
                          }`}
                        >
                          <span className="w-24 shrink-0 text-xs font-medium tabular-nums text-zinc-400">
                            {s}
                          </span>
                          {free ? (
                            <span className="text-xs text-blue-600">
                              + Забронировать
                            </span>
                          ) : isCleaning ? (
                            <span className="text-xs text-amber-600">
                              🧹 Уборка
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}
        </>
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
          pricing={slot.pricing}
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
