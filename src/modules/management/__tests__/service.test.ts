import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringExpense: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    expense: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import {
  formatAutoExpenseName,
  advanceNextBillingDate,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  getSummary,
  processRecurring,
  listRecurringExpenses,
  listExpenses,
  getHealth,
} from "../service";
import { prisma } from "@/lib/db";

const mockPrisma = prisma as unknown as {
  recurringExpense: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  expense: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  auditLog: { create: ReturnType<typeof vi.fn> };
  systemEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// === HELPERS ===

describe("formatAutoExpenseName", () => {
  it("formats name with month and year", () => {
    const result = formatAutoExpenseName("Timeweb VPS", new Date("2026-04-15"));
    expect(result).toBe("Timeweb VPS — апрель 2026");
  });

  it("handles January correctly", () => {
    const result = formatAutoExpenseName("GitHub", new Date("2027-01-01"));
    expect(result).toBe("GitHub — январь 2027");
  });

  it("handles December correctly", () => {
    const result = formatAutoExpenseName("Домен", new Date("2026-12-31"));
    expect(result).toBe("Домен — декабрь 2026");
  });
});

describe("advanceNextBillingDate", () => {
  it("advances MONTHLY by one month", () => {
    const result = advanceNextBillingDate(new Date("2026-04-01"), "MONTHLY");
    expect(result.getMonth()).toBe(4); // May
    expect(result.getFullYear()).toBe(2026);
  });

  it("advances QUARTERLY by three months", () => {
    const result = advanceNextBillingDate(new Date("2026-04-01"), "QUARTERLY");
    expect(result.getMonth()).toBe(6); // July
  });

  it("advances YEARLY by one year", () => {
    const result = advanceNextBillingDate(new Date("2026-04-01"), "YEARLY");
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(3); // April
  });

  it("handles year boundary for MONTHLY", () => {
    const result = advanceNextBillingDate(new Date("2026-12-15"), "MONTHLY");
    expect(result.getMonth()).toBe(0); // January
    expect(result.getFullYear()).toBe(2027);
  });
});

// === RECURRING EXPENSES ===

describe("createRecurringExpense", () => {
  it("creates record and audit log", async () => {
    const mockRecord = {
      id: "rec-1",
      name: "Timeweb VPS",
      amount: 3500,
      category: "IT_INFRASTRUCTURE",
      frequency: "MONTHLY",
    };
    mockPrisma.recurringExpense.create.mockResolvedValue(mockRecord);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await createRecurringExpense(
      {
        name: "Timeweb VPS",
        category: "IT_INFRASTRUCTURE",
        frequency: "MONTHLY",
        amount: 3500,
        startDate: "2026-04-01",
        nextBillingDate: "2026-05-01",
      },
      "user-1"
    );

    expect(result).toEqual(mockRecord);
    expect(mockPrisma.recurringExpense.create).toHaveBeenCalledOnce();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "recurring_expense.create",
          entity: "RecurringExpense",
          entityId: "rec-1",
        }),
      })
    );
  });
});

describe("updateRecurringExpense", () => {
  it("updates record and logs changes", async () => {
    const existing = {
      id: "rec-1",
      name: "Timeweb",
      amount: { toNumber: () => 3500 },
      category: "IT_INFRASTRUCTURE",
      frequency: "MONTHLY",
      isActive: true,
      deletedAt: null,
    };
    // Make amount behave like Prisma Decimal
    Object.defineProperty(existing, "amount", { value: 3500, writable: true });

    mockPrisma.recurringExpense.findFirst.mockResolvedValue(existing);
    mockPrisma.recurringExpense.update.mockResolvedValue({
      ...existing,
      amount: 5000,
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await updateRecurringExpense(
      "rec-1",
      { amount: 5000 },
      "user-1"
    );

    expect(result).toBeTruthy();
    expect(mockPrisma.recurringExpense.update).toHaveBeenCalledOnce();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "recurring_expense.update",
        }),
      })
    );
  });

  it("returns null for non-existent record", async () => {
    mockPrisma.recurringExpense.findFirst.mockResolvedValue(null);
    const result = await updateRecurringExpense("bad-id", { amount: 100 }, "user-1");
    expect(result).toBeNull();
  });
});

