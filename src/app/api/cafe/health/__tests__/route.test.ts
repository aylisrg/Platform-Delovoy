import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMenuItemCount = vi.fn();
const mockOrderCount = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    menuItem: { count: (...args: unknown[]) => mockMenuItemCount(...args) },
    order: { count: (...args: unknown[]) => mockOrderCount(...args) },
  },
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mockMenuItemCount.mockResolvedValue(3);
  mockOrderCount.mockResolvedValue(2);
});

describe("GET /api/cafe/health", () => {
  it("возвращает healthy с метриками", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.metrics).toEqual({ activeMenuItems: 3, todayOrders: 2 });
  });

  it("исключает soft-deleted позиции меню из activeMenuItems (issue #620, тот же баг что #489/#557)", async () => {
    await GET();

    expect(mockMenuItemCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("исключает soft-deleted заказы из todayOrders (issue #620, тот же баг что #489/#557)", async () => {
    await GET();

    expect(mockOrderCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("возвращает 503 при ошибке БД", async () => {
    mockOrderCount.mockRejectedValue(new Error("db down"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });
});
