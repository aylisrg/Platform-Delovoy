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
import { assertValidTransition, ACTIVE_BOOKING_STATUSES } from "@/modules/booking/state-machine";
import { computeCancellationPenalty } from "@/modules/booking/cancellation";
import { buildCheckInMetadata, buildNoShowMetadata } from "@/modules/booking/checkin";
import { lockSlot } from "@/modules/booking/slot-lock";
import type { CancellationPolicy, BookingMetadata, BookingDiscount } from "@/modules/booking/types";
import { DEFAULT_CANCELLATION_POLICY, PREPAID_CANCELLATION_POLICY } from "@/modules/booking/types";
import { createOnlinePayment, autoRefundOnCancellation } from "@/modules/payments/service";
import { PaymentError } from "@/modules/payments/types";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { receiptsEnabled } from "@/lib/yookassa/receipts";
import { applyDiscount, getMaxDiscountPercent } from "@/modules/booking/discount";
import { getResourcePricing, computeGazeboPricing } from "./pricing";
import { formatTime, getMoscowHour, parseMoscowDateTime } from "@/lib/format";
import { logAudit } from "@/lib/logger";
import { upsertClientByPhone } from "@/modules/clients/service";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";
import type { RescheduleBookingInput } from "./validation";
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
const DEFAULT_MIN_BOOKING_HOURS = 4;

function pluralHours(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "час";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "часа";
  return "часов";
}

export async function getMinBookingHours(): Promise<number> {
  const moduleRecord = await prisma.module.findUnique({ where: { slug: MODULE_SLUG } });
  const config = moduleRecord?.config as Record<string, unknown> | null;
  const val = config?.minBookingHours;
  return typeof val === "number" && val > 0 ? val : DEFAULT_MIN_BOOKING_HOURS;
}

/**
 * Включена ли публичная бронь беседок с сайта. По умолчанию — да; выключается
 * временно переключателем в настройках модуля (`Module.config.publicBookingEnabled`).
 * Админ-бронь (`createAdminBooking`) от этого флага не зависит.
 */
export async function isPublicBookingEnabled(): Promise<boolean> {
  const moduleRecord = await prisma.module.findUnique({ where: { slug: MODULE_SLUG } });
  const config = moduleRecord?.config as Record<string, unknown> | null;
  return config?.publicBookingEnabled !== false;
}

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
    deletedAt: null,
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
    where: { id, moduleSlug: MODULE_SLUG, deletedAt: null },
  });
}

