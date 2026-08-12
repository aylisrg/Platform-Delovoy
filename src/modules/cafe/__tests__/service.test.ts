import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/modules/payments/service", () => ({
  createOnlinePayment: vi.fn(),
}));

vi.mock("@/lib/yookassa/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/yookassa/client")>();
  return { ...actual, isYooKassaConfigured: vi.fn(() => false) };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    menuItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
    },
  },
}));

import {
  createOrder,
  createCheckout,
  getCafeStats,
  getMenu,
  getMenuAdmin,
  getMenuCategories,
  updateOrderStatus,
  cancelOrder,
  OrderError,
} from "@/modules/cafe/service";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/modules/notifications/queue";
import { createOnlinePayment } from "@/modules/payments/service";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { PaymentError } from "@/modules/payments/types";

const mockMenuItem = (overrides = {}) => ({
  id: "item-1",
  name: "Пицца",
  category: "Основное",
  price: 500,
  isAvailable: true,
  moduleSlug: "cafe",
  sortOrder: 0,
  ...overrides,
});

const mockOrder = (overrides = {}) => ({
  id: "order-1",
  userId: "user-1",
  status: "NEW",
  totalAmount: 1000,
  moduleSlug: "cafe",
  items: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isYooKassaConfigured).mockReturnValue(false);
});

// ===== MENU ORDERING =====

/**
 * Prisma отдаёт строки в алфавитном порядке категорий — «Десерты» раньше
 * «Кофе». Сервис обязан переупорядочить витрину по блокам sortOrder, иначе
 * кофейный раздел перестанет быть первым, как только заведут категорию на
 * букву раньше «К».
 */
const boardRows = [
  mockMenuItem({ id: "d1", category: "Десерты", name: "Чизкейк", sortOrder: 300 }),
  mockMenuItem({ id: "k1", category: "Кофе", name: "Эспрессо", sortOrder: 0 }),
  mockMenuItem({ id: "k2", category: "Кофе", name: "Капучино", sortOrder: 1 }),
  mockMenuItem({ id: "k3", category: "Кофе", name: "Латте", sortOrder: 2 }),
  mockMenuItem({ id: "p1", category: "Пицца", name: "Пепперони", sortOrder: 100 }),
];

describe("getMenu ordering", () => {
  it("puts the coffee block first regardless of category alphabet", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue(boardRows as never);

    const items = await getMenu();

    expect(items.map((i) => i.category)).toEqual([
      "Кофе",
      "Кофе",
      "Кофе",
      "Пицца",
      "Десерты",
    ]);
  });

  it("keeps items inside a category in sortOrder, not alphabetical", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue(boardRows as never);

    const items = await getMenu();

    expect(items.slice(0, 3).map((i) => i.name)).toEqual([
      "Эспрессо",
      "Капучино",
      "Латте",
    ]);
  });

  it("keeps categories grouped when their ranks tie", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "a1", category: "Альфа", name: "A1", sortOrder: 0 }),
      mockMenuItem({ id: "b1", category: "Бета", name: "B1", sortOrder: 0 }),
      mockMenuItem({ id: "a2", category: "Альфа", name: "A2", sortOrder: 1 }),
      mockMenuItem({ id: "b2", category: "Бета", name: "B2", sortOrder: 1 }),
    ] as never);

    const items = await getMenu();

    expect(items.map((i) => i.category)).toEqual(["Альфа", "Альфа", "Бета", "Бета"]);
  });

  it("admin catalog uses the same order as the public menu", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue(boardRows as never);

    const items = await getMenuAdmin();

    expect(items.map((i) => i.id)).toEqual(["k1", "k2", "k3", "p1", "d1"]);
  });
});

describe("getMenuCategories", () => {
  it("returns distinct categories ranked by their lowest sortOrder", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue(
      boardRows.map((r) => ({ category: r.category, sortOrder: r.sortOrder })) as never,
    );

    const categories = await getMenuCategories();

    expect(categories).toEqual(["Кофе", "Пицца", "Десерты"]);
  });

  it("returns an empty list for an empty menu", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([] as never);

    expect(await getMenuCategories()).toEqual([]);
  });
});

// ===== createOrder =====

