import { prisma } from "@/lib/db";
import type { OrderStatus } from "@prisma/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import { createOnlinePayment } from "@/modules/payments/service";
import { PaymentError } from "@/modules/payments/types";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import type {
  CreateMenuItemInput,
  UpdateMenuItemInput,
  CreateOrderInput,
  CheckoutInput,
  CheckoutResult,
  CafeStats,
  CafeStatsQuery,
  OrderFilter,
  CafeMenuItem,
} from "./types";

const MODULE_SLUG = "cafe";

// === MENU ===

export async function getMenu(category?: string): Promise<CafeMenuItem[]> {
  return prisma.menuItem.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      isAvailable: true,
      deletedAt: null,
      ...(category && { category }),
    },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getMenuCategories(): Promise<string[]> {
  const items = await prisma.menuItem.findMany({
    where: { moduleSlug: MODULE_SLUG, isAvailable: true, deletedAt: null },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return items.map((i) => i.category);
}

/** Полное меню для админ-каталога (включая скрытые, без soft-deleted). */
export async function getMenuAdmin() {
  return prisma.menuItem.findMany({
    where: { moduleSlug: MODULE_SLUG, deletedAt: null },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getMenuItem(id: string) {
  return prisma.menuItem.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });
}

export async function createMenuItem(input: CreateMenuItemInput) {
  return prisma.menuItem.create({
    data: {
      moduleSlug: MODULE_SLUG,
      category: input.category,
      name: input.name,
      description: input.description,
      price: input.price,
      imageUrl: input.imageUrl,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateMenuItem(id: string, input: UpdateMenuItemInput) {
  return prisma.menuItem.update({
    where: { id },
    data: {
      ...(input.category !== undefined && { category: input.category }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.price !== undefined && { price: input.price }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.isAvailable !== undefined && { isAvailable: input.isAvailable }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
  });
}

// === ORDERS ===

export async function createOrder(
  userId: string | null,
  input: CreateOrderInput,
  opts?: { suppressPlacedNotification?: boolean }
) {
  const { items, deliveryTo, comment, bookingId } = input;

  // F5 ADR: validate Booking existence before menu lookup (cheap rejection).
  // No status / deletedAt filter — PO Решения №4 (статус) и №5 (soft-delete).
  if (bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new OrderError("BOOKING_NOT_FOUND", "Бронирование не найдено");
    }
  }

  // Fetch menu items to calculate prices
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, moduleSlug: MODULE_SLUG, isAvailable: true },
  });

  if (menuItems.length !== menuItemIds.length) {
    const found = new Set(menuItems.map((m) => m.id));
    const missing = menuItemIds.filter((id) => !found.has(id));
    throw new OrderError("ITEM_NOT_FOUND", `Позиции не найдены: ${missing.join(", ")}`);
  }

  const menuMap = new Map(menuItems.map((m) => [m.id, m]));

  let totalAmount = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuMap.get(item.menuItemId)!;
    const price = Number(menuItem.price);
    totalAmount += price * item.quantity;
    return {
      menuItemId: item.menuItemId,
      name: menuItem.name, // снапшот: статистика переживает переименования меню
      quantity: item.quantity,
      price,
    };
  });

  const order = await prisma.order.create({
    data: {
      moduleSlug: MODULE_SLUG,
      userId,
      totalAmount,
      deliveryTo,
      comment,
      ...(bookingId && { bookingId }),
      status: "NEW",
      items: {
        create: orderItems,
      },
    },
    include: { items: true },
  });

  // Чекаут с онлайн-оплатой уведомляет по факту оплаты (order.paid), а не
  // создания — иначе админам сыплются никогда не оплаченные корзины.
  if (!opts?.suppressPlacedNotification) {
    notifyOrderPlaced(order.id, userId, totalAmount, deliveryTo, items.length);
  }

  return order;
}

function notifyOrderPlaced(
  orderId: string,
  userId: string | null,
  totalAmount: number,
  deliveryTo: string | undefined,
  itemCount: number
): void {
  enqueueNotification({
    type: "order.placed",
    moduleSlug: MODULE_SLUG,
    entityId: orderId,
    userId: userId ?? undefined,
    actor: "client",
    data: {
      orderNumber: orderId.slice(-6).toUpperCase(),
      totalAmount: totalAmount.toString(),
      deliveryTo,
      itemCount,
    },
  });
}

// === CHECKOUT (публичный QR-сценарий: корзина → онлайн-оплата ЮKassa) ===

/**
 * Создаёт заказ и платёж ЮKassa (СБП/карта выбираются на hosted-странице).
 * Зеркало гостевого потока gazebos: заказ ждёт денег в NEW, DELIVERED/отмена
 * придут из вебхука; без настроенной ЮKassa — деградация в «оплата на кассе».
 */
export async function createCheckout(
  userId: string | null,
  input: CheckoutInput
): Promise<CheckoutResult> {
  const { customerEmail, customerPhone, ...orderInput } = input;

  const attemptPayment = isYooKassaConfigured();
  const order = await createOrder(userId, orderInput, {
    suppressPlacedNotification: attemptPayment,
  });
  const orderNumber = order.id.slice(-6).toUpperCase();

  let payment: CheckoutResult["payment"] = null;
  if (attemptPayment && Number(order.totalAmount) > 0) {
    const contact = await resolvePaymentContact(userId, customerEmail, customerPhone);
    try {
      const created = await createOnlinePayment({
        subjectType: "ORDER",
        subjectId: order.id,
        moduleSlug: MODULE_SLUG,
        amount: Number(order.totalAmount),
        description: `Кафе: заказ ${orderNumber}`,
        userId,
        customerEmail: contact.email,
        customerPhone: contact.phone,
        receiptItems: order.items.map((item) => ({
          description: item.name ?? "Позиция",
          amount: Number(item.price),
          quantity: item.quantity,
          paymentMode: "full_payment" as const,
          paymentSubject: "commodity" as const,
        })),
        returnUrl: `${appBaseUrl()}/payments/{paymentId}`,
        metadata: { orderId: order.id },
      });
      payment = { id: created.id, confirmationUrl: created.confirmationUrl };
    } catch (err) {
      if (err instanceof PaymentError && err.code === "PAYMENT_CREATE_FAILED") {
        // Провайдер недоступен — заказ остаётся, клиент оплатит на кассе
        // (graceful degradation). Ошибка уже залогирована в payments.
        payment = null;
        notifyOrderPlaced(
          order.id,
          userId,
          Number(order.totalAmount),
          order.deliveryTo ?? undefined,
          order.items.length
        );
      } else if (err instanceof PaymentError) {
        // Проблема с данными платежа (напр. нет контакта для чека) —
        // заказ без оплаты не имеет смысла.
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED" },
        });
        throw new OrderError(err.code, err.message);
      } else {
        throw err;
      }
    }
  }

  return { ...order, payment };
}

/** Базовый URL приложения для return_url платёжной страницы. */
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * Контакт плательщика для чека 54-ФЗ: приоритет — явно указанный на чекауте,
 * затем профиль залогиненного пользователя; у гостя — только форма.
 */
async function resolvePaymentContact(
  userId: string | null,
  inputEmail?: string,
  inputPhone?: string
): Promise<{ email: string | null; phone: string | null }> {
  if (inputEmail || inputPhone) {
    return { email: inputEmail ?? null, phone: inputPhone ?? null };
  }
  if (!userId) return { email: null, phone: null };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true },
  });
  return { email: user?.email ?? null, phone: user?.phone ?? null };
}

