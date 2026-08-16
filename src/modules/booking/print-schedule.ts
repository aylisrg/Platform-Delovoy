import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import { ACTIVE_BOOKING_STATUSES } from "./state-machine";

export type PrintScheduleRow = {
  bookingId: string;
  startTime: string; // ISO datetime
  endTime: string;
  resourceName: string;
  clientName: string | null;
  clientPhone: string | null;
  status: BookingStatus;
  guestCount: number | null;
  comment: string | null;
};

/**
 * Данные для печатного листа дня (#668) — плоский построчный список, а не
 * вложенная структура ресурс→брони, как у `getTimeline()`: печатная таблица
 * не группируется по ресурсу (AC-3), поэтому её удобнее строить из готового
 * плоского списка, отсортированного по времени начала.
 *
 * `getTimeline()` намеренно не переиспользуется: она фильтрует брони по
 * `ACTIVE_BOOKING_STATUSES` без возможности включить CANCELLED (AC-4).
 */
export async function getPrintableDaySchedule(
  moduleSlug: string,
  date: string,
  includeCancelled: boolean
): Promise<PrintScheduleRow[]> {
  const statuses: BookingStatus[] = includeCancelled
    ? [...ACTIVE_BOOKING_STATUSES, "CANCELLED"]
    : ACTIVE_BOOKING_STATUSES;

  const [resources, bookings] = await Promise.all([
    prisma.resource.findMany({
      where: { moduleSlug, deletedAt: null },
      select: { id: true, name: true },
    }),
    prisma.booking.findMany({
      where: {
        moduleSlug,
        deletedAt: null,
        date: new Date(date),
        status: { in: statuses },
      },
      select: {
        id: true,
        resourceId: true,
        startTime: true,
        endTime: true,
        status: true,
        clientName: true,
        clientPhone: true,
        metadata: true,
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const resourceNames = new Map(resources.map((r) => [r.id, r.name]));

  return bookings.map((b) => {
    const meta = b.metadata as Record<string, unknown> | null;
    return {
      bookingId: b.id,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      resourceName: resourceNames.get(b.resourceId) ?? "—",
      clientName: b.clientName,
      clientPhone: b.clientPhone,
      status: b.status,
      guestCount: typeof meta?.guestCount === "number" ? meta.guestCount : null,
      comment: typeof meta?.comment === "string" ? meta.comment : null,
    };
  });
}