describe("createOrder", () => {
  it("creates order with correct total when all items are available", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
      mockMenuItem({ id: "item-2", price: 300 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(
      mockOrder({ totalAmount: 1300, items: [] }) as never
    );

    const result = await createOrder("user-1", {
      items: [
        { menuItemId: "item-1", quantity: 2 },
        { menuItemId: "item-2", quantity: 1 },
      ],
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          totalAmount: 1300, // 500*2 + 300*1
          status: "NEW",
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("throws ITEM_NOT_FOUND when a menu item does not exist", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([]); // returns nothing

    await expect(
      createOrder("user-1", { items: [{ menuItemId: "missing-id", quantity: 1 }] })
    ).rejects.toThrow(OrderError);

    await expect(
      createOrder("user-1", { items: [{ menuItemId: "missing-id", quantity: 1 }] })
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });

  it("throws ITEM_NOT_FOUND when item is unavailable (not returned by DB)", async () => {
    // DB filters by isAvailable:true, so unavailable items are not returned
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([]); // unavailable item filtered out

    await expect(
      createOrder("user-1", { items: [{ menuItemId: "item-unavailable", quantity: 1 }] })
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });

  it("calculates total correctly for multiple items with different quantities", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 100 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(mockOrder({ totalAmount: 300 }) as never);

    await createOrder("user-1", { items: [{ menuItemId: "item-1", quantity: 3 }] });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: 300 }),
      })
    );
  });

  // ===== F5 ADR — Order.bookingId link =====

  it("creates order without bookingId — does not query Booking", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(mockOrder() as never);

    await createOrder("user-1", { items: [{ menuItemId: "item-1", quantity: 1 }] });

    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ bookingId: expect.anything() }),
      })
    );
  });

  it("creates order with valid bookingId — verifies booking existence and links", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ id: "booking-1" } as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(
      mockOrder({ bookingId: "booking-1" }) as never
    );

    await createOrder("user-1", {
      items: [{ menuItemId: "item-1", quantity: 1 }],
      bookingId: "booking-1",
    });

    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      select: { id: true },
    });
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bookingId: "booking-1" }),
      })
    );
  });

  it("throws BOOKING_NOT_FOUND when bookingId references nonexistent Booking", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(null);

    await expect(
      createOrder("user-1", {
        items: [{ menuItemId: "item-1", quantity: 1 }],
        bookingId: "missing-booking",
      })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });

    // Cheap rejection: menu lookup and order.create must NOT be called.
    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("гостевой заказ: userId null, уведомление без userId", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(mockOrder({ userId: null }) as never);

    await createOrder(null, { items: [{ menuItemId: "item-1", quantity: 1 }] });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) })
    );
    expect(vi.mocked(enqueueNotification).mock.calls[0][0].userId).toBeUndefined();
  });

  it("пишет снапшот названия в позиции и сохраняет комментарий", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", name: "Круассан", price: 180 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(mockOrder() as never);

    await createOrder("user-1", {
      items: [{ menuItemId: "item-1", quantity: 2 }],
      comment: "без сахара",
    });

    const data = vi.mocked(prisma.order.create).mock.calls[0][0].data;
    expect(data.comment).toBe("без сахара");
    expect(data.items).toEqual({
      create: [{ menuItemId: "item-1", name: "Круассан", quantity: 2, price: 180 }],
    });
  });

  it("suppressPlacedNotification: order.placed не шлётся", async () => {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(mockOrder() as never);

    await createOrder("user-1", { items: [{ menuItemId: "item-1", quantity: 1 }] }, {
      suppressPlacedNotification: true,
    });

    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("allows linking to a soft-deleted Booking (PO Решение №5)", async () => {
    // findUnique without deletedAt filter still returns the row.
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ id: "booking-deleted" } as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", price: 500 }),
    ] as never);
    vi.mocked(prisma.order.create).mockResolvedValue(
      mockOrder({ bookingId: "booking-deleted" }) as never
    );

    await createOrder("user-1", {
      items: [{ menuItemId: "item-1", quantity: 1 }],
      bookingId: "booking-deleted",
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bookingId: "booking-deleted" }),
      })
    );
  });
});

// ===== updateOrderStatus =====

describe("updateOrderStatus", () => {
  it("transitions NEW → PREPARING successfully", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "NEW" }) as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder({ status: "PREPARING" }) as never);

    const result = await updateOrderStatus("order-1", "PREPARING");

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PREPARING" } })
    );
    expect(result).toBeDefined();
  });

  it("transitions PREPARING → READY successfully", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "PREPARING" }) as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder({ status: "READY" }) as never);

    await updateOrderStatus("order-1", "READY");
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "READY" } })
    );
  });

  it("transitions READY → DELIVERED successfully", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "READY" }) as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder({ status: "DELIVERED" }) as never);

    await updateOrderStatus("order-1", "DELIVERED");
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "DELIVERED" } })
    );
  });

  it("transitions NEW → CANCELLED successfully", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "NEW" }) as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder({ status: "CANCELLED" }) as never);

    await updateOrderStatus("order-1", "CANCELLED");
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } })
    );
  });

  it("throws INVALID_STATUS_TRANSITION for READY → PREPARING", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "READY" }) as never);

    await expect(updateOrderStatus("order-1", "PREPARING")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws INVALID_STATUS_TRANSITION for DELIVERED → CANCELLED (terminal state)", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(mockOrder({ status: "DELIVERED" }) as never);

    await expect(updateOrderStatus("order-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws ORDER_NOT_FOUND when order does not exist", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(updateOrderStatus("nonexistent", "PREPARING")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
  });
});

