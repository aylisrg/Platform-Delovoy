"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { DateNavigator } from "@/components/admin/shared/date-navigator";
import { PrintDaySheet } from "@/components/admin/shared/print-day-sheet";
import { WeekScheduleGrid } from "@/components/admin/shared/week-schedule-grid";
import { ScheduleViewToggle, type ScheduleView } from "@/components/admin/shared/schedule-view-toggle";
import { GazeboQuickBookingPopover } from "./quick-booking-popover";
import { GazeboBookingDetailCard } from "./booking-detail-card";
import type { TimelineData, TimelineBooking } from "@/modules/gazebos/types";
import type { WeekTimelineBooking, WeekTimelineResource } from "@/modules/booking/week-timeline";
import { getResourcePricing, type ResourcePricing } from "@/modules/gazebos/pricing";
import { getMoscowHour as getMoscowHourUnified, parseMoscowDateTime, toISODate } from "@/lib/format";
import { PaymentDot } from "@/components/admin/shared/payment-badge";
import {
  bookingHourRange,
  clampToWorkingHours,
  planDrop,
  pxDeltaToHours,
  resizeBookingEnd,
  shiftBooking,
  snapHours,
  type DropPlan,
  type HourRange,
} from "@/lib/timeline-drag";

type TimelineGridProps = {
  initialData: TimelineData;
  initialDate: string;
  /** Deep-link из истории: подсветить/раскрыть эту бронь при загрузке. */
  initialBookingId?: string;
};

type PopoverState = {
  resourceId: string;
  resourceName: string;
  startTime: string;
  pricePerHour: number | null;
  pricing: ResourcePricing | null;
  maxEndTime: string;
} | null;

/** Имя/цена ресурса для карточки, открытой из недельного вида (ресурс может не быть в дневных данных). */
type ResourceOverride = { name: string; pricePerHour: number | null } | null;

/**
 * Активный drag (US-6, ADR 2026-08-23 §5.2): ширина дорожки измеряется один раз
 * на старте, время считается от сдвига блока (`delta.x`), а не от курсора.
 */
type DragState = {
  kind: "move" | "resize";
  bookingId: string;
  trackWidthPx: number;
  blockWidthPx: number;
} | null;

// Дефолт на случай пустого grid — реальные границы берутся из data.hours
// (уже посчитаны бэкендом из настроек модуля, #434).
const FALLBACK_OPEN_HOUR = 8;
const FALLBACK_CLOSE_HOUR = 23;

function getMoscowHour(d: Date): number {
  return getMoscowHourUnified(d);
}

function getMoscowMinute(d: Date): number {
  return d.getMinutes();
}

function getMoscowDateStr(d: Date): string {
  return toISODate(d);
}

function parseMoscowDatetime(date: string, hour: number): Date {
  return new Date(`${date}T${hour.toString().padStart(2, "0")}:00:00+03:00`);
}

function parseDragId(id: string | number): { kind: "move" | "resize"; bookingId: string } | null {
  const s = String(id);
  if (s.startsWith("move:")) return { kind: "move", bookingId: s.slice(5) };
  if (s.startsWith("resize:")) return { kind: "resize", bookingId: s.slice(7) };
  return null;
}

/**
 * Дорожка ресурса — droppable-зона переноса (`res:<id>`): 5 зон вместо 75
 * часовых ячеек, ресурс приходит из `over.id`, вертикаль руками не считается.
 */
