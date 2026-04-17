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
import type { BookingItemSnapshot, BookingItemInput } from "@/modules/inventory/types";
import { assertValidTransition } from "@/modules/booking/state-machine";
import { computeCancellationPenalty } from "@/modules/booking/cancellation";
import { computeBookingPricing } from "@/modules/booking/pricing";
import { buildCheckInMetadata, buildNoShowMetadata } from "@/modules/booking/checkin";
import type { CancellationPolicy, BookingMetadata, BookingDiscount } from "@/modules/booking/types";
import { DEFAULT_CANCELLATION_POLICY } from "@/modules/booking/types";
import { applyDiscount, getMaxDiscountPercent } from "@/modules/booking/discount";
import type { DiscountReason } from "@/modules/booking/discount";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";
import type {
  CreatePSBookingInput,
  AdminCreatePSBookingInput,
  CreateTableInput,
  UpdateTableInput,
  PSBookingFilter,
  DayAvailability,
  TimeSlot,
  PSTableResource,
  TimelineData,
  ActiveSession,
  BookingBill,
  BookingItemSnapshotWithSubtotal,
  DayReport,
  ShiftHandoverData,
  FinancialTransactionRecord,
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
  const { resourceId, date, startTime, endTime, playerCount, comment, items } = input;

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
      date: bookingDate,
      startTime: start,
      endTime: end,
      status: "PENDING",
      metadata: {
        ...(playerCount && { playerCount }),
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
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number,
  discountInput?: CheckoutDiscountInput
) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!booking) {
    throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
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
    throw new PSBookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
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

  // Extract booking items snapshot from metadata
  const metadata = booking.metadata as Record<string, unknown> | null;
  const items = (metadata?.items ?? []) as BookingItemSnapshot[];
  const performedById = managerId ?? booking.userId;

  // Build bill snapshot when completing a session
  let billSnapshot: Record<string, unknown> | undefined;
  let completedBilledHours = 0;
  let completedPricePerHour = 0;
  let completedItemsTotal = 0;
  let completedTotalBill = 0;

  if (status === "COMPLETED") {
    completedPricePerHour = Number(resource?.pricePerHour ?? 0);
    completedBilledHours = billedHours(booking.startTime, booking.endTime);
    const hoursCost = completedBilledHours * completedPricePerHour;
    const durationMin = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / (1000 * 60));
    const billItems = items.map((i) => ({
      skuId: i.skuId,
      skuName: i.skuName,
      quantity: i.quantity,
      price: Number(i.priceAtBooking),
      subtotal: i.quantity * Number(i.priceAtBooking),
    }));
    completedItemsTotal = billItems.reduce((sum, i) => sum + i.subtotal, 0);
    completedTotalBill = hoursCost + completedItemsTotal;
    billSnapshot = {
      resourceName: resource?.name ?? "—",
      clientName: booking.clientName ?? "—",
      date: booking.date.toISOString().split("T")[0],
      startTime: formatMoscowTime(booking.startTime),
      endTime: formatMoscowTime(booking.endTime),
      durationMin,
      billedHours: completedBilledHours,
      pricePerHour: completedPricePerHour,
      hoursCost,
      items: billItems,
      itemsTotal: completedItemsTotal,
      totalBill: completedTotalBill,
      completedAt: new Date().toISOString(),
    };
  }

  const metadataWithBill = billSnapshot
    ? ({ ...(metadata ?? {}), bill: billSnapshot } as Record<string, unknown>)
    : undefined;

  let updated;

  if (status === "CONFIRMED" && items.length > 0) {
    // Atomically update booking status + deduct inventory
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
    // Atomically update booking status + return inventory
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
    // === Apply discount if provided ===
    let discountData: BookingDiscount | undefined;

    if (discountInput && discountInput.discountPercent > 0) {
      const maxPercent = await getMaxDiscountPercent(MODULE_SLUG);
      if (discountInput.discountPercent > maxPercent) {
        throw new PSBookingError(
          "DISCOUNT_EXCEEDS_LIMIT",
          `Максимальная скидка для этого модуля: ${maxPercent}%`
        );
      }

      const originalAmount = completedTotalBill;
      const discountCalc = applyDiscount(originalAmount, discountInput.discountPercent);

      discountData = {
        percent: discountInput.discountPercent,
        amount: discountCalc.discountAmount.toFixed(2),
        originalAmount: originalAmount.toFixed(2),
        finalAmount: discountCalc.finalAmount.toFixed(2),
        reason: discountInput.discountReason as DiscountReason,
        ...(discountInput.discountNote && { note: discountInput.discountNote }),
        appliedBy: managerId ?? booking.userId,
        appliedAt: new Date().toISOString(),
      };

      // Enrich bill snapshot with discount info
      if (billSnapshot) {
        billSnapshot.originalAmount = originalAmount;
        billSnapshot.discountPercent = discountInput.discountPercent;
        billSnapshot.discountAmount = discountCalc.discountAmount;
        billSnapshot.finalAmount = discountCalc.finalAmount;
      }

      // Use discounted amount for financial transaction
      completedTotalBill = discountCalc.finalAmount;
    }

    const resolvedCash = cashAmount ?? completedTotalBill;
    const resolvedCard = cardAmount ?? 0;
    const managerUser = managerId
      ? await prisma.user.findUnique({ where: { id: managerId }, select: { name: true, email: true } })
      : null;
    const managerName = managerUser?.name ?? managerUser?.email ?? "Менеджер";

    // Add discount to booking metadata
    const finalMetadata = discountData && metadataWithBill
      ? { ...metadataWithBill, discount: discountData }
      : metadataWithBill;

    updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status,
          ...(managerId && { managerId }),
          ...(finalMetadata && { metadata: finalMetadata as unknown as import("@prisma/client").Prisma.InputJsonValue }),
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
        },
      });

      // Financial ledger — immutable record (totalAmount = after discount)
      await tx.financialTransaction.create({
        data: {
          moduleSlug: MODULE_SLUG,
          type: "SESSION_PAYMENT",
          bookingId: id,
          totalAmount: completedTotalBill,
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
          performedById: managerId ?? booking.userId,
          performedByName: managerName,
          description: `Сессия: ${billSnapshot?.resourceName ?? "—"} · ${billSnapshot?.clientName ?? "—"}`,
          metadata: billSnapshot ? (billSnapshot as unknown as import("@prisma/client").Prisma.InputJsonValue) : undefined,
        },
      });

      // Audit log for discount (inside transaction for atomicity)
      if (discountData) {
        await tx.auditLog.create({
          data: {
            userId: managerId ?? booking.userId,
            action: "booking.discount_applied",
            entity: "Booking",
            entityId: id,
            metadata: {
              managerId: managerId ?? booking.userId,
              managerName,
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
        ...(metadataWithBill && { metadata: metadataWithBill as unknown as import("@prisma/client").Prisma.InputJsonValue }),
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
    userId: booking.userId,
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

  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  if (booking.userId !== userId) throw new PSBookingError("FORBIDDEN", "Нельзя отменить чужое бронирование");
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    throw new PSBookingError("INVALID_STATUS_TRANSITION", "Бронирование уже завершено или отменено");
  }

  const metadata = booking.metadata as BookingMetadata | null;
  const basePrice = Number(metadata?.basePrice ?? 0);

  const cancellationResult = computeCancellationPenalty(
    booking.startTime,
    new Date(),
    basePrice,
    policy,
    false // not skipping for client cancellations
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

  // Build updated metadata with penalty info if applicable
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

export async function createAdminBooking(adminId: string, input: AdminCreatePSBookingInput) {
  const { resourceId, date, startTime, endTime, playerCount, comment, clientName, clientPhone, items } = input;

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

  // Find or create client User record so they appear in the Clients section
  let clientUserId: string;
  if (clientPhone) {
    const existingUser = await prisma.user.findFirst({ where: { phone: clientPhone } });
    if (existingUser) {
      // Update name if it changed
      if (existingUser.name !== clientName) {
        await prisma.user.update({ where: { id: existingUser.id }, data: { name: clientName } });
      }
      clientUserId = existingUser.id;
    } else {
      const newUser = await prisma.user.create({
        data: { name: clientName, phone: clientPhone, role: "USER" },
      });
      clientUserId = newUser.id;
    }
  } else {
    const newUser = await prisma.user.create({
      data: { name: clientName, role: "USER" },
    });
    clientUserId = newUser.id;
  }

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

  let googleEventId: string | undefined;
  if (resource.googleCalendarId) {
    const calResult = await createCalendarEvent(resource.googleCalendarId, {
      summary: `${resource.name} — ${clientName}`,
      description: clientPhone ? `Телефон: ${clientPhone}` : clientName,
      startTime: start,
      endTime: end,
    });
    if (calResult.success && calResult.eventId) {
      googleEventId = calResult.eventId;
    }
  }

  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        moduleSlug: MODULE_SLUG,
        resourceId,
        userId: clientUserId,
        managerId: adminId,
        date: bookingDate,
        startTime: start,
        endTime: end,
        status: "CONFIRMED",
        clientName,
        ...(clientPhone && { clientPhone }),
        ...(googleEventId && { googleEventId }),
        metadata: {
          bookedByAdmin: true,
          ...(playerCount && { playerCount }),
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
    userId: clientUserId,
    actor: "admin",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  return booking;
}

// === CHECK-IN ===

export async function checkInBooking(bookingId: string, managerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });
  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

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
    throw new PSBookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
  }

  const checkinData = buildCheckInMetadata(managerId, now);
  const existingMetadata = (booking.metadata as BookingMetadata | null) ?? {};

  // Handle NO_SHOW → CHECKED_IN (late arrival)
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
  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

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
    throw new PSBookingError(e.code ?? "INVALID_STATUS_TRANSITION", e.message ?? "Недопустимый переход");
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

export async function addItemsToBooking(
  bookingId: string,
  managerId: string,
  newItems: BookingItemInput[]
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });

  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    throw new PSBookingError("INVALID_STATUS", "Товары можно добавлять только к активным бронированиям");
  }

  const { snapshots, itemsTotal: newItemsTotal } = await validateAndSnapshotItems(newItems);

  const metadata = (booking.metadata as Record<string, unknown>) ?? {};
  const existingItems = (metadata.items ?? []) as BookingItemSnapshot[];
  const existingTotal = Number(metadata.itemsTotal ?? 0);

  // Merge: add quantity if same SKU already exists, otherwise append
  const mergedMap = new Map<string, BookingItemSnapshot>();
  for (const item of existingItems) {
    mergedMap.set(item.skuId, { ...item });
  }
  for (const snap of snapshots) {
    const existing = mergedMap.get(snap.skuId);
    if (existing) {
      mergedMap.set(snap.skuId, { ...existing, quantity: existing.quantity + snap.quantity });
    } else {
      mergedMap.set(snap.skuId, snap);
    }
  }

  const newMetadata = {
    ...metadata,
    items: Array.from(mergedMap.values()),
    itemsTotal: (existingTotal + newItemsTotal).toFixed(2),
  };

  if (booking.status === "CONFIRMED") {
    // Already confirmed — deduct stock immediately
    return prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: bookingId },
        data: { metadata: newMetadata },
      });
      await saleBookingItems(tx, bookingId, MODULE_SLUG, snapshots, managerId);
      return b;
    });
  }

  // PENDING — snapshot only; stock deducted on confirmation
  return prisma.booking.update({
    where: { id: bookingId },
    data: { metadata: newMetadata },
  });
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

