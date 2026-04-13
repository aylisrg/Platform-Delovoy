import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    order: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    rentalContract: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    office: {
      count: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    systemEvent: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn(),
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
}));

import {
  getSystemMap,
  getAggregateAnalytics,
  getPaginatedAuditLogs,
  updateModuleConfig,
  ArchitectError,
} from "@/modules/monitoring/architect-service";
import { prisma } from "@/lib/db";
import { logAudit, log } from "@/lib/logger";

const mockModule = (overrides = {}) => ({
  id: "module-1",
  slug: "cafe",
  name: "Кафе",
  description: "Кафе платформы",
  isActive: true,
  config: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

// ─── getSystemMap ─────────────────────────────────────────────────────────────

describe("getSystemMap", () => {
  it("returns healthy status when health endpoint responds healthy", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([mockModule()] as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "healthy", checks: { db: { status: "ok" } } } }),
    } as Response);

    const result = await getSystemMap();

    expect(result).toHaveLength(1);
    expect(result[0].healthStatus).toBe("healthy");
    expect(result[0].slug).toBe("cafe");
    expect(result[0].isActive).toBe(true);
  });

  it("returns degraded status when health endpoint responds degraded", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([mockModule()] as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "degraded" } }),
    } as Response);

    const result = await getSystemMap();
    expect(result[0].healthStatus).toBe("degraded");
  });

  it("returns unhealthy when health endpoint returns non-ok HTTP", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([mockModule()] as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const result = await getSystemMap();
    expect(result[0].healthStatus).toBe("unhealthy");
  });

  it("returns offline when fetch throws (timeout/network error)", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([mockModule()] as never);
    vi.mocked(fetch).mockRejectedValue(new Error("AbortError"));

    const result = await getSystemMap();
    expect(result[0].healthStatus).toBe("offline");
  });

  it("returns offline for inactive modules without making fetch call", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([
      mockModule({ isActive: false }),
    ] as never);

    const result = await getSystemMap();
    expect(result[0].healthStatus).toBe("offline");
    expect(result[0].isActive).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles multiple modules concurrently", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([
      mockModule({ id: "m1", slug: "cafe", name: "Кафе" }),
      mockModule({ id: "m2", slug: "gazebos", name: "Барбекю Парк" }),
    ] as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "healthy" } }),
    } as Response);

    const result = await getSystemMap();
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.healthStatus === "healthy")).toBe(true);
  });
});

// ─── getAggregateAnalytics ────────────────────────────────────────────────────

describe("getAggregateAnalytics", () => {
  beforeEach(() => {
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.booking.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(prisma.order.aggregate).mockResolvedValue({ _sum: { totalAmount: null } } as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(0);
    vi.mocked(prisma.rentalContract.aggregate).mockResolvedValue({
      _sum: { monthlyRate: null },
    } as never);
    vi.mocked(prisma.office.count).mockResolvedValue(0);
    vi.mocked(prisma.systemEvent.count).mockResolvedValue(0);
  });

  it("returns correct structure with zero values", async () => {
    const result = await getAggregateAnalytics();

    expect(result).toMatchObject({
      bookings: {
        todayTotal: 0,
        weekTotal: 0,
        byModule: {},
      },
      orders: {
        todayCount: 0,
        todayRevenue: 0,
        weekRevenue: 0,
      },
      rental: {
        activeContracts: 0,
        monthlyRevenue: 0,
        occupancyRate: 0,
        expiringIn30Days: 0,
      },
    });
    expect(result.generatedAt).toBeTruthy();
    expect(result.systemEvents).toBeDefined();
  });

  it("aggregates booking groups by module", async () => {
    vi.mocked(prisma.booking.groupBy).mockResolvedValue([
      { moduleSlug: "gazebos", _count: { id: 5 } },
      { moduleSlug: "ps-park", _count: { id: 3 } },
    ] as never);

    const result = await getAggregateAnalytics();
    expect(result.bookings.byModule).toEqual({ gazebos: 5, "ps-park": 3 });
    expect(result.bookings.weekTotal).toBe(8);
  });

  it("computes occupancy rate correctly", async () => {
    vi.mocked(prisma.office.count)
      .mockResolvedValueOnce(10)  // totalOffices
      .mockResolvedValueOnce(7);  // occupiedOffices

    const result = await getAggregateAnalytics();
    expect(result.rental.occupancyRate).toBe(70);
  });

  it("returns 0 occupancy rate when no offices", async () => {
    vi.mocked(prisma.office.count).mockResolvedValue(0);
    const result = await getAggregateAnalytics();
    expect(result.rental.occupancyRate).toBe(0);
  });

  it("converts Decimal revenue to number", async () => {
    vi.mocked(prisma.order.aggregate).mockResolvedValue({
      _sum: { totalAmount: 1500.5 },
    } as never);
    vi.mocked(prisma.rentalContract.aggregate).mockResolvedValue({
      _sum: { monthlyRate: 50000 },
    } as never);

    const result = await getAggregateAnalytics();
    expect(typeof result.orders.todayRevenue).toBe("number");
    expect(typeof result.rental.monthlyRevenue).toBe("number");
    expect(result.rental.monthlyRevenue).toBe(50000);
  });
});

// ─── getPaginatedAuditLogs ────────────────────────────────────────────────────

describe("getPaginatedAuditLogs", () => {
  const mockLog = (overrides = {}) => ({
    id: "log-1",
    userId: "user-1",
    user: { name: "Иван", email: "ivan@test.com" },
    action: "booking.create",
    entity: "Booking",
    entityId: "booking-1",
    metadata: { guests: 4 },
    createdAt: new Date("2024-01-15T10:00:00Z"),
    ...overrides,
  });

  it("returns { logs, total } structure", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([mockLog()] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1);

    const result = await getPaginatedAuditLogs();
    expect(result).toHaveProperty("logs");
    expect(result).toHaveProperty("total", 1);
    expect(result.logs).toHaveLength(1);
  });

  it("maps user fields to userName and userEmail", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([mockLog()] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1);

    const result = await getPaginatedAuditLogs();
    expect(result.logs[0].userName).toBe("Иван");
    expect(result.logs[0].userEmail).toBe("ivan@test.com");
  });

  it("passes userId filter to Prisma", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0);

    await getPaginatedAuditLogs({ userId: "user-42" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-42" }),
      })
    );
  });

  it("passes entity filter to Prisma", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0);

    await getPaginatedAuditLogs({ entity: "Booking" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: "Booking" }),
      })
    );
  });

  it("respects limit and offset", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(100);

    await getPaginatedAuditLogs({ limit: 10, offset: 20 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 })
    );
  });
});