export async function createBooking(userId: string | null, input: CreateBookingInput) {
  const { resourceId, date, startTime, endTime, guestCount, comment, items, guestName, guestPhone } = input;

  // Публичная бронь может быть временно закрыта (админ-бронь не затрагивается).
  if (!(await isPublicBookingEnabled())) {
    throw new BookingError(
      "BOOKING_DISABLED",
      "Онлайн-бронирование временно недоступно. Пожалуйста, свяжитесь с нами по телефону."
    );
  }

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

  // Онлайн-оплата: контакт для чека 54-ФЗ (email или телефон) должен быть
  // известен ДО создания брони — иначе гость уходит на оплату, которую
  // невозможно провести.
  const paymentContact = await resolvePaymentContact(userId, input.email, guestPhone);
  if (
    isYooKassaConfigured() &&
    receiptsEnabled() &&
    !paymentContact.email &&
    !paymentContact.phone
  ) {
    throw new BookingError(
      "PAYMENT_CONTACT_REQUIRED",
      "Для онлайн-оплаты укажите email или телефон"
    );
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

  // Enforce minimum booking duration
  const minHours = await getMinBookingHours();
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (durationHours < minHours) {
    throw new BookingError(
      "DURATION_BELOW_MIN",
      `Минимальное бронирование — ${minHours} ${pluralHours(minHours)}`
    );
  }

  // Validate items and build snapshot (no stock deduction yet — only on CONFIRMED).
  // Делается до транзакции: ходит в БД за товарами и к слоту отношения не имеет,
  // а держать блокировку слота на время этих запросов незачем.
  let itemSnapshots: BookingItemSnapshot[] = [];
  let itemsTotal = 0;
  if (items && items.length > 0) {
    const result = await validateAndSnapshotItems(items);
    itemSnapshots = result.snapshots;
    itemsTotal = result.itemsTotal;
  }

  const pricing = computeGazeboPricing(
    start,
    end,
    date,
    resource.metadata,
    resource.pricePerHour ? Number(resource.pricePerHour) : null,
    itemsTotal
  );

  // Конфликт-чек и запись — в одной транзакции под блокировкой слота, иначе
  // два одновременных запроса на популярный слот оба видят «свободно» (#429).
  const booking = await prisma.$transaction(async (tx) => {
    await lockSlot(tx, MODULE_SLUG, resourceId, bookingDate);

    const conflict = await tx.booking.findFirst({
      where: {
        moduleSlug: MODULE_SLUG,
        deletedAt: null,
        resourceId,
        status: { in: ACTIVE_BOOKING_STATUSES },
        date: bookingDate,
        OR: [
          { startTime: { lt: end }, endTime: { gt: start } },
        ],
      },
    });

    if (conflict) {
      throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
    }

    return tx.booking.create({
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
  });

  enqueueNotification({
    type: "booking.created",
    moduleSlug: MODULE_SLUG,
    entityId: booking.id,
    userId: userId ?? undefined,
    actor: "client",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  // === 100 % онлайн-предоплата (YooKassa) ===
  // Бронь ждёт денег в PENDING: CONFIRMED придёт из вебхука payment.succeeded,
  // неоплаченная бронь отменяется по TTL платежа (reconciliation-cron).
  // Без настроенной ЮKassa работает прежний поток: менеджер подтверждает вручную.
  let payment: { id: string; confirmationUrl: string | null } | null = null;
  if (isYooKassaConfigured() && Number(pricing.totalPrice) > 0) {
    try {
      const created = await createOnlinePayment({
        subjectType: "BOOKING",
        subjectId: booking.id,
        moduleSlug: MODULE_SLUG,
        amount: Number(pricing.totalPrice),
        description: `Беседка: ${resource.name}, ${date} ${startTime}–${endTime}`,
        userId,
        customerEmail: paymentContact.email,
        customerPhone: paymentContact.phone,
        receiptItems: [
          {
            description: `Аренда беседки: ${resource.name}, ${date}`,
            amount: Number(pricing.totalPrice),
            paymentMode: "full_prepayment",
          },
        ],
        returnUrl: `${appBaseUrl()}/payments/{paymentId}`,
        metadata: { bookingId: booking.id },
      });
      payment = { id: created.id, confirmationUrl: created.confirmationUrl };
    } catch (err) {
      if (err instanceof PaymentError && err.code === "PAYMENT_CREATE_FAILED") {
        // Провайдер недоступен — бронь остаётся в PENDING, подтвердит менеджер
        // (graceful degradation, план § 8). Ошибка уже залогирована в payments.
        payment = null;
      } else if (err instanceof PaymentError) {
        // Проблема с данными платежа — бронь без оплаты не имеет смысла.
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: "CANCELLED", cancelReason: "Оплата не оформлена" },
        });
        throw new BookingError(err.code, err.message);
      } else {
        throw err;
      }
    }
  }

  return { ...booking, payment };
}

/** Базовый URL приложения для return_url платёжной страницы. */
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * Контакт плательщика для чека 54-ФЗ: приоритет — явно переданный email,
 * затем профиль пользователя; у гостей — телефон из формы.
 */
async function resolvePaymentContact(
  userId: string | null,
  inputEmail?: string,
  guestPhone?: string
): Promise<{ email: string | null; phone: string | null }> {
  if (!userId) {
    return { email: inputEmail ?? null, phone: guestPhone ?? null };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true },
  });
  return { email: inputEmail ?? user?.email ?? null, phone: user?.phone ?? null };
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

  // Enforce minimum booking duration
  const minHoursAdmin = await getMinBookingHours();
  const durationHoursAdmin = (end.getTime() - start.getTime()) / 3_600_000;
  if (durationHoursAdmin < minHoursAdmin) {
    throw new BookingError(
      "DURATION_BELOW_MIN",
      `Минимальное бронирование — ${minHoursAdmin} ${pluralHours(minHoursAdmin)}`
    );
  }

  // Предварительный чек — вне транзакции и намеренно неавторитетный. Нужен, чтобы
  // при очевидном конфликте не ходить в Google Calendar и не плодить осиротевшее
  // событие. Настоящая проверка — под блокировкой слота внутри транзакции ниже.
  const conflict = await prisma.booking.findFirst({
    where: {
      moduleSlug: MODULE_SLUG,
      deletedAt: null,
      resourceId,
      status: { in: ACTIVE_BOOKING_STATUSES },
      date: bookingDate,
      OR: [{ startTime: { lt: end }, endTime: { gt: start } }],
    },
  });

  if (conflict) {
    throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
  }

  // Дедупликация гостя по E.164-телефону — тот же паттерн, что в ps-park
  // (ADR F4): без этого каждая телефонная бронь плодит новую карточку в CRM.
  const { id: clientUserId } = await upsertClientByPhone(clientPhone, {
    name: clientName,
    source: "gazebos_booking",
  });

  // Validate items snapshot (admin booking is auto-CONFIRMED, so deduct immediately)
  let itemSnapshots: BookingItemSnapshot[] = [];
  let itemsTotal = 0;
  if (items && items.length > 0) {
    const result = await validateAndSnapshotItems(items);
    itemSnapshots = result.snapshots;
    itemsTotal = result.itemsTotal;
  }

  const adminPricing = computeGazeboPricing(
    start,
    end,
    date,
    resource.metadata,
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
    // Авторитетный конфликт-чек: под блокировкой слота и в одной транзакции с
    // записью. Предварительный чек выше её не заменяет — между ним и этим местом
    // успевает вклиниться параллельный запрос (#429).
    await lockSlot(tx, MODULE_SLUG, resourceId, bookingDate);

    const raced = await tx.booking.findFirst({
      where: {
        moduleSlug: MODULE_SLUG,
        deletedAt: null,
        resourceId,
        status: { in: ACTIVE_BOOKING_STATUSES },
        date: bookingDate,
        OR: [{ startTime: { lt: end }, endTime: { gt: start } }],
      },
    });

    if (raced) {
      throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
    }

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
    userId: clientUserId,
    actor: "admin",
    data: { resourceName: resource.name, date, startTime, endTime },
  });

  return booking;
}

