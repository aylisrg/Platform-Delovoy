import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  createCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import {
  validateAndSnapshotItems,
  saleBookingItems,
  returnBookingItems,
} from "@/modules/inventory/service";
import type { BookingItemSnapshot } from "@/modules/inventory/types";
import { assertValidTransition } from "@/modules/booking/state-machine";
import { computeCancellationPenalty } from "@/modules/booking/cancellation";
import { computeBookingPricing } from "@/modules/booking/pricing";
import { buildCheckInMetadata, buildNoShowMetadata } from "@/modules/booking/checkin";
import type { CancellationPolicy, BookingMetadata, BookingDiscount } from "@/modules/booking/types";
import { DEFAULT_CANCELLATION_POLICY } from "@/modules/booking/types";
import { applyDiscount, getMaxDiscountPercent } from "@/modules/booking/discount";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";
import type {
  CreateBookingInput,
  AdminCreateBookingInput,
  CreateResourceInput,
  UpdateResourceInput,
  BookingFilter,
  DayAvailability,
  TimeSlot,
  GazeboResource,
  TimelineData,
  ModuleAnalytics,
} from "./types";

const MODULE_SLUG = "gazebos";

// Operating hours (unified: 08:00–23:00)
const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;
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

export async function createBooking(userId: string | null, input: CreateBookingInput) {
  const { resourceId, date, startTime, endTime, guestCount, comment, items, guestName, guestPhone } = input;

  // Guest checkout: when there's no authenticated user, guestName + guestPhone are required
  // so the manager has something to contact the booker with.
  if (!userId) {
    if (!guestName || !guestPhone) {
      throw new BookingError(
        "GUEST_CONTACTS_REQUIRED",
        "Для бронирования без регистрации укажите имя и телефон"
      );
    }
  }

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

  // Validate items and build snapshot (no stock deduction yet — only on CONFIRMED)
  let itemSnapshots: BookingItemSnapshot[] = [];
  let itemsTotal = 0;
  if (items && items.length > 0) {
    const result = await validateAndSnapshotItems(items);
    itemSnapshots = result.snapshots;
    itemsTotal = result.itemsTotal;
  }

  const pricing = computeBookingPricing(
    start,
    end,
    resource.pricePerHour ? Number(resource.pricePerHour) : null,
    itemsTotal
  );

  const booking = await prisma.booking.create({
    data: {
      moduleSlug: MODULE_SLUG,
      resourceId,
      userId,
      // For guest bookings, store contact info on the row itself so managers
      // can reach out. For authed users this stays NULL.
      clientName: userId ? null : guestName,
      clientPhone: userId ? null : guestPhone,
      date: bookingDate,
      startTime: start,
      endTime: end,
      status: "PENDING",
      metadata: {
        ...(guestCount && { guestCount }),
        ...(comment && { comment }),
        ...(itemSnapshots.length > 0 && {
          items: itemSnapshots,
          itemsTotal: itemsTotal.toFixed(2),
        }),
        basePrice: pricing.basePrice,
        pricePerHour: pricing.pricePerHour,
        totalPrice: pricing.totalPrice,
      },
    },
  });

  enqueueNotification({
    type: "booking.created",
    moduleSlug: MODULE_SLUG,
    entityId: booking.id,
    userId: userId ?? undefined,
    actor: "client",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  return booking;
}

/**
 * Admin creates a booking on behalf of a client.
 * Booking is auto-CONFIRMED since admin is creating it.
 * Client info stored in metadata (no user account required).
 */
export async function createAdminBooking(adminId: string, input: AdminCreateBookingInput) {
  const { resourceId, date, startTime, endTime, guestCount, comment, clientName, clientPhone, items } = input;

  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true },
  });
  if (!resource) {
    throw new BookingError("RESOURCE_NOT_FOUND", "Беседка не найдена или неактивна");
  }

  if (guestCount && resource.capacity && guestCount > resource.capacity) {
    throw new BookingError(
      "CAPACITY_EXCEEDED",
      `Максимальная вместимость: ${resource.capacity} человек`
    );
  }

  const bookingDate = new Date(date);
  const start = parseDatetime(date, startTime);
  const end = parseDatetime(date, endTime);

  if (bookingDate < new Date(new Date().toISOString().split("T")[0])) {
    throw new BookingError("DATE_IN_PAST", "Нельзя бронировать на прошедшую дату");
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
    throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
  }

  // Validate items snapshot (admin booking is auto-CONFIRMED, so deduct immediately)
  let itemSnapshots: BookingItemSnapshot[] = [];
  let itemsTotal = 0;
  if (items && items.length > 0) {
    const result = await validateAndSnapshotItems(items);
    itemSnapshots = result.snapshots;
    itemsTotal = result.itemsTotal;
  }

  const adminPricing = computeBookingPricing(
    start,
    end,
    resource.pricePerHour ? Number(resource.pricePerHour) : null,
    itemsTotal
  );

  // Google Calendar sync for admin-created (auto-confirmed) bookings
  let googleEventId: string | undefined;
  if (resource.googleCalendarId) {
    const calResult = await createCalendarEvent(resource.googleCalendarId, {
      summary: `${resource.name} — ${clientName}`,
      description: `Телефон: ${clientPhone}`,
      startTime: start,
      endTime: end,
    });
    if (calResult.success && calResult.eventId) {
      googleEventId = calResult.eventId;
    }
  }

  // Admin booking is auto-CONFIRMED, so deduct inventory atomically
  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        moduleSlug: MODULE_SLUG,
        resourceId,
        userId: adminId,
        date: bookingDate,
        startTime: start,
        endTime: end,
        status: "CONFIRMED",
        clientName,
        clientPhone,
        ...(googleEventId && { googleEventId }),
        metadata: {
          bookedByAdmin: true,
          ...(guestCount && { guestCount }),
          ...(comment && { comment }),
          ...(itemSnapshots.length > 0 && {
            items: itemSnapshots,
            itemsTotal: itemsTotal.toFixed(2),
          }),
          basePrice: adminPricing.basePrice,
          pricePerHour: adminPricing.pricePerHour,
          totalPrice: adminPricing.totalPrice,
        },
      },
    });

    if (itemSnapshots.length > 0) {
      await saleBookingItems(tx, b.id, MODULE_SLUG, itemSnapshots, adminId);
    }

    return b;
  });

  enqueueNotification({
    type: "booking.confirmed",
    moduleSlug: MODULE_SLUG,
    entityId: booking.id,
    userId: adminId,
    actor: "admin",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  return booking;
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  discountInput?: CheckoutDiscountInput
) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  try {
    assertValidTransition({
      currentStatus: booking.status,
      targetStatus: status,
      actorRole: "MANAGER",
      now: new Date(),
      startTime: booking.startTime,
      noShowThresholdMinutes: 30,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    throw new BookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
  }

  const resource = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
  });

  // Google Calendar sync (async, non-blocking)
  let googleEventId = booking.googleEventId;

  if (status === "CONFIRMED" && resource?.googleCalendarId) {
    // Guest bookings have no userId — fall back to the clientName/clientPhone stored on the Booking row.
    const user = booking.userId
      ? await prisma.user.findUnique({
          where: { id: booking.userId },
          select: { name: true, phone: true },
        })
      : null;
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

  // Extract booking items snapshot from metadata
  const metadata = booking.metadata as Record<string, unknown> | null;
  const items = (metadata?.items ?? []) as BookingItemSnapshot[];
  // Guest bookings have no userId — a manager must always be the actor here.
  // Authed user paths still let the owner be the performer.
  const performedById = managerId ?? booking.userId;
  if (!performedById) {
    throw new BookingError(
      "NO_ACTOR",
      "Для изменения статуса guest-брони требуется менеджер"
    );
  }

  let updated;

  if (status === "CONFIRMED" && items.length > 0) {
    updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status,
          ...(managerId && { managerId }),
          ...(googleEventId !== booking.googleEventId && { googleEventId }),
        },
      });
      await saleBookingItems(tx, id, MODULE_SLUG, items, performedById);
      return b;
    });
  } else if (
    status === "CANCELLED" &&
    booking.status === "CONFIRMED" &&
    items.length > 0
  ) {
    updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status,
          ...(managerId && { managerId }),
          ...(cancelReason && { cancelReason }),
          ...(googleEventId !== booking.googleEventId && { googleEventId }),
        },
      });
      await returnBookingItems(tx, id, MODULE_SLUG, items, performedById);
      return b;
    });
  } else if (status === "COMPLETED") {
    // === CHECKOUT with optional discount ===
    const existingMeta = (booking.metadata as BookingMetadata | null) ?? {};
    let discountData: BookingDiscount | undefined;

    if (discountInput && discountInput.discountPercent > 0) {
      const maxPercent = await getMaxDiscountPercent(MODULE_SLUG);
      if (discountInput.discountPercent > maxPercent) {
        throw new BookingError(
          "DISCOUNT_EXCEEDS_LIMIT",
          `Максимальная скидка для этого модуля: ${maxPercent}%`
        );
      }

      const originalAmount = Number(existingMeta.totalPrice ?? 0);
      const { discountAmount, finalAmount } = applyDiscount(originalAmount, discountInput.discountPercent);

      discountData = {
        percent: discountInput.discountPercent,
        amount: discountAmount.toFixed(2),
        originalAmount: originalAmount.toFixed(2),
        finalAmount: finalAmount.toFixed(2),
        reason: discountInput.discountReason,
        ...(discountInput.discountNote && { note: discountInput.discountNote }),
        appliedBy: performedById,
        appliedAt: new Date().toISOString(),
      };
    }

    const updatedMetadata = {
      ...existingMeta,
      ...(discountData && {
        discount: discountData,
        totalPrice: discountData.finalAmount,
      }),
    };

    updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status,
          ...(managerId && { managerId }),
          ...(googleEventId !== booking.googleEventId && { googleEventId }),
          metadata: updatedMetadata as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });

      if (discountData) {
        const managerUser = await tx.user.findUnique({
          where: { id: performedById },
          select: { name: true, email: true },
        });

        await tx.auditLog.create({
          data: {
            userId: performedById,
            action: "booking.discount_applied",
            entity: "Booking",
            entityId: id,
            metadata: {
              managerId: performedById,
              managerName: managerUser?.name ?? managerUser?.email ?? "Менеджер",
              bookingId: id,
              moduleSlug: MODULE_SLUG,
              resourceName: resource?.name ?? "--",
              clientName: booking.clientName ?? "--",
              originalAmount: Number(discountData.originalAmount),
              discountPercent: discountData.percent,
              discountAmount: Number(discountData.amount),
              finalAmount: Number(discountData.finalAmount),
              discountReason: discountData.reason,
              ...(discountData.note && { discountNote: discountData.note }),
              appliedAt: discountData.appliedAt,
            },
          },
        });
      }

      return b;
    });
  } else {
    updated = await prisma.booking.update({
      where: { id },
      data: {
        status,
        ...(managerId && { managerId }),
        ...(cancelReason && { cancelReason }),
        ...(googleEventId !== booking.googleEventId && { googleEventId }),
      },
    });
  }

  const dateStr = booking.date.toISOString().split("T")[0];
  const startStr = booking.startTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const endStr = booking.endTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const notificationType =
    status === "CONFIRMED"
      ? "booking.confirmed"
      : status === "CANCELLED"
      ? "booking.cancelled"
      : "booking.completed";

  enqueueNotification({
    type: notificationType,
    moduleSlug: MODULE_SLUG,
    entityId: id,
    // Guest bookings have no user to notify — the channel is a manager-initiated callback.
    userId: booking.userId ?? undefined,
    actor: "admin",
    data: { resourceName: resource?.name || "", date: dateStr, startTime: startStr, endTime: endStr },
  });

  return updated;
}

