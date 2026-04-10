import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  createCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import type {
  CreatePSBookingInput,
  CreateTableInput,
  UpdateTableInput,
  PSBookingFilter,
  DayAvailability,
  TimeSlot,
  PSTableResource,
} from "./types";

const MODULE_SLUG = "ps-park";

// Operating hours (unified: 08:00–23:00)
const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;
const SLOT_DURATION_HOURS = 1;

// === RESOURCES (tables) ===

export async function listTables(activeOnly = true): Promise<PSTableResource[]> {
  return prisma.resource.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      ...(activeOnly && { isActive: true }),
    },
    orderBy: { name: "asc" },
  });
}

export async function getTable(id: string) {
  return prisma.resource.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });
}

export async function createTable(input: CreateTableInput) {
  return prisma.resource.create({
    data: {
      moduleSlug: MODULE_SLUG,
      name: input.name,
      description: input.description,
      capacity: input.capacity,
      pricePerHour: input.pricePerHour,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    },
  });
}

export async function updateTable(id: string, input: UpdateTableInput) {
  return prisma.resource.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.pricePerHour !== undefined && { pricePerHour: input.pricePerHour }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.metadata !== undefined && {
        metadata: JSON.parse(JSON.stringify(input.metadata)),
      }),
    },
  });
}

// === BOOKINGS ===

export async function listBookings(filter?: PSBookingFilter) {
  const where = {
    moduleSlug: MODULE_SLUG,
    ...(filter?.status && { status: filter.status }),
    ...(filter?.resourceId && { resourceId: filter.resourceId }),
    ...(filter?.userId && { userId: filter.userId }),
    ...(filter?.dateFrom || filter?.dateTo
      ? {
          date: {
            ...(filter?.dateFrom && { gte: new Date(filter.dateFrom) }),
            ...(filter?.dateTo && { lte: new Date(`${filter.dateTo}T23:59:59.999Z`) }),
          },
        }
      : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { date: "asc" },
      take: 100,
    }),
    prisma.booking.count({ where }),
  ]);

  return { bookings, total };
}

export async function getBooking(id: string) {
  return prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });
}

export async function createBooking(userId: string, input: CreatePSBookingInput) {
  const { resourceId, date, startTime, endTime, playerCount, comment } = input;

  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true },
  });
  if (!resource) {
    throw new PSBookingError("RESOURCE_NOT_FOUND", "Стол не найден или неактивен");
  }

  if (playerCount && resource.capacity && playerCount > resource.capacity) {
    throw new PSBookingError(
      "CAPACITY_EXCEEDED",
      `Максимальная вместимость стола: ${resource.capacity} человек`
    );
  }

  const bookingDate = new Date(date);
  const start = parseDatetime(date, startTime);
  const end = parseDatetime(date, endTime);

  if (bookingDate < new Date(new Date().toISOString().split("T")[0])) {
    throw new PSBookingError("DATE_IN_PAST", "Нельзя бронировать на прошедшую дату");
  }

  const conflict = await prisma.booking.findFirst({
    where: {
      moduleSlug: MODULE_SLUG,
      resourceId,
      status: { in: ["PENDING", "CONFIRMED"] },
      date: bookingDate,
      OR: [{ startTime: { lt: end }, endTime: { gt: start } }],
    },
  });

  if (conflict) {
    throw new PSBookingError("BOOKING_CONFLICT", "Это время уже занято");
  }

  const booking = await prisma.booking.create({
    data: {
      moduleSlug: MODULE_SLUG,
      resourceId,
      userId,
      date: bookingDate,
      startTime: start,
      endTime: end,
      status: "PENDING",
      metadata: {
        ...(playerCount && { playerCount }),
        ...(comment && { comment }),
      },
    },
  });

  enqueueNotification({
    type: "booking.created",
    moduleSlug: MODULE_SLUG,
    entityId: booking.id,
    userId,
    actor: "client",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  return booking;
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string
) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) {
    throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  const validTransitions: Record<BookingStatus, BookingStatus[]> = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "CANCELLED"],
    CANCELLED: [],
    COMPLETED: [],
  };

  if (!validTransitions[booking.status].includes(status)) {
    throw new PSBookingError(
      "INVALID_STATUS_TRANSITION",
      `Нельзя перевести из ${booking.status} в ${status}`
    );
  }

  const resource = await prisma.resource.findUnique({ where: { id: booking.resourceId } });

  // Google Calendar sync
  let googleEventId = booking.googleEventId;

  if (status === "CONFIRMED" && resource?.googleCalendarId) {
    const user = await prisma.user.findUnique({
      where: { id: booking.userId },
      select: { name: true, phone: true },
    });
    const calResult = await createCalendarEvent(resource.googleCalendarId, {
      summary: `${resource.name} — ${booking.clientName || user?.name || "Клиент"}`,
      description: `Телефон: ${booking.clientPhone || user?.phone || "не указан"}`,
      startTime: booking.startTime,
      endTime: booking.endTime,
    });
    if (calResult.success && calResult.eventId) {
      googleEventId = calResult.eventId;
    }
  }

  if (status === "CANCELLED" && booking.googleEventId && resource?.googleCalendarId) {
    await deleteCalendarEvent(resource.googleCalendarId, booking.googleEventId);
    googleEventId = null;
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status,
      ...(managerId && { managerId }),
      ...(cancelReason && { cancelReason }),
      ...(googleEventId !== booking.googleEventId && { googleEventId }),
    },
  });

  const dateStr = booking.date.toISOString().split("T")[0];
  const startStr = booking.startTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const endStr = booking.endTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  enqueueNotification({
    type: `booking.${status === "CONFIRMED" ? "confirmed" : status === "CANCELLED" ? "cancelled" : "confirmed"}`,
    moduleSlug: MODULE_SLUG,
    entityId: id,
    userId: booking.userId,
    actor: "admin",
    data: { resourceName: resource?.name || "", date: dateStr, startTime: startStr, endTime: endStr },
  });

  return updated;
}