describe("deleteRecurringExpense", () => {
  it("soft deletes and sets isActive false", async () => {
    mockPrisma.recurringExpense.findFirst.mockResolvedValue({
      id: "rec-1",
      deletedAt: null,
    });
    mockPrisma.recurringExpense.update.mockResolvedValue({
      id: "rec-1",
      deletedAt: new Date(),
      isActive: false,
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await deleteRecurringExpense("rec-1", "user-1");
    expect(result).toBeTruthy();
    expect(mockPrisma.recurringExpense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
        }),
      })
    );
  });

  it("returns null for already deleted", async () => {
    mockPrisma.recurringExpense.findFirst.mockResolvedValue(null);
    const result = await deleteRecurringExpense("bad-id", "user-1");
    expect(result).toBeNull();
  });
});

// === EXPENSES ===

describe("createExpense", () => {
  it("creates manual expense with isAutoGenerated=false", async () => {
    const mockRecord = {
      id: "exp-1",
      name: "Яндекс.Директ",
      isAutoGenerated: false,
    };
    mockPrisma.expense.create.mockResolvedValue(mockRecord);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await createExpense(
      {
        name: "Яндекс.Директ",
        category: "ADVERTISING",
        amount: 15000,
        date: "2026-04-15",
      },
      "user-1"
    );

    expect(result).toEqual(mockRecord);
    expect(mockPrisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isAutoGenerated: false,
          createdById: "user-1",
        }),
      })
    );
  });
});

describe("updateExpense", () => {
  it("rejects update of auto-generated expense", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue({
      id: "exp-1",
      isAutoGenerated: true,
      deletedAt: null,
    });

    const result = await updateExpense("exp-1", { name: "New" }, "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("IMMUTABLE_AUTO_EXPENSE");
    }
  });

  it("allows update of manual expense", async () => {
    const existing = {
      id: "exp-1",
      name: "Old",
      isAutoGenerated: false,
      deletedAt: null,
      category: "ADVERTISING",
      amount: 100,
    };
    mockPrisma.expense.findFirst.mockResolvedValue(existing);
    mockPrisma.expense.update.mockResolvedValue({ ...existing, name: "New" });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await updateExpense("exp-1", { name: "New" }, "user-1");
    expect(result.success).toBe(true);
  });

  it("returns NOT_FOUND for missing expense", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(null);
    const result = await updateExpense("bad-id", { name: "X" }, "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("NOT_FOUND");
    }
  });
});

describe("deleteExpense", () => {
  it("rejects delete of auto-generated expense", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue({
      id: "exp-1",
      isAutoGenerated: true,
      deletedAt: null,
    });

    const result = await deleteExpense("exp-1", "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("IMMUTABLE_AUTO_EXPENSE");
    }
  });

  it("soft deletes manual expense", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue({
      id: "exp-1",
      isAutoGenerated: false,
      deletedAt: null,
    });
    mockPrisma.expense.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await deleteExpense("exp-1", "user-1");
    expect(result.success).toBe(true);
  });
});

// === SUMMARY ===