function ResourceTrack({
  resourceId,
  registerTrack,
  children,
}: {
  resourceId: string;
  registerTrack: (resourceId: string, el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `res:${resourceId}` });
  return (
    <div className="flex-1 relative overflow-x-auto">
      <div
        ref={(el) => {
          setNodeRef(el);
          registerTrack(resourceId, el);
        }}
        data-testid={`track-${resourceId}`}
        className={`relative min-w-[900px] h-16 transition-colors ${isOver ? "bg-blue-50/50" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Блок брони: перенос — сам блок (`move:<id>`), растяжение — ручка на правом
 * крае (`resize:<id>`, свой draggable, pointerdown не всплывает к переносу).
 * Клик без движения по-прежнему открывает карточку: PointerSensor активирует
 * drag только после 8 px.
 */
function BookingBlock({
  booking,
  style,
  className,
  title,
  disabled,
  dragging,
  onClick,
  children,
}: {
  booking: TimelineBooking;
  style: React.CSSProperties;
  className: string;
  title: string;
  disabled: boolean;
  dragging: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const {
    setNodeRef: setMoveNodeRef,
    listeners: moveListeners,
    attributes: moveAttributes,
  } = useDraggable({ id: `move:${booking.id}`, disabled });
  const {
    setNodeRef: setResizeNodeRef,
    listeners: resizeAllListeners,
    attributes: resizeAttributes,
  } = useDraggable({ id: `resize:${booking.id}`, disabled });
  const { onPointerDown: resizePointerDown, ...resizeListeners } = resizeAllListeners ?? {};

  return (
    <div
      ref={setMoveNodeRef}
      {...moveListeners}
      {...moveAttributes}
      data-testid={`booking-${booking.id}`}
      className={`${className} ${dragging ? "opacity-40" : ""} ${disabled ? "cursor-progress" : ""}`}
      style={style}
      title={title}
      onClick={onClick}
    >
      {children}
      <div
        ref={setResizeNodeRef}
        {...resizeListeners}
        {...resizeAttributes}
        role="separator"
        aria-label="Изменить время окончания"
        data-testid={`resize-${booking.id}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          (resizePointerDown as ((ev: React.PointerEvent) => void) | undefined)?.(e);
        }}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-zinc-900/10"
      />
    </div>
  );
}