export async function cancelBooking(id: string, userId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  if (booking.userId !== userId) throw new PSBookingError("FORBIDDEN", "Нельзя отменить чужое бронирование");
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    throw new PSBookingError("INVALID_STATUS_TRANSITION", "Бронирование уже завершено или отменено");
  }

  const updated = await prisma.booking.update({ where: { id }, data: { status: "CANCELLED" } });

  const resource = await prisma.resource.findUnique({ where: { id: booking.resourceId }, select: { name: true } });
  const dateStr = booking.date.toISOString().split("T")[0];
  const startStr = booking.startTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const endStr = booking.endTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  enqueueNotification({
    type: "booking.cancelled",
    moduleSlug: MODULE_SLUG,
    entityId: id,
    userId,
    actor: "client",
    data: { resourceName: resource?.name || "", date: dateStr, startTime: startStr, endTime: endStr },
  });

  return updated;
}

// === AVAILABILITY ===

export async function getAvailability(date: string, resourceId?: string): Promise<DayAvailability[]> {
  const resources = resourceId
    ? await prisma.resource.findMany({ where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true } })
    : await prisma.resource.findMany({ where: { moduleSlug: MODULE_SLUG, isActive: true }, orderBy: { name: "asc" } });

  const bookingDate = new Date(date);

  const existingBookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      date: bookingDate,
      status: { in: ["PENDING", "CONFIRMED"] },
      ...(resourceId && { resourceId }),
    },
  });

  return resources.map((resource) => {
    const resourceBookings = existingBookings.filter((b) => b.resourceId === resource.id);
    const slots: TimeSlot[] = [];

    for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour += SLOT_DURATION_HOURS) {
      const slotStart = `${hour.toString().padStart(2, "0")}:00`;
      const slotEnd = `${(hour + SLOT_DURATION_HOURS).toString().padStart(2, "0")}:00`;
      const slotStartDt = parseDatetime(date, slotStart);
      const slotEndDt = parseDatetime(date, slotEnd);

      const isBooked = resourceBookings.some(
        (b) => b.startTime < slotEndDt && b.endTime > slotStartDt
      );

      slots.push({ startTime: slotStart, endTime: slotEnd, isAvailable: !isBooked });
    }

    return { date, resource, slots };
  });
}

// === HELPERS ===

function parseDatetime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export class PSBookingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PSBookingError";
  }
}
