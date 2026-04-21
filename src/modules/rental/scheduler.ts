import { prisma } from "@/lib/db";
import { sendTelegramAlert } from "@/lib/telegram-alert";
import { getOrCreateSettings, logEmail, sendAutoReminder } from "./notifications";
import type { PaymentWithContract } from "./notifications";
import { formatDateRu, formatMoney } from "./template-engine";

export type ReminderStats = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type EscalationStats = {
  scanned: number;
  tasksCreated: number;
  telegramSent: number;
  failed: number;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
  );
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

async function logSystemEvent(level: "INFO" | "WARNING" | "ERROR", message: string, metadata?: unknown) {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        source: "rental.scheduler",
        message,
        metadata: metadata ? (metadata as object) : undefined,
      },
    });
  } catch (err) {
    console.warn("[rental/scheduler] failed to log system event:", err);
  }
}

/**
 * T-N: send pre-reminder for payments whose dueDate falls within the next preReminderDays.
 * Idempotent via `firstReminderSentAt IS NULL` filter.
 */
export async function sendPreReminders(
  preReminderDays: number,
  now: Date = new Date()
): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
  const today = startOfUtcDay(now);
  const target = endOfUtcDay(addDays(today, preReminderDays));

  const payments = (await prisma.rentalPayment.findMany({
    where: {
      paidAt: null,
      firstReminderSentAt: null,
      dueDate: { gte: today, lte: target },
      contract: { status: { in: ["ACTIVE", "EXPIRING"] } },
    },
    include: {
      contract: { include: { tenant: true, office: true } },
    },
  })) as PaymentWithContract[];

  stats.scanned = payments.length;
  const settings = await getOrCreateSettings();

  for (const payment of payments) {
    try {
      const anySuccess = await sendAutoReminder({
        payment,
        templateKey: "rental.payment_reminder_pre",
        type: "PAYMENT_PRE_REMINDER",
        settings,
      });
      if (anySuccess) {
        await prisma.rentalPayment.update({
          where: { id: payment.id },
          data: { firstReminderSentAt: new Date() },
        });
        stats.sent++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.failed++;
      await logSystemEvent("ERROR", "pre-reminder failed", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return stats;
}

/**
 * T=0: send due-date reminder on the day of payment for still-unpaid payments.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
  const today = startOfUtcDay(now);
  const tomorrow = endOfUtcDay(today);

  const payments = (await prisma.rentalPayment.findMany({
    where: {
      paidAt: null,
      dueDateReminderSentAt: null,
      dueDate: { gte: today, lte: tomorrow },
      contract: { status: { in: ["ACTIVE", "EXPIRING"] } },
    },
    include: { contract: { include: { tenant: true, office: true } } },
  })) as PaymentWithContract[];

  stats.scanned = payments.length;
  const settings = await getOrCreateSettings();

  for (const payment of payments) {
    try {
      const anySuccess = await sendAutoReminder({
        payment,
        templateKey: "rental.payment_reminder_due",
        type: "PAYMENT_DUE_REMINDER",
        settings,
      });
      if (anySuccess) {
        await prisma.rentalPayment.update({
          where: { id: payment.id },
          data: { dueDateReminderSentAt: new Date() },
        });
        stats.sent++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.failed++;
      await logSystemEvent("ERROR", "due-reminder failed", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return stats;
}

/**
 * T+M: for payments overdue by M+ days, create a ManagerTask + Telegram alert.
 * Idempotent via the ManagerTask @@unique([type, contractId, periodYear, periodMonth]).
 */
export async function escalateOverdue(
  escalationDaysAfter: number,
  now: Date = new Date()
): Promise<EscalationStats> {
  const stats: EscalationStats = { scanned: 0, tasksCreated: 0, telegramSent: 0, failed: 0 };
  const today = startOfUtcDay(now);
  const threshold = addDays(today, -escalationDaysAfter);

  const payments = (await prisma.rentalPayment.findMany({
    where: {
      paidAt: null,
      escalatedAt: null,
      dueDate: { lte: threshold },
      contract: { status: { in: ["ACTIVE", "EXPIRING"] } },
    },
    include: { contract: { include: { tenant: true, office: true } } },
  })) as PaymentWithContract[];

  stats.scanned = payments.length;
  const settings = await getOrCreateSettings();

  for (const payment of payments) {
    try {
      const overdueDays = Math.max(
        0,
        Math.floor((today.getTime() - payment.dueDate.getTime()) / (24 * 60 * 60 * 1000))
      );

      const title = `Просрочка: ${payment.contract.tenant.companyName}, офис №${payment.contract.office.number}, ${overdueDays} дн.`;
      const description = [
        `Арендатор: ${payment.contract.tenant.companyName}`,
        payment.contract.tenant.contactName
          ? `Контакт: ${payment.contract.tenant.contactName}`
          : null,
        payment.contract.tenant.phone ? `Телефон: ${payment.contract.tenant.phone}` : null,
        `Офис: №${payment.contract.office.number} (корп. ${payment.contract.office.building}, этаж ${payment.contract.office.floor})`,
        `Договор: №${payment.contract.contractNumber ?? "б/н"}`,
        `Срок: ${formatDateRu(payment.dueDate)} (${overdueDays} дн. просрочки)`,
        `Сумма: ${formatMoney(Number(payment.amount), payment.currency)}`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await prisma.managerTask.create({
          data: {
            type: "OVERDUE_PAYMENT",
            moduleSlug: "rental",
            status: "OPEN",
            title,
            description,
            contractId: payment.contractId,
            tenantId: payment.contract.tenantId,
            paymentId: payment.id,
            periodYear: payment.periodYear,
            periodMonth: payment.periodMonth,
            dueDate: new Date(),
          },
        });
        stats.tasksCreated++;
      } catch (err: unknown) {
        // P2002 = unique constraint (task already exists)
        if (isUniqueViolation(err)) {
          // task already created — still mark escalatedAt below
        } else {
          throw err;
        }
      }

      if (settings.escalationTelegramEnabled) {
        const chatId =
          settings.escalationTelegramChatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          const alertMessage = [
            `🚨 <b>Просрочка оплаты аренды</b>`,
            ``,
            `Арендатор: <b>${escapeHtml(payment.contract.tenant.companyName)}</b>`,
            `Офис: №${escapeHtml(payment.contract.office.number)} (корп. ${payment.contract.office.building}, эт. ${payment.contract.office.floor})`,
            `Срок: ${formatDateRu(payment.dueDate)} (<b>${overdueDays} дн. просрочки</b>)`,
            `Сумма: ${escapeHtml(formatMoney(Number(payment.amount), payment.currency))}`,
            ``,
            `<i>Менеджеру: дойти ногами и забрать оплату.</i>`,
          ].join("\n");
          const ok = await sendTelegramAlert(alertMessage, { chatId });
          if (ok) stats.telegramSent++;
        }
      }

      await logSystemEvent("WARNING", "rental.payment.overdue", {
        contractId: payment.contractId,
        paymentId: payment.id,
        overdueDays,
      });

      await logEmail({
        type: "ESCALATION_INTERNAL",
        to: [],
        subject: title,
        tenantId: payment.contract.tenantId,
        contractId: payment.contractId,
        paymentId: payment.id,
        periodYear: payment.periodYear,
        periodMonth: payment.periodMonth,
        status: "SENT",
      });

      await prisma.rentalPayment.update({
        where: { id: payment.id },
        data: { escalatedAt: new Date() },
      });
    } catch (err) {
      stats.failed++;
      await logSystemEvent("ERROR", "escalation failed", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return stats;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type RunReport = {
  skipped?: string;
  pre?: ReminderStats;
  due?: ReminderStats;
  escalate?: EscalationStats;
};

export async function runRentalPaymentReminders(now: Date = new Date()): Promise<RunReport> {
  const settings = await getOrCreateSettings();
  if (!settings.autoSendEnabled) {
    return { skipped: "auto-send disabled" };
  }
  const [pre, due, escalate] = await Promise.all([
    sendPreReminders(settings.preReminderDays, now),
    sendDueReminders(now),
    escalateOverdue(settings.escalationDaysAfter, now),
  ]);
  return { pre, due, escalate };
}