// ─── updateModuleConfig ───────────────────────────────────────────────────────

describe("updateModuleConfig", () => {
  it("updates isActive and calls logAudit", async () => {
    const existing = mockModule();
    vi.mocked(prisma.module.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.module.update).mockResolvedValue({
      ...existing,
      isActive: false,
    } as never);

    await updateModuleConfig("module-1", { isActive: false }, "actor-1");

    expect(prisma.module.update).toHaveBeenCalledWith({
      where: { id: "module-1" },
      data: { isActive: false },
    });
    expect(logAudit).toHaveBeenCalledWith(
      "actor-1",
      "module.config.update",
      "Module",
      "module-1",
      expect.objectContaining({
        after: { isActive: false },
      })
    );
  });

  it("calls log.warn when disabling a module", async () => {
    const existing = mockModule({ isActive: true });
    vi.mocked(prisma.module.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.module.update).mockResolvedValue({
      ...existing,
      isActive: false,
    } as never);

    await updateModuleConfig("module-1", { isActive: false }, "actor-1");

    expect(log.warn).toHaveBeenCalled();
  });

  it("does not call log.warn when enabling a module", async () => {
    const existing = mockModule({ isActive: false });
    vi.mocked(prisma.module.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.module.update).mockResolvedValue({
      ...existing,
      isActive: true,
    } as never);

    await updateModuleConfig("module-1", { isActive: true }, "actor-1");

    expect(log.warn).not.toHaveBeenCalled();
  });

  it("throws ArchitectError with MODULE_NOT_FOUND when module missing", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue(null);

    await expect(
      updateModuleConfig("nonexistent", { isActive: false }, "actor-1")
    ).rejects.toThrow(ArchitectError);

    await expect(
      updateModuleConfig("nonexistent", { isActive: false }, "actor-1")
    ).rejects.toMatchObject({ code: "MODULE_NOT_FOUND" });
  });

  it("updates config JSON", async () => {
    const existing = mockModule({ config: { maxBookings: 5 } });
    vi.mocked(prisma.module.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.module.update).mockResolvedValue({
      ...existing,
      config: { maxBookings: 10 },
    } as never);

    const result = await updateModuleConfig(
      "module-1",
      { config: { maxBookings: 10 } },
      "actor-1"
    );

    expect(prisma.module.update).toHaveBeenCalledWith({
      where: { id: "module-1" },
      data: { config: { maxBookings: 10 } },
    });
    expect(result.config).toEqual({ maxBookings: 10 });
  });
});