export async function listOrders(filter?: OrderFilter) {
  const where = {
    moduleSlug: MODULE_SLUG,
    ...(filter?.status && { status: filter.status }),
    ...(filter?.userId && { userId: filter.userId }),
    ...(filter?.paid !== undefined && {
      paidAt: filter.paid ? { not: null } : null,
    }),
    ...(filter?.dateFrom || filter?.dateTo
      ? {
          createdAt: {
            ...(filter?.dateFrom && { gte: new Date(filter.dateFrom) }),
            ...(filter?.dateTo && { lte: new Date(`${filter.dateTo}T23:59:59`) }),
          },
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}

export async function getOrder(id: string) {
  return prisma.order.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
    include: { items: true, user: { select: { name: true, email: true } } },
  });
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const order = await prisma.order.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!order) throw new OrderError("ORDER_NOT_FOUND", "Заказ не найден");

  const validTransitions: Record<OrderStatus, OrderStatus[]> = {
    NEW: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["DELIVERED"],
    DELIVERED: [],
    CANCELLED: [],
  };

  if (!validTransitions[order.status].includes(status)) {
    throw new OrderError(
      "INVALID_STATUS_TRANSITION",
      `Нельзя перевести из ${order.status} в ${status}`
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status },
    include: { items: true },
  });

  const eventMap: Record<string, string> = {
    PREPARING: "order.preparing",
    READY: "order.ready",
    DELIVERED: "order.delivered",
    CANCELLED: "order.cancelled",
  };
  if (eventMap[status]) {
    enqueueNotification({
      type: eventMap[status],
      moduleSlug: MODULE_SLUG,
      entityId: id,
      userId: order.userId ?? undefined,
      actor: "admin",
      data: {
        orderNumber: id.slice(-6).toUpperCase(),
        totalAmount: order.totalAmount.toString(),
        deliveryTo: order.deliveryTo,
      },
    });
  }

  return updated;
}

