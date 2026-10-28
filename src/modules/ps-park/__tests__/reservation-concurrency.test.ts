import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Booking } from "@prisma/client";

vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findFirst: vi.fn(), update: vi.fn() },
  module: { findUnique: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn(),
} }));
vi.mock("@/lib/logger", () => ({ log: { error: vi.fn() } }));
vi.mock("@/modules/notifications/queue", () => ({ enqueueNotification: vi.fn() }));
vi.mock("@/modules/payments/service", () => ({ createOnlinePayment: vi.fn(), getBookingPaymentSummaries: vi.fn() }));
vi.mock("@/modules/inventory/service", () => ({ validateAndSnapshotItems: vi.fn(), saleBookingItems: vi.fn(), returnBookingItems: vi.fn() }));
vi.mock("@/lib/google-calendar", () => ({ createCalendarEvent: vi.fn(), deleteCalendarEvent: vi.fn() }));
vi.mock("@/modules/clients/service", () => ({ upsertClientByPhone: vi.fn() }));
vi.mock("@/modules/subscriptions/service", () => ({ getActiveSubscriptionForUser: vi.fn() }));
vi.mock("@/modules/subscriptions/debit", () => ({ debitFromSession: vi.fn(), SubscriptionDebitError: class extends Error {} }));

import { prisma } from "@/lib/db";
import { checkInBooking, extendBooking, markNoShow } from "../service";

let stored: Booking;
const paidMetadata = { paymentPurpose: "reservation", totalPrice: "1000", onlinePaidAmount: "1000", pricePerHour: "500" };
const oldUpdatedAt = new Date("2026-10-28T08:00:00.000Z");
const movedUpdatedAt = new Date("2026-10-28T10:00:01.000Z");

function moveWhileActionIsWaiting() {
  stored = { ...stored, date: new Date("2026-10-30"), startTime: new Date("2026-10-30T09:00:00Z"),
    endTime: new Date("2026-10-30T11:00:00Z"), updatedAt: movedUpdatedAt,
    status: "CONFIRMED", metadata: { ...paidMetadata, rescheduleCount: 1 } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
  stored = { id: "reservation-1", resourceId: "table-1", moduleSlug: "ps-park", status: "CONFIRMED",
    date: new Date("2026-10-28"), startTime: new Date("2026-10-28T09:00:00Z"),
    endTime: new Date("2026-10-28T11:00:00Z"), updatedAt: oldUpdatedAt,
    metadata: { ...paidMetadata }, deletedAt: null } as unknown as Booking;
  vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: { openHour: 8, closeHour: 23 } } as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
  vi.mocked(prisma.booking.findFirst).mockImplementation((async ({ where }: { where: { id: unknown } }) => (
    typeof where.id === "string" ? structuredClone(stored) : null
  )) as never);
  // Model PostgreSQL's conditional UPDATE: a stale predicate must reject the
  // write; an unguarded where{id} really would overwrite the transferred row.
  vi.mocked(prisma.booking.update).mockImplementation((async ({ where, data }: {
    where: { id: string; status?: Booking["status"]; startTime?: Date; endTime?: Date; updatedAt?: Date };
    data: Partial<Booking>;
  }) => {
    const stale = (where.status !== undefined && where.status !== stored.status) ||
      (["startTime", "endTime", "updatedAt"] as const).some((key) => where[key] && where[key]!.getTime() !== stored[key].getTime());
    if (stale) throw new Prisma.PrismaClientKnownRequestError("Record no longer matches conditional update", { code: "P2025", clientVersion: "6.19.3" });
    stored = { ...stored, ...data };
    return structuredClone(stored);
  }) as never);
});
afterEach(() => vi.useRealTimers());

const actions = [
  { name: "check-in", run: checkInBooking, expectedStatus: "CHECKED_IN" },
  { name: "no-show", run: markNoShow, expectedStatus: "NO_SHOW" },
  { name: "extend", run: extendBooking, expectedStatus: "CONFIRMED" },
] as const;

describe("Play Park reservation transitions racing a transfer", () => {
  it.each(actions)("$name cannot apply a snapshot read before reschedule", async ({ run }) => {
    vi.mocked(prisma.module.findUnique).mockImplementation((async () => {
      moveWhileActionIsWaiting();
      return { config: { openHour: 8, closeHour: 23 } };
    }) as never);
    await expect(run(stored.id, "manager-1")).rejects.toMatchObject({ code: "BOOKING_CHANGED" });
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.startTime.toISOString()).toBe("2026-10-30T09:00:00.000Z");
    expect(stored.endTime.toISOString()).toBe("2026-10-30T11:00:00.000Z");
    expect(stored.updatedAt).toEqual(movedUpdatedAt);
    expect(stored.metadata).toEqual({ ...paidMetadata, rescheduleCount: 1 });
    expect(prisma.booking.update).toHaveBeenCalledTimes(1);
  });

  it.each(actions)("$name still works with a current snapshot and keeps the paid amount", async ({ run, expectedStatus }) => {
    await run(stored.id, "manager-1");
    expect(stored.status).toBe(expectedStatus);
    expect(stored.metadata).toMatchObject(paidMetadata);
    expect(stored.startTime.toISOString()).toBe("2026-10-28T09:00:00.000Z");
    if (run === extendBooking) expect(stored.endTime.toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });

  it("rejects a late NO_SHOW check-in captured before transfer", async () => {
    stored.status = "NO_SHOW";
    vi.mocked(prisma.module.findUnique).mockImplementation((async () => {
      moveWhileActionIsWaiting();
      return { config: { openHour: 8, closeHour: 23 } };
    }) as never);
    await expect(checkInBooking(stored.id, "manager-1")).rejects.toMatchObject({ code: "BOOKING_CHANGED" });
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.metadata).toEqual({ ...paidMetadata, rescheduleCount: 1 });
    expect(stored.startTime.toISOString()).toBe("2026-10-30T09:00:00.000Z");
  });
});
