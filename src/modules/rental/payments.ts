import { prisma } from "@/lib/db";
import type { Prisma, RentalContract } from "@prisma/client";

/**
 * Build the list of scheduled payments for a contract.
 * Due date = 1st of each month the contract covers, starting with contract.startDate month,
 * ending at (but not including) contract.endDate month after endDate's 1st.
 */
export function buildPaymentSchedule(contract: {
  id: string;
  startDate: Date;
  endDate: Date;
  monthlyRate: Prisma.Decimal | number | string;
  currency?: string;
}): Array<{
  contractId: string;
  periodYear: number;
  periodMonth: number;
  dueDate: Date;
  amount: Prisma.Decimal | number | string;
  currency: string;
}> {
  const schedule: ReturnType<typeof buildPaymentSchedule> = [];
  const end = new Date(
    Date.UTC(contract.endDate.getUTCFullYear(), contract.endDate.getUTCMonth(), 1)
  );
  let cursorYear = contract.startDate.getUTCFullYear();
  let cursorMonth = contract.startDate.getUTCMonth(); // 0..11

  // Hard cap to prevent infinite loop on malformed data (10 years of monthly payments).
  for (let i = 0; i < 120; i++) {
    const dueDate = new Date(Date.UTC(cursorYear, cursorMonth, 1));
    if (dueDate > end) break;
    schedule.push({
      contractId: contract.id,
      periodYear: cursorYear,
      periodMonth: cursorMonth + 1,
      dueDate,
      amount: contract.monthlyRate,
      currency: contract.currency ?? "RUB",
    });
    cursorMonth++;
    if (cursorMonth > 11) {
      cursorMonth = 0;
      cursorYear++;
    }
  }
  return schedule;
}

/**
 * Generate payment rows for the entire contract period.
 * Idempotent: @@unique([contractId, periodYear, periodMonth]) + skipDuplicates.
 */
export async function generatePaymentsForContract(contract: {
  id: string;
  startDate: Date;
  endDate: Date;
  monthlyRate: Prisma.Decimal | number | string;
  currency?: string;
}): Promise<number> {
  const schedule = buildPaymentSchedule(contract);
  if (schedule.length === 0) return 0;
  const result = await prisma.rentalPayment.createMany({
    data: schedule,
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Regenerate only PENDING (paidAt=null) future payments.
 * Paid and past-due payments are left alone to preserve history.
 */
export async function regeneratePendingPayments(
  contractId: string,
  now: Date = new Date()
): Promise<{ deleted: number; created: number }> {
  const contract = await prisma.rentalContract.findUnique({ where: { id: contractId } });
  if (!contract) return { deleted: 0, created: 0 };

  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const del = await prisma.rentalPayment.deleteMany({
    where: {
      contractId,
      paidAt: null,
      dueDate: { gte: cutoff },
    },
  });

  const created = await generatePaymentsForContract(contract);
  return { deleted: del.count, created };
}

/**
 * Mark a payment as paid (or unpaid). Records audit via RentalChangeLog
 * is left to the caller — we only change the row here.
 */
export async function markPaymentPaid(params: {
  paymentId: string;
  userId: string;
  paidAt: Date | null;
}): Promise<void> {
  await prisma.rentalPayment.update({
    where: { id: params.paymentId },
    data: {
      paidAt: params.paidAt,
      markedPaidById: params.paidAt ? params.userId : null,
    },
  });
}

/**
 * When a contract is terminated, any OPEN manager tasks referencing it
 * should auto-resolve (no point in chasing a terminated tenant for payment).
 */
export async function autoResolveTasksForContract(
  contractId: string,
  resolvedById: string | null = null
): Promise<number> {
  const res = await prisma.managerTask.updateMany({
    where: {
      contractId,
      status: "OPEN",
      type: "OVERDUE_PAYMENT",
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedById,
      resolution: "CONTRACT_TERMINATING",
      resolutionNote: "Авто-закрыто: договор расторгнут/истёк",
    },
  });
  return res.count;
}

export type PaymentStatusFilter = "paid" | "unpaid" | "all";

export async function listPaymentsForContract(
  contractId: string,
  filter: { year?: number; status?: PaymentStatusFilter } = {}
): Promise<import("@prisma/client").RentalPayment[]> {
  return prisma.rentalPayment.findMany({
    where: {
      contractId,
      ...(filter.year !== undefined ? { periodYear: filter.year } : {}),
      ...(filter.status === "paid"
        ? { paidAt: { not: null } }
        : filter.status === "unpaid"
          ? { paidAt: null }
          : {}),
    },
    orderBy: [{ dueDate: "desc" }],
  });
}

/**
 * Upcoming unpaid payments within N days.
 * Used for the "Awaiting payment" dashboard widget.
 */
export async function listUpcomingPayments(withinDays = 7) {
  const now = new Date();
  const until = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  return prisma.rentalPayment.findMany({
    where: {
      paidAt: null,
      dueDate: { lte: until },
      contract: { status: { in: ["ACTIVE", "EXPIRING"] } },
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, companyName: true, contactName: true, email: true } },
          office: { select: { id: true, number: true, building: true, floor: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 100,
  });
}

export type ContractForPayments = Pick<
  RentalContract,
  "id" | "startDate" | "endDate" | "monthlyRate" | "currency" | "status"
>;
