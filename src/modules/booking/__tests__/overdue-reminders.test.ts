import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    moduleAssignment: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({
  dispatch: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import {
  DEFAULT_OVERDUE_THRESHOLDS,
  EVENT_TYPES,
  findOverdueBookings,
  scanAndDispatchOverdue,
} from "../overdue-reminders";

const mockedDispatch = vi.mocked(dispatch);
// Loosened types: tests build minimal stubs (not full Prisma row shapes).
const mockedPrisma = {
  module: prisma.module.findUnique as unknown as ReturnType<typeof vi.fn>,
  bookingFindMany: prisma.booking.findMany as unknown as ReturnType<typeof vi.fn>,
  moduleAssignment: prisma.moduleAssignment.findMany as unknown as ReturnType<typeof vi.fn>,
  user: prisma.user.findMany as unknown as ReturnType<typeof vi.fn>,
  auditLog: prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>,
  systemEvent: prisma.systemEvent.create as unknown as ReturnType<typeof vi.fn>,
};

const NOW = new Date("2026-05-10T12:00:00Z");

function minutesAgo(min: number): Date {
  return new Date(NOW.getTime() - min * 60_000);
}

function moduleStub(slug: string, opts: { isActive?: boolean; config?: unknown } = {}) {
  return {
    id: `mod-${slug}`,
    slug,
    name: slug,
    description: null,
    isActive: opts.isActive ?? true,
    config: opts.config ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function bookingStub(overrides: {
  id: string;
  endTime: Date;
  status?: "CHECKED_IN" | "CONFIRMED";
  resourceId?: string;
}) {
  return {
    id: overrides.id,
    moduleSlug: "ps-park",
    endTime: overrides.endTime,
    status: overrides.status ?? "CHECKED_IN",
    resourceId: overrides.resourceId ?? "table-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: ps-park active, gazebos active.
  mockedPrisma.module.mockImplementation(async ({ where }: { where: { slug: string } }) =>
    moduleStub(where.slug)
  );
  mockedPrisma.bookingFindMany.mockResolvedValue([]);
  mockedPrisma.moduleAssignment.mockResolvedValue([]);
  mockedPrisma.user.mockResolvedValue([]);
  mockedPrisma.auditLog.mockResolvedValue({});
  mockedPrisma.systemEvent.mockResolvedValue({});
  mockedDispatch.mockResolvedValue({
    status: "queued",
    outgoingId: "out-1",
    scheduledFor: NOW,
  });
});

describe("findOverdueBookings", () => {
  it("queries with the firstReminderMinutes cutoff and returns ageMinutes", async () => {
    mockedPrisma.bookingFindMany.mockResolvedValueOnce([
      bookingStub({ id: "b1", endTime: minutesAgo(10) }),
    ]);
    const found = await findOverdueBookings(NOW, "ps-park", DEFAULT_OVERDUE_THRESHOLDS);
    expect(found).toHaveLength(1);
    expect(found[0].ageMinutes).toBe(10);
    expect(found[0].bookingId).toBe("b1");

    const where = (mockedPrisma.bookingFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> })
      .where;
    expect(where.moduleSlug).toBe("ps-park");
    expect(where.deletedAt).toBeNull();
    expect(where.status).toEqual({ in: ["CHECKED_IN", "CONFIRMED"] });
    const endFilter = where.endTime as { lt: Date };
    expect(endFilter.lt.getTime()).toBe(NOW.getTime() - 5 * 60_000);
  });
});

describe("scanAndDispatchOverdue", () => {
  it("dispatches first reminder to module managers for a 10-min overdue booking", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b1", endTime: minutesAgo(10) })])
      .mockResolvedValueOnce([]); // gazebos empty
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);

    const result = await scanAndDispatchOverdue(NOW);

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "mgr-1",
        eventType: EVENT_TYPES.first,
        entityType: "Booking",
        entityId: "b1",
      })
    );
    expect(result).toMatchObject({ scanned: 1, dispatched: 1, escalated: 0 });
    expect(mockedPrisma.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "mgr-1",
          action: "notification.overdue.dispatched",
          entity: "Booking",
          entityId: "b1",
        }),
      })
    );
  });

  it("uses repeat-event when overdue >=15 and <30 minutes", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b2", endTime: minutesAgo(20) })])
      .mockResolvedValueOnce([]);
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);

    await scanAndDispatchOverdue(NOW);

    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: EVENT_TYPES.repeat, userId: "mgr-1" })
    );
  });

  it("escalates to SUPERADMIN(s) at >=30 min, also notifying module managers", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b3", endTime: minutesAgo(35) })])
      .mockResolvedValueOnce([]);
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);
    mockedPrisma.user.mockResolvedValue([{ id: "super-1" }]);

    const result = await scanAndDispatchOverdue(NOW);

    const calls = mockedDispatch.mock.calls.map((c) => c[0]);
    const recipients = calls.map((c) => c.userId).sort();
    expect(recipients).toEqual(["mgr-1", "super-1"]);
    expect(calls.every((c) => c.eventType === EVENT_TYPES.escalated)).toBe(true);
    expect(result.escalated).toBe(2);

    // Aggregate WARNING SystemEvent for the escalation.
    expect(mockedPrisma.systemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: "WARNING",
          source: "scheduler",
          message: expect.stringContaining("escalated to SUPERADMIN"),
        }),
      })
    );
  });

  it("counts dedup as 'deduped' when dispatcher reports duplicate", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b1", endTime: minutesAgo(10) })])
      .mockResolvedValueOnce([]);
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);
    mockedDispatch.mockResolvedValue({ status: "skipped", reason: "duplicate" });

    const result = await scanAndDispatchOverdue(NOW);

    expect(result).toMatchObject({ scanned: 1, dispatched: 0, deduped: 1 });
    expect(mockedPrisma.auditLog).not.toHaveBeenCalled();
  });

  it("respects Module.config.overdueThresholds override", async () => {
    // First reminder threshold lifted to 20 minutes — a 10-min overdue
    // booking should NOT trigger any dispatch in this run.
    mockedPrisma.module.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      moduleStub(where.slug, {
        config: {
          overdueThresholds: {
            firstReminderMinutes: 20,
            repeatReminderMinutes: 40,
            escalateToSuperadminMinutes: 60,
          },
        },
      })
    );
    mockedPrisma.bookingFindMany.mockResolvedValue([]); // cutoff would exclude it
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);

    await scanAndDispatchOverdue(NOW);

    // The query was issued with the overridden cutoff.
    const where = (mockedPrisma.bookingFindMany.mock.calls[0]?.[0] as {
      where: { endTime: { lt: Date } };
    }).where;
    expect(where.endTime.lt.getTime()).toBe(NOW.getTime() - 20 * 60_000);
  });

  it("falls back to defaults and emits WARNING when config override is invalid", async () => {
    mockedPrisma.module.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      moduleStub(where.slug, {
        config: { overdueThresholds: "not-an-object" },
      })
    );
    mockedPrisma.bookingFindMany.mockResolvedValue([]);
    await scanAndDispatchOverdue(NOW);

    const warningCalls = mockedPrisma.systemEvent.mock.calls.filter((c) =>
      ((c[0] as { data: { message: string } }).data.message ?? "").includes(
        "Invalid overdueThresholds"
      )
    );
    expect(warningCalls.length).toBeGreaterThanOrEqual(1);

    // And the cutoff falls back to default 5 minutes.
    const where = (mockedPrisma.bookingFindMany.mock.calls[0]?.[0] as {
      where: { endTime: { lt: Date } };
    }).where;
    expect(where.endTime.lt.getTime()).toBe(NOW.getTime() - 5 * 60_000);
  });

  it("skips inactive modules", async () => {
    mockedPrisma.module.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      moduleStub(where.slug, { isActive: false })
    );
    await scanAndDispatchOverdue(NOW);
    expect(mockedPrisma.bookingFindMany).not.toHaveBeenCalled();
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it("skips booking and writes WARNING when no managers assigned", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b1", endTime: minutesAgo(10) })])
      .mockResolvedValueOnce([]);
    mockedPrisma.moduleAssignment.mockResolvedValue([]); // no managers

    const result = await scanAndDispatchOverdue(NOW);

    expect(mockedDispatch).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(0);
    expect(mockedPrisma.systemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: "WARNING",
          message: expect.stringContaining("no recipients"),
        }),
      })
    );
  });

  it("counts skippedNoChannel and emits WARNING when dispatcher reports no channel", async () => {
    mockedPrisma.bookingFindMany
      .mockResolvedValueOnce([bookingStub({ id: "b1", endTime: minutesAgo(10) })])
      .mockResolvedValueOnce([]);
    mockedPrisma.moduleAssignment.mockResolvedValue([{ userId: "mgr-1" }]);
    mockedDispatch.mockResolvedValue({
      status: "skipped",
      reason: "no available channel",
    });

    const result = await scanAndDispatchOverdue(NOW);

    expect(result.skippedNoChannel).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockedPrisma.systemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: "WARNING",
          message: expect.stringContaining("no available notification channel"),
        }),
      })
    );
  });
});