// === ACTIVE SESSIONS ===

export async function getActiveSessions(): Promise<ActiveSession[]> {
  const now = new Date();
  const today = new Date(now.toISOString().split("T")[0]);

  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      status: "CONFIRMED",
      date: today,
      startTime: { lte: now },
      endTime: { gt: now },
    },
    orderBy: { startTime: "asc" },
  });

  const resourceIds = [...new Set(bookings.map((b) => b.resourceId))];
  const resources = await prisma.resource.findMany({
    where: { id: { in: resourceIds } },
  });
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  return bookings.map((b) => {
    const resource = resourceMap.get(b.resourceId);
    const metadata = b.metadata as Record<string, unknown> | null;
    const pricePerHour = Number(resource?.pricePerHour ?? 0);
    const billed = billedHours(b.startTime, b.endTime);
    const durationMin = Math.round((b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60));
    const hoursCost = billed * pricePerHour;
    const rawItems = (metadata?.items ?? []) as BookingItemSnapshot[];
    const itemsTotal = Number(metadata?.itemsTotal ?? 0);

    return {
      bookingId: b.id,
      resourceId: b.resourceId,
      resourceName: resource?.name ?? "—",
      clientName: b.clientName ?? "—",
      clientPhone: b.clientPhone,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: "CONFIRMED" as const,
      pricePerHour,
      durationMin,
      billedHours: billed,
      hoursCost,
      items: rawItems.map((i) => ({
        skuId: i.skuId,
        skuName: i.skuName,
        quantity: i.quantity,
        price: Number(i.priceAtBooking),
        subtotal: i.quantity * Number(i.priceAtBooking),
      })),
      itemsTotal,
      totalBill: hoursCost + itemsTotal,
    };
  });
}