export async function cancelBooking(
  id: string,
  userId: string,
  cancelReason?: string,
  confirmPenalty = false,
  policy: CancellationPolicy = DEFAULT_CANCELLATION_POLICY
): Promise<{ penaltyRequired: true; penaltyAmount: number; basePrice: number } | { penaltyRequired: false; booking: ReturnType<typeof prisma.booking.update> extends Promise<infer T> ? T : never }> {
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

  const metadata = booking.metadata as BookingMetadata | null;
  const basePrice = Number(metadata?.basePrice ?? 0);

  const cancellationResult = computeCancellationPenalty(
    booking.startTime,
    new Date(),
    basePrice,
    policy,
    false
  );

  if (cancellationResult.penaltyApplied && !confirmPenalty) {
    return {
      penaltyRequired: true,
      penaltyAmount: cancellationResult.penaltyAmount,
      basePrice: cancellationResult.basePrice,
    };
  }

  // Delete from Google Calendar if synced
  const resourceForCal = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
    select: { googleCalendarId: true, name: true },
  });
  if (booking.googleEventId && resourceForCal?.googleCalendarId) {
    await deleteCalendarEvent(resourceForCal.googleCalendarId, booking.googleEventId);
  }

  // Return inventory if booking was CONFIRMED and had items
  const wasConfirmed = booking.status === "CONFIRMED";
  const metadataForItems = booking.metadata as BookingMetadata | null;
  const items = (metadataForItems?.items ?? []) as BookingItemSnapshot[];

  const penaltyMetadata =
    cancellationResult.penaltyApplied
      ? {
          cancelPenalty: {
            amount: cancellationResult.penaltyAmount.toFixed(2),
            reason: "late_cancellation",
            appliedAt: new Date().toISOString(),
          },
        }
      : {};

  const updatedMetadata = { ...metadataForItems, ...penaltyMetadata } as import("@prisma/client").Prisma.InputJsonValue;

  let updated;
  if (wasConfirmed && items.length > 0) {
    updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: "CANCELLED",
          googleEventId: null,
          ...(cancelReason && { cancelReason }),
          metadata: updatedMetadata,
        },
      });
      await returnBookingItems(tx, id, MODULE_SLUG, items, userId);
      return b;
    });
  } else {
    updated = await prisma.booking.update({
      where: { id },
      data: {
        status: "CANCELLED",
        googleEventId: null,
        ...(cancelReason && { cancelReason }),
        metadata: updatedMetadata,
      },
    });
  }

  const resource = resourceForCal;
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

  return { penaltyRequired: false, booking: updated };
}