/**
 * Перенос/редактирование существующей брони админом: время, дата, ресурс,
 * контакт клиента, число гостей. Все поля опциональны (по умолчанию — текущие).
 *
 * При изменении времени/даты/ресурса:
 *  - проверяет часы работы, мин. длительность и конфликт (исключая саму бронь),
 *  - пересчитывает цену через `computeGazeboPricing` (учёт выходных),
 *  - ОБЯЗАТЕЛЬНО пишет запись в AuditLog (`booking.reschedule`) + историю правок
 *    в `metadata.edits` (before/after).
 */
export async function rescheduleBooking(
  bookingId: string,
  input: RescheduleBookingInput,
  managerId: string
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG, deletedAt: null },
  });
  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  const EDITABLE: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];
  if (!EDITABLE.includes(booking.status)) {
    throw new BookingError(
      "BOOKING_NOT_EDITABLE",
      "Редактировать можно только активные брони (не завершённые и не отменённые)"
    );
  }

  // Текущие значения как строки — дефолты для незаданных полей.
  const curDate = booking.date.toISOString().split("T")[0];
  const curStart = formatTime(booking.startTime);
  const curEnd = formatTime(booking.endTime);

  const effResourceId = input.resourceId ?? booking.resourceId;
  const effDate = input.date ?? curDate;
  const effStart = input.startTime ?? curStart;
  const effEnd = input.endTime ?? curEnd;

  const resource = await prisma.resource.findFirst({
    where: { id: effResourceId, moduleSlug: MODULE_SLUG },
  });
  if (!resource) {
    throw new BookingError("RESOURCE_NOT_FOUND", "Беседка не найдена");
  }

  // Часы работы 08:00–23:00 + начало раньше конца.
  const openHHMM = `${String(OPEN_HOUR).padStart(2, "0")}:00`;
  const closeHHMM = `${String(CLOSE_HOUR).padStart(2, "0")}:00`;
  if (effStart < openHHMM || effEnd > closeHHMM) {
    throw new BookingError(
      "OUTSIDE_WORKING_HOURS",
      `Время должно быть в пределах ${openHHMM}–${closeHHMM}`
    );
  }
  if (effStart >= effEnd) {
    throw new BookingError(
      "INVALID_TIME_RANGE",
      "Время начала должно быть раньше окончания"
    );
  }

  const start = parseDatetime(effDate, effStart);
  const end = parseDatetime(effDate, effEnd);

  const minHours = await getMinBookingHours();
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (durationHours < minHours) {
    throw new BookingError(
      "DURATION_BELOW_MIN",
      `Минимальное бронирование — ${minHours} ${pluralHours(minHours)}`
    );
  }

  const meta = (booking.metadata as Record<string, unknown> | null) ?? {};

  // Вместимость при изменении числа гостей / ресурса.
  const effGuestCount =
    input.guestCount ??
    (typeof meta.guestCount === "number" ? meta.guestCount : undefined);
  if (effGuestCount && resource.capacity && effGuestCount > resource.capacity) {
    throw new BookingError(
      "CAPACITY_EXCEEDED",
      `Максимальная вместимость: ${resource.capacity} человек`
    );
  }

  const timeOrResourceChanged =
    effResourceId !== booking.resourceId ||
    effDate !== curDate ||
    effStart !== curStart ||
    effEnd !== curEnd;

  // Пересчёт цены (учёт выходных) при изменении времени/даты/ресурса.
  const itemsTotal = Number(meta.itemsTotal ?? 0) || 0;
  const pricing = timeOrResourceChanged
    ? computeGazeboPricing(
        start,
        end,
        effDate,
        resource.metadata,
        resource.pricePerHour ? Number(resource.pricePerHour) : null,
        itemsTotal
      )
    : null;

  const before = {
    date: curDate,
    startTime: curStart,
    endTime: curEnd,
    resourceId: booking.resourceId,
  };
  const after = {
    date: effDate,
    startTime: effStart,
    endTime: effEnd,
    resourceId: effResourceId,
  };

  const prevEdits = Array.isArray(meta.edits) ? meta.edits : [];
  const newMeta: Record<string, unknown> = {
    ...meta,
    ...(input.guestCount !== undefined && { guestCount: input.guestCount }),
    ...(pricing && {
      basePrice: pricing.basePrice,
      pricePerHour: pricing.pricePerHour,
      totalPrice: pricing.totalPrice,
    }),
    edits: [
      ...prevEdits,
      { at: new Date().toISOString(), by: managerId, before, after },
    ],
  };

  // Конфликт с ДРУГИМИ бронями того же ресурса (саму себя исключаем) — под
  // блокировкой слота и в одной транзакции с записью: перенос на популярное время
  // гоняется с созданием брони ровно так же, как создание с созданием (#429).
  // Блокируется целевой слот; исходный не нужен — освобождение места конфликта
  // ни у кого не вызывает.
  const updated = await prisma.$transaction(async (tx) => {
    if (timeOrResourceChanged) {
      await lockSlot(tx, MODULE_SLUG, effResourceId, new Date(effDate));

      const conflict = await tx.booking.findFirst({
        where: {
          moduleSlug: MODULE_SLUG,
          deletedAt: null,
          resourceId: effResourceId,
          id: { not: bookingId },
          status: { in: ACTIVE_BOOKING_STATUSES },
          date: new Date(effDate),
          OR: [{ startTime: { lt: end }, endTime: { gt: start } }],
        },
      });
      if (conflict) {
        throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
      }
    }

    return tx.booking.update({
      where: { id: bookingId },
      data: {
        resourceId: effResourceId,
        date: new Date(effDate),
        startTime: start,
        endTime: end,
        ...(input.clientName !== undefined && { clientName: input.clientName }),
        ...(input.clientPhone !== undefined && { clientPhone: input.clientPhone }),
        metadata: JSON.parse(JSON.stringify(newMeta)),
      },
    });
  });

  // ОБЯЗАТЕЛЬНАЯ запись о правке (особенно при смене времени).
  await logAudit(managerId, "booking.reschedule", "Booking", bookingId, {
    moduleSlug: MODULE_SLUG,
    before,
    after,
    ...(pricing && { newTotalPrice: pricing.totalPrice }),
    ...(input.clientName !== undefined && { clientNameChanged: true }),
    ...(input.clientPhone !== undefined && { clientPhoneChanged: true }),
  });

  return updated;
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number,
  discountInput?: CheckoutDiscountInput,
  actorRole: import("@/modules/booking/state-machine").ActorRole = "MANAGER"
) {
  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG, deletedAt: null },
  });

  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  try {
    assertValidTransition({
      currentStatus: booking.status,
      targetStatus: status,
      actorRole,
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
    // === CHECKOUT with optional discount + payment gate ===
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

    // totalBill: post-discount snapshot of metadata.totalPrice.
    // gazebos pricing is fixed-at-booking, not pay-as-you-go like PS Park.
    const originalTotal = Number(existingMeta.totalPrice ?? 0);
    const completedTotalBill = discountData
      ? Number(discountData.finalAmount)
      : originalTotal;

    // Онлайн-предоплата (YooKassa) уже проведена в леджер вебхуком —
    // в гейте она засчитывается, в кассовый FT при завершении не попадает.
    const onlinePaid = Number(existingMeta.onlinePaidAmount ?? 0);

    // PAYMENT_REQUIRED gate — see ADR 2026-05-04-gazebos-payment-required-on-complete.
    // CRON not used in gazebos today, but the actorRole branch keeps the door
    // closed to a future cron auto-completion regression.
    if (actorRole !== "CRON" && completedTotalBill > 0) {
      const paidByOperator = (cashAmount ?? 0) + (cardAmount ?? 0);
      if (paidByOperator + onlinePaid < completedTotalBill) {
        const shortfall =
          Math.round((completedTotalBill - onlinePaid - paidByOperator) * 100) / 100;
        throw new BookingError(
          "PAYMENT_REQUIRED",
          `Необходимо принять оплату: не хватает ${shortfall.toLocaleString("ru-RU")} ₽`,
          { shortfall, totalBill: completedTotalBill, paid: paidByOperator, onlinePaid }
        );
      }
    }

    const resolvedCash = cashAmount ?? Math.max(0, completedTotalBill - onlinePaid);
    const resolvedCard = cardAmount ?? 0;

    const managerUser = managerId
      ? await prisma.user.findUnique({
          where: { id: managerId },
          select: { name: true, email: true },
        })
      : null;
    const managerName = managerUser?.name ?? managerUser?.email ?? "Менеджер";

    const updatedMetadata = {
      ...existingMeta,
      ...(discountData && {
        discount: discountData,
        totalPrice: discountData.finalAmount,
      }),
    };

    updated = await prisma.$transaction(async (tx) => {
      // Idempotent COMPLETE — same race-guard pattern as PS Park (F1).
      const res = await tx.booking.updateMany({
        where: { id, status: { in: ["CONFIRMED", "CHECKED_IN"] } },
        data: {
          status,
          ...(managerId && { managerId }),
          ...(googleEventId !== booking.googleEventId && { googleEventId }),
          metadata: updatedMetadata as unknown as import("@prisma/client").Prisma.InputJsonValue,
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
        },
      });
      if (res.count === 0) {
        throw new BookingError("ALREADY_COMPLETED", "Бронирование уже завершено");
      }
      const b = await tx.booking.findUniqueOrThrow({ where: { id } });

      // Financial ledger — immutable revenue record. Онлайн-часть уже проведена
      // отдельной ONLINE_PAYMENT-строкой из вебхука; здесь фиксируется только
      // принятое на месте (иначе выручка задвоится). Полностью предоплаченная
      // бронь кассовой записи не создаёт; для броней без онлайн-оплаты
      // сохраняется прежнее поведение (запись пишется даже при нулевом счёте).
      const onSiteTotal = resolvedCash + resolvedCard;
      if (onSiteTotal > 0 || onlinePaid === 0) {
        await tx.financialTransaction.create({
          data: {
            moduleSlug: MODULE_SLUG,
            type: "SESSION_PAYMENT",
            bookingId: id,
            totalAmount: onSiteTotal,
            cashAmount: resolvedCash,
            cardAmount: resolvedCard,
            performedById,
            performedByName: managerName,
            description: `Беседка: ${resource?.name ?? "—"} · ${booking.clientName ?? "—"}`,
            metadata: {
              resourceName: resource?.name ?? "—",
              clientName: booking.clientName ?? "—",
              date: booking.date.toISOString().split("T")[0],
              startTime: booking.startTime.toISOString(),
              endTime: booking.endTime.toISOString(),
              originalTotal,
              ...(onlinePaid > 0 && { onlinePaidAmount: onlinePaid }),
              ...(discountData && {
                discountPercent: discountData.percent,
                discountAmount: Number(discountData.amount),
                finalAmount: Number(discountData.finalAmount),
              }),
            } as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });
      }

      const completionAction =
        actorRole === "CRON" ? "booking.auto_complete" : "booking.complete";
      await tx.auditLog.create({
        data: {
          userId: performedById,
          action: completionAction,
          entity: "Booking",
          entityId: id,
          metadata: {
            bookingId: id,
            moduleSlug: MODULE_SLUG,
            resourceName: resource?.name ?? "—",
            clientName: booking.clientName ?? "—",
            totalAmount: completedTotalBill,
            cashAmount: resolvedCash,
            cardAmount: resolvedCard,
            ...(actorRole === "CRON" && { actor: "CRON" }),
          },
        },
      });

      if (discountData) {
        await tx.auditLog.create({
          data: {
            userId: performedById,
            action: "booking.discount_applied",
            entity: "Booking",
            entityId: id,
            metadata: {
              managerId: performedById,
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
      },
    });
  }

  const dateStr = booking.date.toISOString().split("T")[0];
  const startStr = formatTime(booking.startTime);
  const endStr = formatTime(booking.endTime);

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

  // Отмена парком/менеджером → полный автовозврат онлайн-предоплаты
  // (политика владельца: отмена парком — возврат всегда). Ошибка возврата
  // не блокирует отмену — логируется внутри для ручного разбора.
  if (status === "CANCELLED") {
    await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: id,
      trigger: "park_cancellation",
    });
  }

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
    where: { id, moduleSlug: MODULE_SLUG, deletedAt: null },
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

  // Предоплаченная онлайн бронь живёт по своей политике (решение владельца):
  // >24 ч до начала — бесплатная отмена с полным автовозвратом; ≤24 ч —
  // «штраф» = вся предоплата (возврата нет). Штраф считается от онлайн-суммы.
  const onlinePaid = Number(metadata?.onlinePaidAmount ?? 0);
  const isPrepaid = onlinePaid > 0;
  const basePrice = isPrepaid ? onlinePaid : Number(metadata?.basePrice ?? 0);
  const effectivePolicy = isPrepaid ? PREPAID_CANCELLATION_POLICY : policy;

  const cancellationResult = computeCancellationPenalty(
    booking.startTime,
    new Date(),
    basePrice,
    effectivePolicy,
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
  const startStr = formatTime(booking.startTime);
  const endStr = formatTime(booking.endTime);

  enqueueNotification({
    type: "booking.cancelled",
    moduleSlug: MODULE_SLUG,
    entityId: id,
    userId,
    actor: "client",
    data: { resourceName: resource?.name || "", date: dateStr, startTime: startStr, endTime: endStr },
  });

  // Автовозврат предоплаты по политике: >24 ч до начала — полный возврат,
  // ≤24 ч — возврата нет (внутри сервиса тот же порог). Ошибка возврата
  // не блокирует отмену.
  if (isPrepaid) {
    await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: id,
      trigger: "client_cancellation",
      eventStartTime: booking.startTime,
    });
  }

  return { penaltyRequired: false, booking: updated };
}

// === CHECK-IN ===

export async function checkInBooking(bookingId: string, managerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG, deletedAt: null },
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
    where: { id: bookingId, moduleSlug: MODULE_SLUG, deletedAt: null },
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
): Promise<import("./types").AvailabilityResponse> {
  const [minBookingHours, resources] = await Promise.all([
    getMinBookingHours(),
    resourceId
      ? prisma.resource.findMany({
          where: { id: resourceId, moduleSlug: MODULE_SLUG, isActive: true },
        })
      : prisma.resource.findMany({
          where: { moduleSlug: MODULE_SLUG, isActive: true },
          orderBy: { name: "asc" },
        }),
  ]);

  const bookingDate = new Date(date);

  const existingBookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      deletedAt: null,
      date: bookingDate,
      status: { in: ACTIVE_BOOKING_STATUSES },
      ...(resourceId && { resourceId }),
    },
  });

  const resourcesData: DayAvailability[] = resources.map((resource) => {
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

    const pricing = getResourcePricing(
      resource.metadata,
      resource.pricePerHour ? Number(resource.pricePerHour) : null,
      date
    );

    return { date, resource, slots, pricing };
  });

  return { resources: resourcesData, minBookingHours };
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
      deletedAt: null,
      date: bookingDate,
      status: { in: ACTIVE_BOOKING_STATUSES },
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
      cashAmount: true,
      cardAmount: true,
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
      cashAmount: b.cashAmount?.toString() ?? null,
      cardAmount: b.cardAmount?.toString() ?? null,
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
      deletedAt: null,
      date: { gte: dateFrom },
    },
  });

  // Фактически поступившие деньги за период — сумма финансовых проводок модуля
  // (онлайн-оплаты ЮKassa + касса; возвраты хранятся отрицательными и вычитаются
  // сами). Не зависит от статуса брони — поэтому оплаченные, но ещё не
  // «завершённые» брони тоже видны в кассе.
  const receivedAgg = await prisma.financialTransaction.aggregate({
    where: { moduleSlug: MODULE_SLUG, createdAt: { gte: dateFrom } },
    _sum: { totalAmount: true },
  });
  const totalReceived = Number(receivedAgg._sum.totalAmount ?? 0);

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
    // Московский час, а не серверный (getHours на UTC-сервере давал бы сдвиг).
    const hour = getMoscowHour(b.startTime);
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
    totalReceived,
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

  const where: Record<string, unknown> = { moduleSlug: MODULE_SLUG, deletedAt: null };
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
  // Трактуем ввод как Moscow-время → UTC-инстант. Без явного смещения
  // `new Date("...T16:00:00")` парсился бы в TZ сервера (UTC), из-за чего
  // бронь «на 16:00» сохранялась со сдвигом +3ч.
  return parseMoscowDateTime(date, time);
}

export class BookingError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "BookingError";
    if (metadata) this.metadata = metadata;
  }
}