// === EXTEND BOOKING ===

export async function extendBooking(bookingId: string, managerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });

  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  if (booking.status !== "CONFIRMED") {
    throw new PSBookingError("INVALID_STATUS", "Продлить можно только подтверждённое бронирование");
  }

  const newEndTime = new Date(booking.endTime.getTime() + 60 * 60 * 1000);
  const endHour = getMoscowHour(newEndTime);
  // Handle midnight wrap (0) or exceeding close hour
  const beyondClosing = endHour > CLOSE_HOUR || endHour < OPEN_HOUR || (endHour === CLOSE_HOUR && newEndTime.getMinutes() > 0);
  if (beyondClosing) {
    throw new PSBookingError("BEYOND_CLOSING", "Нельзя продлить за пределы рабочего времени (до 23:00)");
  }

  const conflict = await prisma.booking.findFirst({
    where: {
      moduleSlug: MODULE_SLUG,
      resourceId: booking.resourceId,
      id: { not: bookingId },
      status: { in: ["PENDING", "CONFIRMED"] },
      date: booking.date,
      startTime: { lt: newEndTime },
      endTime: { gt: booking.endTime },
    },
  });

  if (conflict) {
    throw new PSBookingError("BOOKING_CONFLICT", "Следующий час занят другим бронированием");
  }

  return prisma.booking.update({
    where: { id: bookingId },
    data: { endTime: newEndTime, managerId },
  });
}

