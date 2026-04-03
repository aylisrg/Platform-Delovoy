import { describe, it, expect, vi, beforeEach } from "vitest";

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
  },
}));

import {
  createOrder,
  updateOrderStatus,
  cancelOrder,
  OrderError,
} from "@/modules/cafe/service";
import { prisma } from "@/lib/db";

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
