import { prisma } from "@/lib/db";
import type { OrderStatus } from "@prisma/client";
import type {
  CreateMenuItemInput,
  UpdateMenuItemInput,
  CreateOrderInput,
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
      ...(category && { category }),
    },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getMenuCategories(): Promise<string[]> {
  const items = await prisma.menuItem.findMany({
    where: { moduleSlug: MODULE_SLUG, isAvailable: true },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return items.map((i) => i.category);
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

export async function createOrder(userId: string, input: CreateOrderInput) {
  const { items, deliveryTo } = input;

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

  const priceMap = new Map(menuItems.map((m) => [m.id, Number(m.price)]));

  let totalAmount = 0;
  const orderItems = items.map((item) => {
    const price = priceMap.get(item.menuItemId)!;
    totalAmount += price * item.quantity;
    return {
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      price,
    };
  });

  return prisma.order.create({
    data: {
      moduleSlug: MODULE_SLUG,
      userId,
      totalAmount,
      deliveryTo,
      status: "NEW",
      items: {
        create: orderItems,
      },
    },
    include: { items: true },
  });
}

export async function listOrders(filter?: OrderFilter) {
  const where = {
    moduleSlug: MODULE_SLUG,
    ...(filter?.status && { status: filter.status }),
    ...(filter?.userId && { userId: filter.userId }),
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

  return prisma.order.update({
    where: { id },
    data: { status },
    include: { items: true },
  });
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

  return prisma.order.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: { items: true },
  });
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
