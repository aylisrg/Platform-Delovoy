import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import type {
  CreateBookingInput,
  CreateResourceInput,
  UpdateResourceInput,
  BookingFilter,
  DayAvailability,
  TimeSlot,
  GazeboResource,
} from "./types";

const MODULE_SLUG = "gazebos";

// Operating hours
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const SLOT_DURATION_HOURS = 1;

// === RESOURCES ===

export async function listResources(activeOnly = true): Promise<GazeboResource[]> {
  return prisma.resource.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      ...(activeOnly && { isActive: true }),
    },
    orderBy: { name: "asc" },
  });
}

export async function getResource(id: string) {
  return prisma.resource.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });
}

export async function createResource(input: CreateResourceInput) {
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

export async function updateResource(id: string, input: UpdateResourceInput) {
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

export async function listBookings(filter?: BookingFilter) {
  const where = {
    moduleSlug: MODULE_SLUG,
    ...(filter?.status && { status: filter.status }),
    ...(filter?.resourceId && { resourceId: filter.resourceId }),
    ...(filter?.userId && { userId: filter.userId }),
    ...(filter?.dateFrom || filter?.dateTo
      ? {
          date: {
            ...(filter?.dateFrom && { gte: new Date(filter.dateFrom) }),
            ...(filter?.dateTo && { lte: new Date(filter.dateTo) }),
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

export async function createBooking(userId: string, input: CreateBookingInput) {
  const { resourceId, date, startTime, endTime, guestCount, comment } = input;

  // Verify resource exists and is active
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true },
  });
  if (!resource) {
    throw new BookingError("RESOURCE_NOT_FOUND", "Беседка не найдена или неактивна");
  }

  // Check guest count vs capacity
  if (guestCount && resource.capacity && guestCount > resource.capacity) {
    throw new BookingError(
      "CAPACITY_EXCEEDED",
      `Максимальная вместимость: ${resource.capacity} человек`
    );
  }

  // Parse dates
  const bookingDate = new Date(date);
  const start = parseDatetime(date, startTime);
  const end = parseDatetime(date, endTime);

  // Check date is not in the past
  if (bookingDate < new Date(new Date().toISOString().split("T")[0])) {
    throw new BookingError("DATE_IN_PAST", "Нельзя бронировать на прошедшую дату");
  }

  // Check for conflicting bookings
  const conflict = await prisma.booking.findFirst({
    where: {
      moduleSlug: MODULE_SLUG,
      resourceId,
      status: { in: ["PENDING", "CONFIRMED"] },
      date: bookingDate,
      OR: [
        { startTime: { lt: end }, endTime: { gt: start } },
      ],
    },
  });

  if (conflict) {
    throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
  }

  return prisma.booking.create({
    data: {
      moduleSlug: MODULE_SLUG,
      resourceId,
      userId,
      date: bookingDate,
      startTime: start,
      endTime: end,
      status: "PENDING",
      metadata: {
        ...(guestCount && { guestCount }),
        ...(comment && { comment }),
      },
    },
  });
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  // Validate status transitions
  const validTransitions: Record<BookingStatus, BookingStatus[]> = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "CANCELLED"],
    CANCELLED: [],
    COMPLETED: [],
  };

  if (!validTransitions[booking.status].includes(status)) {
    throw new BookingError(
      "INVALID_STATUS_TRANSITION",
      `Нельзя перевести из ${booking.status} в ${status}`
    );
  }

  return prisma.booking.update({
    where: { id },
    data: { status },
  });
}

export async function cancelBooking(id: string, userId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  if (booking.userId !== userId) {
    throw new BookingError("FORBIDDEN", "Вы не можете отменить чужое бронирование");
  }

  if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    throw new BookingError("INVALID_STATUS_TRANSITION", "Бронирование уже завершено или отменено");
  }

  return prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
}

// === AVAILABILITY ===

export async function getAvailability(
  date: string,
  resourceId?: string
): Promise<DayAvailability[]> {
  const resources = resourceId
    ? await prisma.resource.findMany({
        where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true },
      })
    : await prisma.resource.findMany({
        where: { moduleSlug: MODULE_SLUG, isActive: true },
        orderBy: { name: "asc" },
      });

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
    const resourceBookings = existingBookings.filter(
      (b) => b.resourceId === resource.id
    );

    const slots: TimeSlot[] = [];
    for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour += SLOT_DURATION_HOURS) {
      const slotStart = `${hour.toString().padStart(2, "0")}:00`;
      const slotEnd = `${(hour + SLOT_DURATION_HOURS).toString().padStart(2, "0")}:00`;
      const slotStartDt = parseDatetime(date, slotStart);
      const slotEndDt = parseDatetime(date, slotEnd);

      const isBooked = resourceBookings.some(
        (b) => b.startTime < slotEndDt && b.endTime > slotStartDt
      );

      slots.push({
        startTime: slotStart,
        endTime: slotEnd,
        isAvailable: !isBooked,
      });
    }

    return { date, resource, slots };
  });
}

// === HELPERS ===

function parseDatetime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export class BookingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BookingError";
  }
}