// === BOOKING BILL ===

export async function getBookingBill(bookingId: string): Promise<BookingBill> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });
  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

  const resource = await prisma.resource.findUnique({ where: { id: booking.resourceId } });
  const metadata = booking.metadata as Record<string, unknown> | null;
  const rawItems = (metadata?.items ?? []) as BookingItemSnapshot[];
  const pricePerHour = Number(resource?.pricePerHour ?? 0);
  const billed = billedHours(booking.startTime, booking.endTime);
  const durationMin = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / (1000 * 60));
  const hoursCost = billed * pricePerHour;

  const items: BookingItemSnapshotWithSubtotal[] = rawItems.map((i) => ({
    skuId: i.skuId,
    skuName: i.skuName,
    quantity: i.quantity,
    price: Number(i.priceAtBooking),
    subtotal: i.quantity * Number(i.priceAtBooking),
  }));
  const itemsTotal = items.reduce((sum, i) => sum + i.subtotal, 0);

  return {
    bookingId: booking.id,
    resourceName: resource?.name ?? "—",
    clientName: booking.clientName ?? "—",
    date: booking.date.toISOString().split("T")[0],
    startTime: formatMoscowTime(booking.startTime),
    endTime: formatMoscowTime(booking.endTime),
    durationMin,
    billedHours: billed,
    pricePerHour,
    hoursCost,
    items,
    itemsTotal,
    totalBill: hoursCost + itemsTotal,
  };
}