// ===== cancelOrder =====

describe("cancelOrder", () => {
  it("cancels a NEW order by its owner", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      mockOrder({ userId: "user-1", status: "NEW" }) as never
    );
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder({ status: "CANCELLED" }) as never);

    await cancelOrder("order-1", "user-1");

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } })
    );
  });

  it("throws FORBIDDEN when user is not the order owner", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      mockOrder({ userId: "user-1", status: "NEW" }) as never
    );

    await expect(cancelOrder("order-1", "other-user")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws INVALID_STATUS_TRANSITION when order is already PREPARING", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      mockOrder({ userId: "user-1", status: "PREPARING" }) as never
    );

    await expect(cancelOrder("order-1", "user-1")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws ORDER_NOT_FOUND when order does not exist", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(cancelOrder("nonexistent", "user-1")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
  });
});

// ===== createCheckout (QR-сценарий с онлайн-оплатой) =====

describe("createCheckout", () => {
  const checkoutOrder = () =>
    mockOrder({
      id: "order-abc123",
      userId: null,
      totalAmount: 430,
      deliveryTo: null,
      items: [
        { id: "oi-1", menuItemId: "item-1", name: "Круассан", quantity: 2, price: 180 },
        { id: "oi-2", menuItemId: "item-2", name: "Американо", quantity: 1, price: 70 },
      ],
    });

  function mockMenuForCheckout() {
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      mockMenuItem({ id: "item-1", name: "Круассан", price: 180 }),
      mockMenuItem({ id: "item-2", name: "Американо", price: 70 }),
    ] as never);
  }

  const checkoutInput = {
    items: [
      { menuItemId: "item-1", quantity: 2 },
      { menuItemId: "item-2", quantity: 1 },
    ],
  };

  it("ЮKassa не настроена: заказ создан, payment null, order.placed уходит", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(checkoutOrder() as never);

    const result = await createCheckout(null, checkoutInput);

    expect(result.payment).toBeNull();
    expect(createOnlinePayment).not.toHaveBeenCalled();
    expect(vi.mocked(enqueueNotification).mock.calls.map((c) => c[0].type)).toContain(
      "order.placed"
    );
  });

  it("happy path: платёж ORDER с чеком commodity, order.placed подавлен", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(true);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(checkoutOrder() as never);
    vi.mocked(createOnlinePayment).mockResolvedValue({
      id: "pay-1",
      confirmationUrl: "https://yookassa.example/pay",
    } as never);

    const result = await createCheckout(null, {
      ...checkoutInput,
      customerEmail: "guest@example.com",
    });

    expect(result.payment).toEqual({
      id: "pay-1",
      confirmationUrl: "https://yookassa.example/pay",
    });

    const args = vi.mocked(createOnlinePayment).mock.calls[0][0];
    expect(args.subjectType).toBe("ORDER");
    expect(args.subjectId).toBe("order-abc123");
    expect(args.moduleSlug).toBe("cafe");
    expect(args.amount).toBe(430);
    expect(args.description).toContain("ABC123");
    expect(args.customerEmail).toBe("guest@example.com");
    expect(args.returnUrl).toContain("/payments/{paymentId}");
    expect(args.receiptItems).toEqual([
      {
        description: "Круассан",
        amount: 180,
        quantity: 2,
        paymentMode: "full_payment",
        paymentSubject: "commodity",
      },
      {
        description: "Американо",
        amount: 70,
        quantity: 1,
        paymentMode: "full_payment",
        paymentSubject: "commodity",
      },
    ]);

    // уведомление о создании подавлено — админа оповестит order.paid после оплаты
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("залогиненный без явного контакта: email берётся из профиля", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(true);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(
      checkoutOrder() as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      email: "user@example.com",
    } as never);
    vi.mocked(createOnlinePayment).mockResolvedValue({
      id: "pay-1",
      confirmationUrl: "url",
    } as never);

    await createCheckout("user-1", checkoutInput);

    const args = vi.mocked(createOnlinePayment).mock.calls[0][0];
    expect(args.customerEmail).toBe("user@example.com");
    expect(args.customerPhone).toBeUndefined();
  });

  // «Чеки от ЮKassa» шлют чек только на почту. Телефон из профиля выглядел бы
  // контактом, но чек не доставил бы — честнее явный PAYMENT_CONTACT_REQUIRED.
  it("залогиненный без email в профиле: телефон не подставляется вместо почты", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(true);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(checkoutOrder() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      email: null,
      phone: "+79991234567",
    } as never);
    vi.mocked(createOnlinePayment).mockResolvedValue({
      id: "pay-1",
      confirmationUrl: "url",
    } as never);

    await createCheckout("user-1", checkoutInput);

    const args = vi.mocked(createOnlinePayment).mock.calls[0][0];
    expect(args.customerEmail).toBeNull();
    expect(args.customerPhone).toBeUndefined();
  });

  it("PAYMENT_CREATE_FAILED: заказ остаётся, payment null, order.placed уходит", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(true);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(checkoutOrder() as never);
    vi.mocked(createOnlinePayment).mockRejectedValue(
      new PaymentError("PAYMENT_CREATE_FAILED", "Не удалось создать платёж")
    );

    const result = await createCheckout(null, checkoutInput);

    expect(result.payment).toBeNull();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(vi.mocked(enqueueNotification).mock.calls.map((c) => c[0].type)).toContain(
      "order.placed"
    );
  });

  it("PAYMENT_CONTACT_REQUIRED: заказ отменяется, ошибка пробрасывается", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(true);
    mockMenuForCheckout();
    vi.mocked(prisma.order.create).mockResolvedValue(checkoutOrder() as never);
    vi.mocked(createOnlinePayment).mockRejectedValue(
      new PaymentError("PAYMENT_CONTACT_REQUIRED", "Для чека нужен email или телефон")
    );

    await expect(createCheckout(null, checkoutInput)).rejects.toMatchObject({
      code: "PAYMENT_CONTACT_REQUIRED",
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-abc123" },
      data: { status: "CANCELLED" },
    });
  });
});