// === CHECK-IN ===

export async function checkInBooking(bookingId: string, managerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

  const now = new Date();

  try {
    assertValidTransition({
      currentStatus: booking.status,
      targetStatus: "CHECKED_IN",
      actorRole: "MANAGER",
      now,
      startTime: booking.startTime,
      noShowThresholdMinutes: 30,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    throw new BookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
  }

  const checkinData = buildCheckInMetadata(managerId, now);
  const existingMetadata = (booking.metadata as BookingMetadata | null) ?? {};

  const isFromNoShow = booking.status === "NO_SHOW";
  const newMetadata = (isFromNoShow
    ? { ...existingMetadata, lateCheckedInAt: checkinData.checkedInAt, checkedInBy: managerId }
    : { ...existingMetadata, ...checkinData }) as import("@prisma/client").Prisma.InputJsonValue;

  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "CHECKED_IN",
      managerId,
      metadata: newMetadata,
    },
  });
}

// === MARK NO-SHOW ===

export async function markNoShow(
  bookingId: string,
  actorId: string,
  reason: "manual" | "auto" = "manual"
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

  const now = new Date();
  const actorRole = reason === "auto" ? "CRON" : "MANAGER";

  try {
    assertValidTransition({
      currentStatus: booking.status,
      targetStatus: "NO_SHOW",
      actorRole,
      now,
      startTime: booking.startTime,
      noShowThresholdMinutes: 30,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    throw new BookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
  }

  const noShowData = buildNoShowMetadata(reason, now, actorId);
  const existingMetadata = (booking.metadata as BookingMetadata | null) ?? {};

  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "NO_SHOW",
      metadata: { ...existingMetadata, ...noShowData } as import("@prisma/client").Prisma.InputJsonValue,
    },
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

// === TIMELINE ===

export async function getTimeline(date: string): Promise<TimelineData> {
  const resources = await prisma.resource.findMany({
    where: { moduleSlug: MODULE_SLUG, isActive: true },
    orderBy: { name: "asc" },
  });

  const bookingDate = new Date(date);
  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      date: bookingDate,
      status: { in: ["PENDING", "CONFIRMED"] },
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
  });

  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) =>
    `${(OPEN_HOUR + i).toString().padStart(2, "0")}:00`
  );

  return {
    date,
    resources,
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status as "PENDING" | "CONFIRMED",
      clientName: b.clientName,
      clientPhone: b.clientPhone,
      metadata: b.metadata as Record<string, unknown> | null,
    })),
    hours,
  };
}