// === HELPERS ===

/** Parse a date+time string as Moscow local time (UTC+3). */
function parseDatetime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

/** Format a UTC Date object as HH:MM in Moscow timezone. */
function formatMoscowTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Get the hour (0-23) of a Date in Moscow timezone. */
function getMoscowHour(d: Date): number {
  return parseInt(
    d.toLocaleString("en-US", { timeZone: "Europe/Moscow", hour: "numeric", hour12: false }),
    10
  );
}

/**
 * Rounds duration up to the nearest 30-minute increment for billing.
 * e.g. 1h 01min → 1.5h, 1h 31min → 2h, 30min → 0.5h
 */
function billedHours(startTime: Date, endTime: Date): number {
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMin = durationMs / (1000 * 60);
  return Math.ceil(durationMin / 30) * 0.5;
}

// === DAY REPORT & SHIFT HANDOVER ===

export async function getDayReport(date: string): Promise<DayReport> {
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const txs = await prisma.financialTransaction.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      type: "SESSION_PAYMENT",
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  const cashTotal = txs.reduce((s, t) => s + Number(t.cashAmount), 0);
  const cardTotal = txs.reduce((s, t) => s + Number(t.cardAmount), 0);
  const cashCount = txs.filter((t) => Number(t.cashAmount) > 0).length;
  const cardCount = txs.filter((t) => Number(t.cardAmount) > 0).length;

  return {
    date,
    totalSessions: txs.length,
    cashTotal,
    cardTotal,
    totalRevenue: cashTotal + cardTotal,
    cashCount,
    cardCount,
    transactions: txs.map((t) => ({
      id: t.id,
      bookingId: t.bookingId ?? null,
      totalAmount: Number(t.totalAmount),
      cashAmount: Number(t.cashAmount),
      cardAmount: Number(t.cardAmount),
      performedByName: t.performedByName,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function getTodayShift(date: string): Promise<ShiftHandoverData | null> {
  const shift = await prisma.shiftHandover.findUnique({
    where: { moduleSlug_date: { moduleSlug: MODULE_SLUG, date } },
  });
  if (!shift) return null;
  return {
    id: shift.id,
    date: shift.date,
    status: shift.status,
    openedAt: shift.openedAt.toISOString(),
    openedById: shift.openedById,
    openedByName: shift.openedByName,
    closedAt: shift.closedAt?.toISOString() ?? null,
    closedById: shift.closedById ?? null,
    closedByName: shift.closedByName ?? null,
    notes: shift.notes ?? null,
  };
}

export async function openShift(
  date: string,
  managerId: string,
  managerName: string
): Promise<ShiftHandoverData> {
  const existing = await prisma.shiftHandover.findUnique({
    where: { moduleSlug_date: { moduleSlug: MODULE_SLUG, date } },
  });
  if (existing) {
    throw new PSBookingError("SHIFT_ALREADY_OPEN", "Смена на эту дату уже открыта");
  }
  const shift = await prisma.shiftHandover.create({
    data: {
      moduleSlug: MODULE_SLUG,
      date,
      openedById: managerId,
      openedByName: managerName,
      status: "OPEN",
    },
  });
  return {
    id: shift.id,
    date: shift.date,
    status: shift.status,
    openedAt: shift.openedAt.toISOString(),
    openedById: shift.openedById,
    openedByName: shift.openedByName,
    closedAt: null,
    closedById: null,
    closedByName: null,
    notes: null,
  };
}

export async function closeShift(
  date: string,
  managerId: string,
  managerName: string,
  notes?: string
): Promise<ShiftHandoverData> {
  const existing = await prisma.shiftHandover.findUnique({
    where: { moduleSlug_date: { moduleSlug: MODULE_SLUG, date } },
  });
  if (!existing) {
    throw new PSBookingError("SHIFT_NOT_FOUND", "Смена не найдена");
  }
  if (existing.status === "CLOSED") {
    throw new PSBookingError("SHIFT_ALREADY_CLOSED", "Смена уже закрыта");
  }
  const report = await getDayReport(date);

  const shift = await prisma.shiftHandover.update({
    where: { id: existing.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: managerId,
      closedByName: managerName,
      cashTotal: report.cashTotal,
      cardTotal: report.cardTotal,
      ...(notes && { notes }),
    },
  });
  return {
    id: shift.id,
    date: shift.date,
    status: shift.status,
    openedAt: shift.openedAt.toISOString(),
    openedById: shift.openedById,
    openedByName: shift.openedByName,
    closedAt: shift.closedAt?.toISOString() ?? null,
    closedById: shift.closedById ?? null,
    closedByName: shift.closedByName ?? null,
    notes: shift.notes ?? null,
  };
}

// === ANALYTICS ===

export type PSAnalytics = {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  averageCheck: number;
  occupancyRate: number;
  byDay: { date: string; bookings: number; revenue: number }[];
  byResource: { resourceId: string; resourceName: string; bookings: number; revenue: number }[];
  topHours: { hour: number; bookings: number }[];
};

export async function getAnalytics(period: "week" | "month" | "quarter"): Promise<PSAnalytics> {
  const now = new Date();
  const dateFrom = new Date(now);
  if (period === "week") dateFrom.setDate(dateFrom.getDate() - 7);
  else if (period === "month") dateFrom.setMonth(dateFrom.getMonth() - 1);
  else dateFrom.setMonth(dateFrom.getMonth() - 3);

  const resources = await prisma.resource.findMany({
    where: { moduleSlug: MODULE_SLUG, isActive: true },
  });
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  const bookings = await prisma.booking.findMany({
    where: { moduleSlug: MODULE_SLUG, date: { gte: dateFrom } },
  });

  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const cancelled = bookings.filter((b) => b.status === "CANCELLED");

  // Revenue from financial transactions (more accurate for PS Park)
  const transactions = await prisma.financialTransaction.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      type: "SESSION_PAYMENT",
      createdAt: { gte: dateFrom },
    },
  });
  const totalRevenue = transactions.reduce((sum, t) => sum + Number(t.totalAmount), 0);
  const averageCheck = completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0;

  const totalSlots = resources.length * (CLOSE_HOUR - OPEN_HOUR) * Math.ceil((now.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
  const bookedSlots = bookings.filter((b) => ["CONFIRMED", "COMPLETED", "CHECKED_IN"].includes(b.status)).length;
  const occupancyRate = totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) / 100 : 0;

  const byDayMap = new Map<string, { bookings: number; revenue: number }>();
  for (const b of bookings) {
    const day = b.date.toISOString().split("T")[0];
    const entry = byDayMap.get(day) ?? { bookings: 0, revenue: 0 };
    entry.bookings++;
    byDayMap.set(day, entry);
  }
  for (const t of transactions) {
    const day = t.createdAt.toISOString().split("T")[0];
    const entry = byDayMap.get(day) ?? { bookings: 0, revenue: 0 };
    entry.revenue += Number(t.totalAmount);
    byDayMap.set(day, entry);
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byResourceMap = new Map<string, { resourceName: string; bookings: number; revenue: number }>();
  for (const b of bookings) {
    const resource = resourceMap.get(b.resourceId);
    const entry = byResourceMap.get(b.resourceId) ?? {
      resourceName: resource?.name ?? "—",
      bookings: 0, revenue: 0,
    };
    entry.bookings++;
    byResourceMap.set(b.resourceId, entry);
  }
  const byResource = Array.from(byResourceMap.entries())
    .map(([resourceId, data]) => ({ resourceId, ...data }))
    .sort((a, b) => b.bookings - a.bookings);

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
    totalRevenue, averageCheck, occupancyRate,
    byDay, byResource, topHours,
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

export class PSBookingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PSBookingError";
  }
}