// ===== getCafeStats =====

describe("getCafeStats", () => {
  it("считает выручку, средний чек, топ позиций, дни, категории и способы оплаты", async () => {
    const paidAt = new Date("2026-07-20T10:00:00.000Z");
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      {
        id: "o1",
        totalAmount: 430,
        paidAt,
        createdAt: new Date("2026-07-20T09:55:00.000Z"),
        items: [
          { menuItemId: "item-1", name: "Круассан", quantity: 2, price: 180 },
          { menuItemId: "item-2", name: "Американо", quantity: 1, price: 70 },
        ],
      },
      {
        // менеджерский заказ без онлайн-оплаты, доведён до выдачи
        id: "o2",
        totalAmount: 180,
        paidAt: null,
        createdAt: new Date("2026-07-21T12:00:00.000Z"),
        items: [{ menuItemId: "item-1", name: "Круассан", quantity: 1, price: 180 }],
      },
    ] as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: "item-1", name: "Круассан", category: "Выпечка" },
      { id: "item-2", name: "Американо", category: "Напитки" },
    ] as never);
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      { paymentMethodType: "sbp" },
    ] as never);

    const stats = await getCafeStats({ dateFrom: "2026-07-20", dateTo: "2026-07-21" });

    expect(stats.ordersCount).toBe(2);
    expect(stats.revenue).toBe(610);
    expect(stats.avgCheck).toBe(305);
    expect(stats.onlineCount).toBe(1);
    expect(stats.onlineRevenue).toBe(430);

    expect(stats.byDay).toEqual([
      { date: "2026-07-20", orders: 1, revenue: 430 },
      { date: "2026-07-21", orders: 1, revenue: 180 },
    ]);

    expect(stats.topItems[0]).toMatchObject({
      menuItemId: "item-1",
      name: "Круассан",
      category: "Выпечка",
      quantity: 3,
      revenue: 540,
    });
    expect(stats.byCategory).toEqual([
      { category: "Выпечка", quantity: 3, revenue: 540 },
      { category: "Напитки", quantity: 1, revenue: 70 },
    ]);
    expect(stats.byPaymentMethod).toEqual([{ method: "sbp", count: 1 }]);
  });

  it("удалённая из меню позиция: имя из снапшота, категория «Прочее»", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      {
        id: "o1",
        totalAmount: 100,
        paidAt: new Date("2026-07-20T10:00:00.000Z"),
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        items: [{ menuItemId: "item-gone", name: "Смузи (архив)", quantity: 1, price: 100 }],
      },
    ] as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never);

    const stats = await getCafeStats({ dateFrom: "2026-07-20", dateTo: "2026-07-20" });

    expect(stats.topItems[0]).toMatchObject({
      name: "Смузи (архив)",
      category: "Прочее",
    });
  });

  it("пустой период: нули без деления на ноль", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([] as never);

    const stats = await getCafeStats({ dateFrom: "2026-07-01", dateTo: "2026-07-02" });

    expect(stats.ordersCount).toBe(0);
    expect(stats.revenue).toBe(0);
    expect(stats.avgCheck).toBe(0);
    expect(stats.byDay).toEqual([]);
    expect(stats.byPaymentMethod).toEqual([]);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });
});
