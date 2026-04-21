import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    rentalContract: {
      findUnique: vi.fn(),
    },
    rentalPayment: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    managerTask: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  buildPaymentSchedule,
  generatePaymentsForContract,
  regeneratePendingPayments,
  autoResolveTasksForContract,
  listUpcomingPayments,
} from "@/modules/rental/payments";

const mockedPrisma = prisma as unknown as {
  rentalContract: { findUnique: ReturnType<typeof vi.fn> };
  rentalPayment: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  managerTask: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPaymentSchedule", () => {
  it("builds one row per month between start and end (inclusive start month, exclusive beyond endDate month)", () => {
    const schedule = buildPaymentSchedule({
      id: "c1",
      startDate: new Date(Date.UTC(2026, 0, 10)),
      endDate: new Date(Date.UTC(2026, 5, 20)),
      monthlyRate: "50000",
    });
    // Jan..Jun = 6 payments
    expect(schedule.length).toBe(6);
    expect(schedule[0].periodMonth).toBe(1);
    expect(schedule[0].periodYear).toBe(2026);
    expect(schedule[5].periodMonth).toBe(6);
    // Due date always on 1st of month
    expect(schedule[0].dueDate.getUTCDate()).toBe(1);
  });

  it("handles year boundary", () => {
    const schedule = buildPaymentSchedule({
      id: "c1",
      startDate: new Date(Date.UTC(2026, 10, 1)),
      endDate: new Date(Date.UTC(2027, 1, 1)),
      monthlyRate: "1000",
    });
    expect(schedule.length).toBe(4); // Nov 2026, Dec 2026, Jan 2027, Feb 2027
    expect(schedule[2].periodYear).toBe(2027);
    expect(schedule[2].periodMonth).toBe(1);
  });
});

describe("generatePaymentsForContract", () => {
  it("calls prisma.rentalPayment.createMany with skipDuplicates", async () => {
    mockedPrisma.rentalPayment.createMany.mockResolvedValue({ count: 3 });
    const count = await generatePaymentsForContract({
      id: "c1",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 2, 1)),
      monthlyRate: "1000",
    });
    expect(count).toBe(3);
    expect(mockedPrisma.rentalPayment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });
});

describe("regeneratePendingPayments", () => {
  it("deletes only future unpaid and regenerates", async () => {
    mockedPrisma.rentalContract.findUnique.mockResolvedValue({
      id: "c1",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 3, 1)),
      monthlyRate: "1000",
      currency: "RUB",
    });
    mockedPrisma.rentalPayment.deleteMany.mockResolvedValue({ count: 2 });
    mockedPrisma.rentalPayment.createMany.mockResolvedValue({ count: 4 });

    const res = await regeneratePendingPayments("c1", new Date(Date.UTC(2026, 0, 15)));
    expect(res.deleted).toBe(2);
    expect(res.created).toBe(4);
    expect(mockedPrisma.rentalPayment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: "c1",
          paidAt: null,
        }),
      })
    );
  });

  it("returns zeros if contract missing", async () => {
    mockedPrisma.rentalContract.findUnique.mockResolvedValue(null);
    const res = await regeneratePendingPayments("nope");
    expect(res).toEqual({ deleted: 0, created: 0 });
  });
});

describe("autoResolveTasksForContract", () => {
  it("sets status=RESOLVED on OPEN OVERDUE_PAYMENT tasks", async () => {
    mockedPrisma.managerTask.updateMany.mockResolvedValue({ count: 2 });
    const n = await autoResolveTasksForContract("c1");
    expect(n).toBe(2);
    expect(mockedPrisma.managerTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: "c1", status: "OPEN", type: "OVERDUE_PAYMENT" }),
        data: expect.objectContaining({ status: "RESOLVED", resolution: "CONTRACT_TERMINATING" }),
      })
    );
  });
});

describe("listUpcomingPayments", () => {
  it("queries unpaid within range and filters contract status", async () => {
    mockedPrisma.rentalPayment.findMany.mockResolvedValue([]);
    await listUpcomingPayments(7);
    const args = mockedPrisma.rentalPayment.findMany.mock.calls[0][0];
    expect(args.where.paidAt).toBe(null);
    expect(args.where.contract.status.in).toContain("ACTIVE");
    expect(args.where.contract.status.in).toContain("EXPIRING");
  });
});
