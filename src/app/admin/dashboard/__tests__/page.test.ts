import { describe, it, expect, vi, beforeEach } from "vitest";

const mockModuleCount = vi.fn();
const mockBookingCount = vi.fn();
const mockOrderCount = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    module: { count: (...args: unknown[]) => mockModuleCount(...args) },
    booking: { count: (...args: unknown[]) => mockBookingCount(...args) },
    order: { count: (...args: unknown[]) => mockOrderCount(...args) },
  },
}));

import { getDashboardStats } from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  mockModuleCount.mockResolvedValue(0);
  mockBookingCount.mockResolvedValue(0);
  mockOrderCount.mockResolvedValue(0);
});

describe("getDashboardStats", () => {
  it("возвращает агрегированную статистику", async () => {
    mockModuleCount.mockResolvedValueOnce(5).mockResolvedValueOnce(8);
    mockBookingCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    mockOrderCount.mockResolvedValueOnce(7);

    const stats = await getDashboardStats();

    expect(stats).toEqual({
      activeModules: 5,
      totalModules: 8,
      bookingsToday: 5,
      gazeboBookingsToday: 3,
      psParkBookingsToday: 2,
      ordersToday: 7,
    });
  });

  it("исключает soft-deleted брони из bookingsToday (issue #660, тот же баг что #489/#557/#620/#650)", async () => {
    await getDashboardStats();

    expect(mockBookingCount).toHaveBeenCalledTimes(2);
    for (const call of mockBookingCount.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
      );
    }
  });

  it("исключает soft-deleted заказы из ordersToday (issue #650, тот же баг что #489/#557/#620)", async () => {
    await getDashboardStats();

    expect(mockOrderCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  it("возвращает нулевую статистику при ошибке БД", async () => {
    mockOrderCount.mockRejectedValueOnce(new Error("db down"));

    const stats = await getDashboardStats();

    expect(stats).toEqual({
      activeModules: 0,
      totalModules: 0,
      bookingsToday: 0,
      gazeboBookingsToday: 0,
      psParkBookingsToday: 0,
      ordersToday: 0,
    });
  });
});
