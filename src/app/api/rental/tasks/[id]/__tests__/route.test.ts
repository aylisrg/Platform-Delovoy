/**
 * Unit test for PATCH /api/rental/tasks/[id] — markPaymentPaid atomicity (AC-5.5).
 * Covers Reviewer finding M-1 (prisma.$transaction usage).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } }),
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    managerTask: {
      findUnique: vi.fn(),
      update: vi.fn((args) => args),
    },
    rentalPayment: {
      update: vi.fn((args) => args),
    },
    $transaction: vi.fn(),
  },
}));

import { PATCH } from "@/app/api/rental/tasks/[id]/route";
import { prisma } from "@/lib/db";

const mockedPrisma = prisma as unknown as {
  managerTask: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  rentalPayment: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/rental/tasks/t1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/rental/tasks/[id]", () => {
  it("calls prisma.$transaction with BOTH managerTask.update and rentalPayment.update when markPaymentPaid=true (AC-5.5)", async () => {
    mockedPrisma.managerTask.findUnique.mockResolvedValue({
      id: "t1",
      status: "OPEN",
      paymentId: "p1",
    });
    mockedPrisma.$transaction.mockResolvedValue([{ id: "t1", status: "RESOLVED" }, { id: "p1" }]);

    const res = await PATCH(request({
      status: "RESOLVED",
      resolution: "PAYMENT_RECEIVED",
      markPaymentPaid: true,
    }) as never, { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(200);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    // Transaction receives an array of 2 operations
    const ops = mockedPrisma.$transaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBe(2);
  });

  it("transaction has only managerTask.update when markPaymentPaid=false", async () => {
    mockedPrisma.managerTask.findUnique.mockResolvedValue({
      id: "t1",
      status: "OPEN",
      paymentId: "p1",
    });
    mockedPrisma.$transaction.mockResolvedValue([{ id: "t1", status: "RESOLVED" }]);

    const res = await PATCH(request({
      status: "RESOLVED",
      resolution: "OTHER",
      markPaymentPaid: false,
    }) as never, { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(200);
    const ops = mockedPrisma.$transaction.mock.calls[0][0];
    expect(ops.length).toBe(1);
  });

  it("skips payment update if task has no paymentId even when markPaymentPaid=true", async () => {
    mockedPrisma.managerTask.findUnique.mockResolvedValue({
      id: "t1",
      status: "OPEN",
      paymentId: null,
    });
    mockedPrisma.$transaction.mockResolvedValue([{ id: "t1", status: "RESOLVED" }]);

    await PATCH(request({
      status: "RESOLVED",
      resolution: "PAYMENT_RECEIVED",
      markPaymentPaid: true,
    }) as never, { params: Promise.resolve({ id: "t1" }) });

    const ops = mockedPrisma.$transaction.mock.calls[0][0];
    expect(ops.length).toBe(1);
  });

  it("returns 404 for missing task", async () => {
    mockedPrisma.managerTask.findUnique.mockResolvedValue(null);
    const res = await PATCH(request({
      status: "RESOLVED",
    }) as never, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
