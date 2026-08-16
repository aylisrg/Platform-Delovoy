import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ hasAdminSectionAccess: vi.fn() }));
vi.mock("@/modules/cafe/service", () => ({ getMenuAdmin: vi.fn() }));
vi.mock("next/navigation", () => ({ forbidden: vi.fn() }));

const mockOrderFindMany = vi.fn();
const mockOrderCount = vi.fn();
const mockOrderAggregate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => mockOrderFindMany(...args),
      count: (...args: unknown[]) => mockOrderCount(...args),
      aggregate: (...args: unknown[]) => mockOrderAggregate(...args),
    },
  },
}));

import { buildCafeOrdersWhere, getCafeOrdersData } from "../page";

const today = new Date("2026-08-16T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockOrderFindMany.mockResolvedValue([]);
  mockOrderCount.mockResolvedValue(0);
  mockOrderAggregate.mockResolvedValue({ _sum: { totalAmount: null } });
});

describe("buildCafeOrdersWhere (issue #661, тот же баг что #489/#557/#620/#650)", () => {
  it("фильтрует deletedAt: null без активных фильтров", () => {
    const where = buildCafeOrdersWhere(today, null, false);
    expect(where).toEqual(
      expect.objectContaining({ moduleSlug: "cafe", createdAt: { gte: today }, deletedAt: null })
    );
  });

  it("фильтрует deletedAt: null вместе с фильтром по статусу", () => {
    const where = buildCafeOrdersWhere(today, "NEW", false);
    expect(where).toEqual(expect.objectContaining({ deletedAt: null, status: "NEW" }));
  });

  it("фильтрует deletedAt: null вместе с фильтром «только оплаченные»", () => {
    const where = buildCafeOrdersWhere(today, null, true);
    expect(where).toEqual(expect.objectContaining({ deletedAt: null, paidAt: { not: null } }));
  });
});

describe("getCafeOrdersData", () => {
  it("возвращает orders/todayCount/activeCount/todayRevenue", async () => {
    mockOrderFindMany.mockResolvedValueOnce([{ id: "o1" }]);
    mockOrderCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    mockOrderAggregate.mockResolvedValueOnce({ _sum: { totalAmount: 1500 } });

    const where = buildCafeOrdersWhere(today, null, false);
    const result = await getCafeOrdersData(where, today);

    expect(result.orders).toEqual([{ id: "o1" }]);
    expect(result.todayCount).toBe(3);
    expect(result.activeCount).toBe(1);
    expect(result.todayRevenue._sum.totalAmount).toBe(1500);
  });

  it("передаёт переданный ordersWhere напрямую в findMany", async () => {
    const where = buildCafeOrdersWhere(today, "READY", true);

    await getCafeOrdersData(where, today);

    expect(mockOrderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null, status: "READY" }) })
    );
  });

  it("исключает soft-deleted заказы из todayCount/activeCount (issue #650, тот же баг что #489/#557/#620)", async () => {
    await getCafeOrdersData(buildCafeOrdersWhere(today, null, false), today);

    expect(mockOrderCount).toHaveBeenCalledTimes(2);
    for (const call of mockOrderCount.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
      );
    }
  });
});
