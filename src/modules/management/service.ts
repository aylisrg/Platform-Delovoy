import { prisma } from "@/lib/db";
import type { Prisma, ExpenseCategory, ExpenseFrequency } from "@prisma/client";
import type {
  CreateRecurringExpenseInput,
  UpdateRecurringExpenseInput,
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseFilter,
  RecurringFilter,
  ExpenseSummary,
  ProcessRecurringResult,
} from "./types";

// === HELPERS ===

const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

export function formatAutoExpenseName(
  templateName: string,
  billingDate: Date
): string {
  const month = MONTH_NAMES[billingDate.getMonth()];
  const year = billingDate.getFullYear();
  return `${templateName} — ${month} ${year}`;
}

export function advanceNextBillingDate(
  current: Date,
  frequency: ExpenseFrequency
): Date {
  const next = new Date(current);
  switch (frequency) {
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      break;
    case "YEARLY":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function getDefaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

// === RECURRING EXPENSES ===

export async function listRecurringExpenses(filter: RecurringFilter) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.RecurringExpenseWhereInput = {
    deletedAt: null,
  };

  if (filter.category) where.category = filter.category;
  if (filter.isActive !== undefined) where.isActive = filter.isActive;

  const [data, total] = await Promise.all([
    prisma.recurringExpense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.recurringExpense.count({ where }),
  ]);

  return { data, meta: { page, total } };
}

export async function createRecurringExpense(
  input: CreateRecurringExpenseInput,
  userId: string
) {
  const record = await prisma.recurringExpense.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      frequency: input.frequency,
      amount: input.amount,
      currency: input.currency ?? "RUB",
      startDate: startOfDay(input.startDate),
      nextBillingDate: startOfDay(input.nextBillingDate),
      createdById: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "recurring_expense.create",
      entity: "RecurringExpense",
      entityId: record.id,
      metadata: { name: record.name, amount: Number(record.amount) },
    },
  });

  return record;
}

export async function getRecurringExpense(id: string) {
  return prisma.recurringExpense.findFirst({
    where: { id, deletedAt: null },
  });
}

export async function updateRecurringExpense(
  id: string,
  input: UpdateRecurringExpenseInput,
  userId: string
) {
  const existing = await prisma.recurringExpense.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return null;

  const data: Prisma.RecurringExpenseUpdateInput = {};
  const changes: Record<string, { old: string | number | boolean | null; new: string | number | boolean | null }> = {};

  if (input.name !== undefined && input.name !== existing.name) {
    changes.name = { old: existing.name, new: input.name };
    data.name = input.name;
  }
  if (input.description !== undefined) {
    data.description = input.description;
  }
  if (input.category !== undefined && input.category !== existing.category) {
    changes.category = { old: existing.category, new: input.category };
    data.category = input.category;
  }
  if (input.frequency !== undefined && input.frequency !== existing.frequency) {
    changes.frequency = { old: existing.frequency, new: input.frequency };
    data.frequency = input.frequency;
  }
  if (
    input.amount !== undefined &&
    input.amount !== Number(existing.amount)
  ) {
    changes.amount = { old: Number(existing.amount), new: input.amount };
    data.amount = input.amount;
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.startDate !== undefined) {
    data.startDate = startOfDay(input.startDate);
  }
  if (input.nextBillingDate !== undefined) {
    data.nextBillingDate = startOfDay(input.nextBillingDate);
  }
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    changes.isActive = { old: existing.isActive, new: input.isActive };
    data.isActive = input.isActive;
  }

  const updated = await prisma.recurringExpense.update({
    where: { id },
    data,
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "recurring_expense.update",
      entity: "RecurringExpense",
      entityId: id,
      metadata: { changes } as Prisma.InputJsonValue,
    },
  });

  return updated;
}

export async function deleteRecurringExpense(id: string, userId: string) {
  const existing = await prisma.recurringExpense.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return null;

  const updated = await prisma.recurringExpense.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "recurring_expense.delete",
      entity: "RecurringExpense",
      entityId: id,
    },
  });

  return updated;
}

// === EXPENSES ===

export async function listExpenses(filter: ExpenseFilter) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const skip = (page - 1) * limit;

  const where: Prisma.ExpenseWhereInput = {
    deletedAt: null,
  };

  if (filter.category) where.category = filter.category;
  if (filter.isAutoGenerated !== undefined)
    where.isAutoGenerated = filter.isAutoGenerated;

  if (filter.from || filter.to) {
    where.date = {};
    if (filter.from) where.date.gte = startOfDay(filter.from);
    if (filter.to) where.date.lte = endOfDay(filter.to);
  }

  const [data, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      skip,
      take: limit,
    }),
    prisma.expense.count({ where }),
  ]);

  return { data, meta: { page, total } };
}

export async function createExpense(input: CreateExpenseInput, userId: string) {
  const record = await prisma.expense.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      amount: input.amount,
      currency: input.currency ?? "RUB",
      date: startOfDay(input.date),
      isAutoGenerated: false,
      createdById: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "expense.create",
      entity: "Expense",
      entityId: record.id,
      metadata: { name: record.name, amount: Number(record.amount) },
    },
  });

  return record;
}

export async function getExpense(id: string) {
  return prisma.expense.findFirst({
    where: { id, deletedAt: null },
  });
}

export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
  userId: string
): Promise<
  | { success: true; data: Awaited<ReturnType<typeof prisma.expense.update>> }
  | { success: false; code: string; message: string }
