import { prisma } from "@/lib/db";
import { ACTIVE_BOOKING_STATUSES } from "./state-machine";
import { hoursRange, normalizeWeekStart, weekDays } from "./week-dates";

/**
 * Недельный вид расписания (US-5, эпик #442; ADR
 * `docs/architecture/2026-08-23-booking-calendar-week-view-drag-drop-adr.md`, §2–§4, §6).
 *
 * Общий для беседок и Плей Парка слой, параметризованный `moduleSlug` — тот же
 * приём, что `getPrintableDaySchedule` (#668) и `searchGuestsByPhone` (#666).
 * Дневной `getTimeline()` модулей намеренно не трогается: он обслуживает четыре
 * production-поверхности, а неделя — это другая форма данных (плоский список
 * броней за 7 дней одним диапазонным запросом по индексу `[moduleSlug, date]`).
 *
 * Окно жёстко семь дней: клиент присылает только `weekStart`, сервер сам
 * нормализует его к понедельнику — произвольный диапазонный скан недоступен.
 */

export type WeekTimelineResource = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  /** Decimal → number на границе Server → Client Component (#614). */
  pricePerHour: number | null;
  isActive: boolean;
};

export type WeekTimelineBooking = {
  id: string;
  resourceId: string;
  /** YYYY-MM-DD — ключ ячейки; клиент не выводит дату из ISO сам. */
  date: string;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN";
  clientName: string | null;
  clientPhone: string | null;
  metadata: Record<string, unknown> | null;
  cashAmount: string | null;
  cardAmount: string | null;
};

export type WeekTimelineData = {
  /** Понедельник недели, YYYY-MM-DD. */
  weekStart: string;
  /** Ровно 7 дат YYYY-MM-DD, понедельник → воскресенье. */
  days: string[];
  resources: WeekTimelineResource[];
  bookings: WeekTimelineBooking[];
  /** ["08:00", …] — как у дневного таймлайна, для расчёта загрузки. */
  hours: string[];
  minBookingHours: number;
};

/**
 * Часы работы и минимальная длительность — из настроек модуля. Их читают
 * модульные `getOpenCloseHours()`/`getMinBookingHours()` (у каждого модуля свои
 * дефолты); общий слой их не импортирует — иначе `booking` зависел бы от
 * `gazebos`/`ps-park`, — а получает готовые значения от роута модуля.
 */
export type WeekTimelineHours = {
  openHour: number;
  closeHour: number;
  minBookingHours: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Календарная арифметика живёт в week-dates.ts (без Prisma — её импортирует и
// клиентская матрица); здесь реэкспорт, чтобы у сервиса был один вход.
export { hoursRange, normalizeWeekStart, weekDays } from "./week-dates";

export async function getWeekTimeline(
  moduleSlug: string,
  weekStart: string,
  hours: WeekTimelineHours
): Promise<WeekTimelineData> {
  const start = normalizeWeekStart(weekStart);
  const days = weekDays(start);
  const from = utcMidnight(start);
  const to = new Date(from.getTime() + 7 * DAY_MS);

  const [resources, bookings] = await Promise.all([
    prisma.resource.findMany({
      where: { moduleSlug, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        capacity: true,
        pricePerHour: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        moduleSlug,
        deletedAt: null,
        date: { gte: from, lt: to },
        status: { in: ACTIVE_BOOKING_STATUSES },
      },
      select: {
        id: true,
        resourceId: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        clientName: true,
        clientPhone: true,
        metadata: true,
        cashAmount: true,
        cardAmount: true,
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  return {
    weekStart: start,
    days,
    resources: resources.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      capacity: r.capacity,
      pricePerHour: r.pricePerHour != null ? Number(r.pricePerHour) : null,
      isActive: r.isActive,
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      date: toDateKey(b.date),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status as WeekTimelineBooking["status"],
      clientName: b.clientName,
      clientPhone: b.clientPhone,
      metadata: b.metadata as Record<string, unknown> | null,
      cashAmount: b.cashAmount?.toString() ?? null,
      cardAmount: b.cardAmount?.toString() ?? null,
    })),
    hours: hoursRange(hours.openHour, hours.closeHour),
    minBookingHours: hours.minBookingHours,
  };
}