export async function cancelOrder(id: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id, moduleSlug: MODULE_SLUG },
  });

  if (!order) throw new OrderError("ORDER_NOT_FOUND", "Заказ не найден");
  if (order.userId !== userId) throw new OrderError("FORBIDDEN", "Нельзя отменить чужой заказ");
  if (order.status !== "NEW") {
    throw new OrderError("INVALID_STATUS_TRANSITION", "Можно отменить только новый заказ");
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: { items: true },
  });

  enqueueNotification({
    type: "order.cancelled",
    moduleSlug: MODULE_SLUG,
    entityId: id,
    userId,
    actor: "client",
    data: {
      orderNumber: id.slice(-6).toUpperCase(),
      totalAmount: order.totalAmount.toString(),
    },
  });

  return updated;
}

// === STATS (статистика продаж для админки) ===

/**
 * «Учитываемый заказ»: не удалён, не отменён, и либо оплачен онлайн (paidAt),
 * либо доведён до выдачи (DELIVERED — менеджерские/кассовые заказы без
 * онлайн-оплаты). Дата продажи — paidAt ?? createdAt.
 */
export async function getCafeStats(query: CafeStatsQuery): Promise<CafeStats> {
  const from = new Date(query.dateFrom);
  const to = new Date(`${query.dateTo}T23:59:59.999`);

  const orders = await prisma.order.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      deletedAt: null,
      status: { not: "CANCELLED" },
      OR: [
        { paidAt: { gte: from, lte: to } },
        { paidAt: null, status: "DELIVERED", createdAt: { gte: from, lte: to } },
      ],
    },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  let revenue = 0;
  let onlineRevenue = 0;
  let onlineCount = 0;
  const byDayMap = new Map<string, { orders: number; revenue: number }>();
  const itemAgg = new Map<
    string,
    { menuItemId: string; name: string; quantity: number; revenue: number }
  >();

  for (const order of orders) {
    const amount = Number(order.totalAmount);
    revenue += amount;
    if (order.paidAt) {
      onlineRevenue += amount;
      onlineCount += 1;
    }

    const saleDate = (order.paidAt ?? order.createdAt).toISOString().split("T")[0];
    const day = byDayMap.get(saleDate) ?? { orders: 0, revenue: 0 };
    day.orders += 1;
    day.revenue += amount;
    byDayMap.set(saleDate, day);

    for (const item of order.items) {
      const agg = itemAgg.get(item.menuItemId) ?? {
        menuItemId: item.menuItemId,
        name: item.name ?? "",
        quantity: 0,
        revenue: 0,
      };
      agg.quantity += item.quantity;
      agg.revenue += Number(item.price) * item.quantity;
      if (!agg.name && item.name) agg.name = item.name;
      itemAgg.set(item.menuItemId, agg);
    }
  }

  // Категории и имена для legacy-строк без снапшота — из текущего меню.
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: [...itemAgg.keys()] } },
    select: { id: true, name: true, category: true },
  });
  const menuMap = new Map(menuItems.map((m) => [m.id, m]));

  const byCategoryMap = new Map<string, { quantity: number; revenue: number }>();
  const topItems = [...itemAgg.values()]
    .map((agg) => {
      const menu = menuMap.get(agg.menuItemId);
      const name = agg.name || menu?.name || "—";
      const category = menu?.category ?? "Прочее";
      const cat = byCategoryMap.get(category) ?? { quantity: 0, revenue: 0 };
      cat.quantity += agg.quantity;
      cat.revenue += agg.revenue;
      byCategoryMap.set(category, cat);
      return { ...agg, name, category };
    })
    .sort((a, b) => b.quantity - a.quantity);

  // Разбивка по способу оплаты (СБП/карта) — из успешных платежей.
  const byPaymentMethodMap = new Map<string, number>();
  if (onlineCount > 0) {
    const payments = await prisma.payment.findMany({
      where: {
        subjectType: "ORDER",
        subjectId: { in: orders.filter((o) => o.paidAt).map((o) => o.id) },
        status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      select: { paymentMethodType: true },
    });
    for (const p of payments) {
      const method = p.paymentMethodType ?? "unknown";
      byPaymentMethodMap.set(method, (byPaymentMethodMap.get(method) ?? 0) + 1);
    }
  }

  return {
    ordersCount: orders.length,
    revenue,
    avgCheck: orders.length > 0 ? revenue / orders.length : 0,
    onlineCount,
    onlineRevenue,
    byDay: [...byDayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    topItems,
    byCategory: [...byCategoryMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.revenue - a.revenue),
    byPaymentMethod: [...byPaymentMethodMap.entries()]
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// === HELPERS ===

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OrderError";
  }
}