> {
  const existing = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return { success: false, code: "NOT_FOUND", message: "Расход не найден" };

  if (existing.isAutoGenerated) {
    return {
      success: false,
      code: "IMMUTABLE_AUTO_EXPENSE",
      message:
        "Автоматически созданные записи нельзя редактировать. Измените шаблон подписки.",
    };
  }

  const data: Prisma.ExpenseUpdateInput = {};
  const changes: Record<string, { old: string | number | boolean | null; new: string | number | boolean | null }> = {};

  if (input.name !== undefined && input.name !== existing.name) {
    changes.name = { old: existing.name, new: input.name };
    data.name = input.name;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined && input.category !== existing.category) {
    changes.category = { old: existing.category, new: input.category };
    data.category = input.category;
  }
  if (
    input.amount !== undefined &&
    input.amount !== Number(existing.amount)
  ) {
    changes.amount = { old: Number(existing.amount), new: input.amount };
    data.amount = input.amount;
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.date !== undefined) data.date = startOfDay(input.date);

  const updated = await prisma.expense.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "expense.update",
      entity: "Expense",
      entityId: id,
      metadata: { changes } as Prisma.InputJsonValue,
    },
  });

  return { success: true, data: updated };
}

export async function deleteExpense(
  id: string,
  userId: string
): Promise<
  | { success: true; data: { id: string; deletedAt: Date } }
  | { success: false; code: string; message: string }
> {
  const existing = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return { success: false, code: "NOT_FOUND", message: "Расход не найден" };

  if (existing.isAutoGenerated) {
    return {
      success: false,
      code: "IMMUTABLE_AUTO_EXPENSE",
      message: "Автоматически созданные записи нельзя удалять.",
    };
  }

  const now = new Date();
  await prisma.expense.update({
    where: { id },
    data: { deletedAt: now },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "expense.delete",
      entity: "Expense",
      entityId: id,
    },
  });

  return { success: true, data: { id, deletedAt: now } };
}

// === SUMMARY ===

export async function getSummary(
  query: { from?: string; to?: string }
): Promise<ExpenseSummary> {
  const period = {
    from: query.from ?? getDefaultPeriod().from,
    to: query.to ?? getDefaultPeriod().to,
  };

  const fromDate = startOfDay(period.from);
  const toDate = endOfDay(period.to);
  const now = new Date();

  // Total spent in period
  const expenses = await prisma.expense.findMany({
    where: {
      deletedAt: null,
      date: { gte: fromDate, lte: toDate },
    },
    select: { amount: true, category: true },
  });

  const totalSpent = expenses.reduce(
    (sum, e) => sum + Number(e.amount),
    0
  );

  const byCategory: Record<ExpenseCategory, string> = {
    IT_INFRASTRUCTURE: "0",
    ADVERTISING: "0",
    TELEPHONY: "0",
    OPERATIONS: "0",
  };

  for (const e of expenses) {
    byCategory[e.category] = String(
      Number(byCategory[e.category]) + Number(e.amount)
    );
  }

  // Upcoming recurring expenses (between now and end of period)
  const upcomingRecurring = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      nextBillingDate: {
        gt: now,
        lte: toDate,
      },
    },
    select: {
      id: true,
      name: true,
      amount: true,
      nextBillingDate: true,
      category: true,
    },
  });

  const totalUpcoming = upcomingRecurring.reduce(
    (sum, r) => sum + Number(r.amount),
    0
  );

  return {
    period,
    totalSpent: totalSpent.toFixed(2),
    byCategory,
    expenseCount: expenses.length,
    upcoming: {
      items: upcomingRecurring.map((r) => ({
        id: r.id,
        name: r.name,
        amount: String(r.amount),
        nextBillingDate: r.nextBillingDate.toISOString(),
        category: r.category,
      })),
      totalUpcoming: totalUpcoming.toFixed(2),
    },
    projectedTotal: (totalSpent + totalUpcoming).toFixed(2),
  };
}

// === PROCESS RECURRING (CRON) ===

export async function processRecurring(): Promise<ProcessRecurringResult> {
  const now = new Date();

  const dueTemplates = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      nextBillingDate: { lte: now },
    },
  });

  const result: ProcessRecurringResult = {
    processedAt: now.toISOString(),
    created: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  for (const template of dueTemplates) {
    try {
      const expenseName = formatAutoExpenseName(
        template.name,
        template.nextBillingDate
      );
      const nextDate = advanceNextBillingDate(
        template.nextBillingDate,
        template.frequency
      );

      const [expense] = await prisma.$transaction([
        prisma.expense.create({
          data: {
            name: expenseName,
            category: template.category,
            amount: template.amount,
            currency: template.currency,
            date: template.nextBillingDate,
            isAutoGenerated: true,
            recurringExpenseId: template.id,
            createdById: "system",
          },
        }),
        prisma.recurringExpense.update({
          where: { id: template.id },
          data: { nextBillingDate: nextDate },
        }),
      ]);

      result.created++;
      result.details.push({
        recurringId: template.id,
        expenseId: expense.id,
        name: expenseName,
      });
    } catch (err) {
      result.errors.push({
        recurringId: template.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  result.skipped = dueTemplates.length - result.created - result.errors.length;

  // Log to SystemEvent
  await prisma.systemEvent.create({
    data: {
      level: result.errors.length > 0 ? "WARNING" : "INFO",
      source: "cron/process-recurring",
      message: `Processed recurring expenses: ${result.created} created, ${result.errors.length} errors`,
      metadata: result as Prisma.InputJsonValue,
    },
  });

  return result;
}

// === HEALTH ===

export async function getHealth() {
  const [recurringCount, expenseCount] = await Promise.all([
    prisma.recurringExpense.count({ where: { deletedAt: null } }),
    prisma.expense.count({ where: { deletedAt: null } }),
  ]);

  return {
    status: "healthy",
    module: "management",
    checks: {
      database: true,
      recurringCount,
      expenseCount,
    },
    timestamp: new Date().toISOString(),
  };
}