export function GazeboTimelineGrid({
  initialData,
  initialDate,
  initialBookingId,
}: TimelineGridProps) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [popover, setPopover] = useState<PopoverState>(null);
  const [selectedBooking, setSelectedBooking] = useState<TimelineBooking | null>(
    () => initialData.bookings.find((b) => b.id === initialBookingId) ?? null
  );
  const [selectedResourceOverride, setSelectedResourceOverride] = useState<ResourceOverride>(null);
  const [currentHourOffset, setCurrentHourOffset] = useState<number | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  // Вид «День / Неделя» — локальное состояние, без ?view= в URL (US-5, ADR §3).
  const [view, setView] = useState<ScheduleView>("day");
  const [weekRefreshKey, setWeekRefreshKey] = useState(0);
  // Drag-and-drop (US-6): активный drag, бронь с in-flight PATCH, текст ошибки.
  const [drag, setDrag] = useState<DragState>(null);
  const [inflightId, setInflightId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const trackRefs = useRef(new Map<string, HTMLDivElement>());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const hours = data.hours;
  // Границы сетки — из data.hours (посчитаны бэкендом из Module.config), а не
  // захардкожены: `hours` = ["08:00", ..., "22:00"] → openHour=8, closeHour=23.
  const openHour = hours.length > 0 ? parseInt(hours[0].split(":")[0], 10) : FALLBACK_OPEN_HOUR;
  const closeHour =
    hours.length > 0 ? parseInt(hours[hours.length - 1].split(":")[0], 10) + 1 : FALLBACK_CLOSE_HOUR;

  useEffect(() => {
    function updateNowMarker() {
      const now = new Date();
      const today = getMoscowDateStr(now);
      if (date !== today) {
        setCurrentHourOffset(null);
        return;
      }
      const totalMinutes = getMoscowHour(now) * 60 + getMoscowMinute(now);
      const openMinutes = openHour * 60;
      const closeMinutes = closeHour * 60;
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
  }, [date, openHour, closeHour]);

  const loadTimeline = useCallback(async (newDate: string) => {
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/gazebos/timeline?date=${newDate}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // keep old data on failure
    } finally {
      setLoading(false);
    }
  }, []);

  const registerTrack = useCallback((resourceId: string, el: HTMLDivElement | null) => {
    if (el) trackRefs.current.set(resourceId, el);
    else trackRefs.current.delete(resourceId);
  }, []);

  function getBookingsForResource(resourceId: string): TimelineBooking[] {
    return data.bookings.filter((b) => b.resourceId === resourceId);
  }

  function getBookingStyle(booking: TimelineBooking) {
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    const startHour = getMoscowHour(start) + getMoscowMinute(start) / 60;
    const endHour = getMoscowHour(end) + getMoscowMinute(end) / 60;
    const totalHours = closeHour - openHour;
    const left = ((startHour - openHour) / totalHours) * 100;
    const width = ((endHour - startHour) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  }

  function isSlotFree(resourceId: string, hour: number): boolean {
    const slotStart = parseMoscowDatetime(date, hour);
    const slotEnd = parseMoscowDatetime(date, hour + 1);
    return !data.bookings.some(
      (b) =>
        b.resourceId === resourceId &&
        new Date(b.startTime) < slotEnd &&
        new Date(b.endTime) > slotStart
    );
  }

  function getMaxEndTime(resourceId: string, clickedHour: number): string {
    const clickedStart = parseMoscowDatetime(date, clickedHour);
    const nextBooking = data.bookings
      .filter((b) => b.resourceId === resourceId && new Date(b.startTime) > clickedStart)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
    if (!nextBooking) return `${closeHour.toString().padStart(2, "0")}:00`;
    const t = new Date(nextBooking.startTime);
    return `${getMoscowHour(t).toString().padStart(2, "0")}:${getMoscowMinute(t).toString().padStart(2, "0")}`;
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
      pricing: getResourcePricing(
        resource.metadata,
        resource.pricePerHour ? Number(resource.pricePerHour) : null,
        date
      ),
      maxEndTime: getMaxEndTime(resourceId, hour),
    });
  }

  function handleBookingCreated() {
    setPopover(null);
    loadTimeline(date);
  }

  function handleBookingClick(booking: TimelineBooking, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedResourceOverride(null);
    setSelectedBooking(selectedBooking?.id === booking.id ? null : booking);
    setPopover(null);
  }

  // Недельный вид: та же карточка брони (US-5 AC-3) — WeekTimelineBooking
  // структурно расширяет TimelineBooking (плюс `date`), адаптер не нужен.
  function handleWeekBookingClick(booking: WeekTimelineBooking, resource: WeekTimelineResource) {
    setSelectedResourceOverride({ name: resource.name, pricePerHour: resource.pricePerHour });
    setSelectedBooking(selectedBooking?.id === booking.id ? null : booking);
    setPopover(null);
  }

  // Клик по свободной ячейке недели → дневной вид на этот день (US-5 AC-6).
  // Открытая из недели карточка закрывается: иначе она «переезжает» в день
  // с чужой датой (находка QA 2026-09-03).
  function handleWeekEmptyCellClick(day: string) {
    setSelectedBooking(null);
    setSelectedResourceOverride(null);
    setView("day");
    void loadTimeline(day);
  }

  function handleBookingStatusChanged() {
    setSelectedBooking(null);
    setSelectedResourceOverride(null);
    loadTimeline(date);
    setWeekRefreshKey((k) => k + 1);
  }

  function getResourceName(resourceId: string): string {
    return data.resources.find((r) => r.id === resourceId)?.name ?? "—";
  }

  function getResourcePrice(resourceId: string): number | null {
    const r = data.resources.find((r) => r.id === resourceId);
    return r?.pricePerHour ? Number(r.pricePerHour) : null;
  }

  function isActiveNow(booking: TimelineBooking): boolean {
    const now = new Date();
    return (
      booking.status === "CONFIRMED" &&
      new Date(booking.startTime) <= now &&
      new Date(booking.endTime) > now
    );
  }

  // ── Drag-and-drop (US-6) ──────────────────────────────────────────────────

  function handleDragStart(e: DragStartEvent) {
    const parsed = parseDragId(e.active.id);
    if (!parsed) return;
    const booking = data.bookings.find((b) => b.id === parsed.bookingId);
    if (!booking) return;
    const trackWidthPx = trackRefs.current.get(booking.resourceId)?.getBoundingClientRect().width ?? 0;
    const widthPercent = parseFloat(getBookingStyle(booking).width);
    setDragError(null);
    setDrag({
      kind: parsed.kind,
      bookingId: booking.id,
      trackWidthPx,
      blockWidthPx: (trackWidthPx * widthPercent) / 100,
    });
  }

  function handleDragCancel() {
    setDrag(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const current = drag;
    setDrag(null);
    const parsed = parseDragId(e.active.id);
    if (!parsed) return;
    const booking = data.bookings.find((b) => b.id === parsed.bookingId);
    if (!booking) return;

    const trackWidthPx = current?.trackWidthPx || trackRefs.current.get(booking.resourceId)?.getBoundingClientRect().width || 0;
    const deltaHours = snapHours(pxDeltaToHours(e.delta.x, trackWidthPx, openHour, closeHour));
    const original = bookingHourRange(booking.startTime, booking.endTime);

    let targetResourceId = booking.resourceId;
    let next: HourRange;
    if (parsed.kind === "move") {
      const overId = e.over ? String(e.over.id) : "";
      if (overId.startsWith("res:")) targetResourceId = overId.slice(4);
      next = clampToWorkingHours(shiftBooking(original, deltaHours), openHour, closeHour);
    } else {
      next = resizeBookingEnd(original, deltaHours);
      if (next.endHour > closeHour) next = { ...next, endHour: closeHour };
    }

    // Микро-сдвиг после snap и тот же ресурс — запрос не уходит (ADR §5.3 п.5).
    const plan = planDrop({ original, next, originalResourceId: booking.resourceId, targetResourceId, date });
    if (!plan) return;
    void applyDrop(booking, plan);
  }

  /**
   * Тот же PATCH, что шлёт форма редактирования (без `status` → rescheduleBooking:
   * advisory-lock, конфликт-чек, AuditLog, Google Calendar, уведомление гостю —
   * всё на сервере). Оптимистичное обновление с откатом и текстом ошибки сервера.
   */
  async function applyDrop(booking: TimelineBooking, plan: DropPlan) {
    const snapshot = data;
    setInflightId(booking.id);
    setData((prev) => ({
      ...prev,
      bookings: prev.bookings.map((b) =>
        b.id === booking.id
          ? {
              ...b,
              resourceId: plan.resourceId,
              startTime: parseMoscowDateTime(plan.date, plan.startTime).toISOString(),
              endTime: parseMoscowDateTime(plan.date, plan.endTime).toISOString(),
            }
          : b
      ),
    }));
    try {
      const res = await fetch(`/api/gazebos/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      const json = await res.json();
      if (json.success) {
        await loadTimeline(date);
      } else {
        setData(snapshot);
        setDragError(json.error?.message ?? "Не удалось перенести бронь");
      }
    } catch {
      setData(snapshot);
      setDragError("Не удалось перенести бронь — нет связи с сервером");
    } finally {
      setInflightId(null);
    }
  }

  const draggedBooking = drag && drag.kind === "move" ? data.bookings.find((b) => b.id === drag.bookingId) ?? null : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        {view === "day" ? (
          <DateNavigator currentDate={date} onChange={loadTimeline} />
        ) : (
          <span className="text-sm text-zinc-500">Неделя · клик по свободной ячейке откроет день</span>
        )}
        <div className="flex items-center gap-3">
          {view === "day" && dragError && (
            <span role="alert" className="text-xs text-red-600 max-w-[320px] truncate" title={dragError}>
              {dragError}
            </span>
          )}
          {view === "day" && loading && (
            <span className="text-xs text-zinc-400 animate-pulse">
              Загрузка...
            </span>
          )}
          {view === "day" && (
            <button
              type="button"
              onClick={() => setShowPrint(true)}
              className="text-xs text-zinc-500 hover:text-zinc-700 font-medium transition-colors"
            >
              Печать
            </button>
          )}
          <ScheduleViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === "week" && (
        <WeekScheduleGrid
          moduleSlug="gazebos"
          resourceLabel="Беседка"
          unitLabel="чел."
          countMetaKey="guestCount"
          initialDate={date}
          selectedBookingId={selectedBooking?.id ?? null}
          refreshKey={weekRefreshKey}
          onBookingClick={handleWeekBookingClick}
          onEmptyCellClick={handleWeekEmptyCellClick}
        />
      )}

      {view === "day" && (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <div className="rounded-xl border border-zinc-200 overflow-hidden" ref={gridRef}>
        {/* Header row: hours */}
        <div className="flex border-b border-zinc-200 bg-zinc-50">
          <div className="w-36 min-w-[144px] shrink-0 px-3 py-2 text-xs font-medium text-zinc-500 border-r border-zinc-200">
            Беседка
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
              <div className="w-36 min-w-[144px] shrink-0 px-3 py-3 border-r border-zinc-200 bg-white">
                <div className="text-sm font-medium text-zinc-900 leading-tight">
                  {resource.name}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {resource.capacity && `${resource.capacity} чел.`}
                  {resource.capacity && resource.pricePerHour && " · "}
                  {resource.pricePerHour && `${Number(resource.pricePerHour)} ₽/ч`}
                </div>
              </div>

              <ResourceTrack resourceId={resource.id} registerTrack={registerTrack}>
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

                  {bookings.map((booking) => {
                    const style = getBookingStyle(booking);
                    const active = isActiveNow(booking);
                    const isPending = booking.status === "PENDING";
                    const isSelected = selectedBooking?.id === booking.id;
                    const meta = booking.metadata as Record<string, unknown> | null;
                    const guestCount = meta?.guestCount as number | undefined;

                    return (
                      <BookingBlock
                        key={booking.id}
                        booking={booking}
                        style={style}
                        disabled={inflightId === booking.id}
                        dragging={drag?.kind === "move" && drag.bookingId === booking.id}
                        className={`absolute top-1 bottom-1 rounded-lg px-2 py-1 overflow-hidden text-xs leading-tight transition-all cursor-grab active:cursor-grabbing select-none ${
                          isSelected
                            ? "bg-blue-100 border-2 border-blue-500 shadow-md ring-2 ring-blue-300/50 z-20"
                            : active
                            ? "bg-emerald-100 border-2 border-emerald-400 shadow-sm hover:shadow-md hover:brightness-95"
                            : isPending
                            ? "bg-amber-50 border border-dashed border-amber-300 hover:bg-amber-100/70"
                            : "bg-emerald-50 border border-emerald-200 hover:bg-emerald-100/70"
                        }`}
                        title={`${booking.clientName ?? "—"} · Нажмите для подробностей, тяните для переноса`}
                        onClick={(e) => handleBookingClick(booking, e)}
                      >
                        <div className="flex items-center gap-1">
                          {active && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          )}
                          <span className="font-medium text-zinc-900 truncate">
                            {booking.clientName ?? "—"}
                          </span>
                          <PaymentDot booking={booking} />
                        </div>
                        {guestCount && (
                          <span className="text-zinc-500">{guestCount} чел.</span>
                        )}
                      </BookingBlock>
                    );
                  })}

                  {currentHourOffset !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 pointer-events-none"
                      style={{ left: `${currentHourOffset}%` }}
                    >
                      <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-400" />
                    </div>
                  )}
              </ResourceTrack>
            </div>
          );
        })}

        {data.resources.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            Нет активных беседок
          </div>
        )}
      </div>

      {/* Портал поверх overflow-x-auto строк: без него блок обрезается при переносе на соседнюю строку. */}
      <DragOverlay dropAnimation={null}>
        {draggedBooking ? (
          <div
            style={{ width: drag?.blockWidthPx ? `${drag.blockWidthPx}px` : undefined }}
            className="h-14 rounded-lg px-2 py-1 text-xs leading-tight bg-emerald-100 border-2 border-emerald-400 shadow-lg cursor-grabbing"
          >
            <span className="font-medium text-zinc-900 truncate">{draggedBooking.clientName ?? "—"}</span>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
      )}

      {selectedBooking && (
        <GazeboBookingDetailCard
          booking={selectedBooking}
          resourceName={selectedResourceOverride?.name ?? getResourceName(selectedBooking.resourceId)}
          pricePerHour={
            selectedResourceOverride ? selectedResourceOverride.pricePerHour : getResourcePrice(selectedBooking.resourceId)
          }
          isActiveNow={isActiveNow(selectedBooking)}
          onClose={() => setSelectedBooking(null)}
          onStatusChanged={handleBookingStatusChanged}
        />
      )}

      {popover && (
        <GazeboQuickBookingPopover
          resourceId={popover.resourceId}
          resourceName={popover.resourceName}
          date={date}
          startTime={popover.startTime}
          maxEndTime={popover.maxEndTime}
          pricePerHour={popover.pricePerHour}
          pricing={popover.pricing}
          minBookingHours={data.minBookingHours}
          openHour={openHour}
          closeHour={closeHour}
          onClose={() => setPopover(null)}
          onCreated={handleBookingCreated}
        />
      )}

      {showPrint && (
        <PrintDaySheet
          moduleSlug="gazebos"
          title="Барбекю Парк"
          resourceLabel="Беседка"
          date={date}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}