// === ANALYTICS ===

export async function getAnalytics(period: "week" | "month" | "quarter"): Promise<ModuleAnalytics> {
  const now = new Date();
  const dateFrom = new Date(now);
  if (period === "week") dateFrom.setDate(dateFrom.getDate() - 7);
  else if (period === "month") dateFrom.setMonth(dateFrom.getMonth() - 1);
  else dateFrom.setMonth(dateFrom.getMonth() - 3);

  // Fetch resources first for name lookup and occupancy calculation
  const resources = await prisma.resource.findMany({
    where: { moduleSlug: MODULE_SLUG, isActive: true },
  });
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      date: { gte: dateFrom },
    },
  });

  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const cancelled = bookings.filter((b) => b.status === "CANCELLED");

  // Revenue from completed bookings metadata
  let totalRevenue = 0;
  for (const b of completed) {
    const meta = b.metadata as Record<string, unknown> | null;
    const price = meta?.totalPrice as number | undefined;
    if (price) totalRevenue += price;
    else {
      const resource = resourceMap.get(b.resourceId);
      if (resource?.pricePerHour) {
        const hours = (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60);
        totalRevenue += hours * Number(resource.pricePerHour);
      }
    }
  }

  const averageCheck = completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0;

  const totalSlots = resources.length * (CLOSE_HOUR - OPEN_HOUR) * Math.ceil((now.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
  const bookedSlots = bookings.filter((b) => ["CONFIRMED", "COMPLETED", "CHECKED_IN"].includes(b.status)).length;
  const occupancyRate = totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) / 100 : 0;

  // By day
  const byDayMap = new Map<string, { bookings: number; revenue: number }>();
  for (const b of bookings) {
    const day = b.date.toISOString().split("T")[0];
    const entry = byDayMap.get(day) ?? { bookings: 0, revenue: 0 };
    entry.bookings++;
    if (b.status === "COMPLETED") {
      const meta = b.metadata as Record<string, unknown> | null;
      const price = meta?.totalPrice as number | undefined;
      if (price) entry.revenue += price;
      else {
        const resource = resourceMap.get(b.resourceId);
        if (resource?.pricePerHour) {
          const hours = (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60);
          entry.revenue += hours * Number(resource.pricePerHour);
        }
      }
    }
    byDayMap.set(day, entry);
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // By resource
  const byResourceMap = new Map<string, { resourceName: string; bookings: number; revenue: number }>();
  for (const b of bookings) {
    const resource = resourceMap.get(b.resourceId);
    const entry = byResourceMap.get(b.resourceId) ?? {
      resourceName: resource?.name ?? "—",
      bookings: 0,
      revenue: 0,
    };
    entry.bookings++;
    byResourceMap.set(b.resourceId, entry);
  }
  const byResource = Array.from(byResourceMap.entries())
    .map(([resourceId, data]) => ({ resourceId, ...data }))
    .sort((a, b) => b.bookings - a.bookings);

  // Top hours
  const hourCounts = new Map<number, number>();
  for (const b of bookings) {
    const hour = b.startTime.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const topHours = Array.from(hourCounts.entries())
    .map(([hour, bookings]) => ({ hour, bookings }))
    .sort((a, b) => b.bookings - a.bookings);

  return {
    totalBookings: bookings.length,
    completedBookings: completed.length,
    cancelledBookings: cancelled.length,
    totalRevenue,
    averageCheck,
    occupancyRate,
    byDay,
    byResource,
    topHours,
  };
}

// === PAGINATED BOOKINGS ===

export async function listBookingsPaginated(params: {
  page?: number;
  perPage?: number;
  status?: string;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const skip = (page - 1) * perPage;

  const where: Record<string, unknown> = { moduleSlug: MODULE_SLUG };
  if (params.status) where.status = params.status;
  if (params.resourceId) where.resourceId = params.resourceId;
  if (params.dateFrom || params.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (params.dateFrom) dateFilter.gte = new Date(params.dateFrom);
    if (params.dateTo) dateFilter.lte = new Date(params.dateTo);
    where.date = dateFilter;
  }

  const [rawBookings, total, resources] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        user: { select: { name: true, phone: true, email: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take: perPage,
    }),
    prisma.booking.count({ where }),
    prisma.resource.findMany({ where: { moduleSlug: MODULE_SLUG } }),
  ]);

  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const bookings = rawBookings.map((b) => ({
    ...b,
    resource: resourceMap.get(b.resourceId) ?? null,
  }));

  return { bookings, total, page, perPage };
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