describe("getSummary", () => {
  it("calculates totals by category", async () => {
    mockPrisma.expense.findMany.mockResolvedValue([
      { amount: 3500, category: "IT_INFRASTRUCTURE" },
      { amount: 15000, category: "ADVERTISING" },
      { amount: 1500, category: "TELEPHONY" },
    ]);
    mockPrisma.recurringExpense.findMany.mockResolvedValue([]);

    const result = await getSummary({ from: "2026-04-01", to: "2026-04-30" });

    expect(result.totalSpent).toBe("20000.00");
    expect(result.byCategory.IT_INFRASTRUCTURE).toBe("3500");
    expect(result.byCategory.ADVERTISING).toBe("15000");
    expect(result.byCategory.TELEPHONY).toBe("1500");
    expect(result.byCategory.OPERATIONS).toBe("0");
    expect(result.expenseCount).toBe(3);
  });

  it("includes upcoming recurring in projected total", async () => {
    mockPrisma.expense.findMany.mockResolvedValue([
      { amount: 10000, category: "ADVERTISING" },
    ]);
    mockPrisma.recurringExpense.findMany.mockResolvedValue([
      {
        id: "rec-1",
        name: "Timeweb VPS",
        amount: 3500,
        nextBillingDate: new Date("2026-04-25"),
        category: "IT_INFRASTRUCTURE",
      },
    ]);

    const result = await getSummary({ from: "2026-04-01", to: "2026-04-30" });

    expect(result.upcoming.items).toHaveLength(1);
    expect(result.upcoming.totalUpcoming).toBe("3500.00");
    expect(result.projectedTotal).toBe("13500.00");
  });

  it("uses default period when not specified", async () => {
    mockPrisma.expense.findMany.mockResolvedValue([]);
    mockPrisma.recurringExpense.findMany.mockResolvedValue([]);

    const result = await getSummary({});
    expect(result.period.from).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

// === PROCESS RECURRING ===

describe("processRecurring", () => {
  it("creates expenses from due templates", async () => {
    const dueTemplate = {
      id: "rec-1",
      name: "Timeweb VPS",
      category: "IT_INFRASTRUCTURE",
      frequency: "MONTHLY",
      amount: 3500,
      currency: "RUB",
      nextBillingDate: new Date("2026-04-01"),
      isActive: true,
      deletedAt: null,
    };

    mockPrisma.recurringExpense.findMany.mockResolvedValue([dueTemplate]);
    mockPrisma.$transaction.mockResolvedValue([
      { id: "exp-1", name: "Timeweb VPS — апрель 2026" },
      {},
    ]);
    mockPrisma.systemEvent.create.mockResolvedValue({});

    const result = await processRecurring();

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.details[0].name).toBe("Timeweb VPS — апрель 2026");
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  it("skips when no templates are due", async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([]);
    mockPrisma.systemEvent.create.mockResolvedValue({});

    const result = await processRecurring();
    expect(result.created).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("continues processing after individual failure", async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([
      {
        id: "rec-1",
        name: "Fail",
        category: "IT_INFRASTRUCTURE",
        frequency: "MONTHLY",
        amount: 100,
        currency: "RUB",
        nextBillingDate: new Date("2026-04-01"),
      },
      {
        id: "rec-2",
        name: "Success",
        category: "ADVERTISING",
        frequency: "MONTHLY",
        amount: 200,
        currency: "RUB",
        nextBillingDate: new Date("2026-04-01"),
      },
    ]);

    mockPrisma.$transaction
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce([{ id: "exp-2", name: "Success — апрель 2026" }, {}]);
    mockPrisma.systemEvent.create.mockResolvedValue({});

    const result = await processRecurring();
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].recurringId).toBe("rec-1");
  });
});

// === LIST ===

describe("listRecurringExpenses", () => {
  it("lists with pagination", async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([]);
    mockPrisma.recurringExpense.count.mockResolvedValue(0);

    const result = await listRecurringExpenses({ page: 1, limit: 20 });
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ page: 1, total: 0 });
  });
});

describe("listExpenses", () => {
  it("lists with date range filter", async () => {
    mockPrisma.expense.findMany.mockResolvedValue([]);
    mockPrisma.expense.count.mockResolvedValue(0);

    const result = await listExpenses({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(result.data).toEqual([]);
  });
});

// === HEALTH ===

describe("getHealth", () => {
  it("returns healthy status with counts", async () => {
    mockPrisma.recurringExpense.count.mockResolvedValue(3);
    mockPrisma.expense.count.mockResolvedValue(10);

    const result = await getHealth();
    expect(result.status).toBe("healthy");
    expect(result.module).toBe("management");
    expect(result.checks.recurringCount).toBe(3);
    expect(result.checks.expenseCount).toBe(10);
  });
});
