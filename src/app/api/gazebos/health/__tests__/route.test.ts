import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResourceCount = vi.fn();
const mockBookingCount = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    resource: { count: (...args: unknown[]) => mockResourceCount(...args) },
    booking: { count: (...args: unknown[]) => mockBookingCount(...args) },
  },
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mockResourceCount.mockResolvedValue(3);
  mockBookingCount.mockResolvedValue(2);
});

describe("GET /api/gazebos/health", () => {
  it("возвращает healthy с метриками", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.metrics).toEqual({ activeResources: 3, todayBookings: 2 });
  });

  it("исключает soft-deleted брони из todayBookings (issue #489)", async () => {
    await GET();

    expect(mockBookingCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("возвращает 503 при ошибке БД", async () => {
    mockBookingCount.mockRejectedValue(new Error("db down"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });
});
