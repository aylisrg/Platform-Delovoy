import { prisma } from "@/lib/db";
import { telegramApi } from "@/lib/telegram/client";
import { computeBotStatus } from "@/modules/telegram-link/bot-contact";
import { getBusinessViewer } from "./business-access";
import { businessDay, getBusinessReport } from "./business-service";
import type { BusinessPreference, BusinessReport } from "./business-types";

export const BUSINESS_WEEKLY_EVENT = "analytics.business_weekly";
const BUSINESS_TEST_EVENT = "analytics.business_test";
const DAY_MS = 86_400_000;
const SCHEDULE = "Понедельник после 09:00 МСК, за предыдущие понедельник–воскресенье";
const PRIVATE_TELEGRAM_ID = /^[1-9]\d{0,19}$/;

export class BusinessReportError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "BusinessReportError";
  }
}

type DeliveryResult = { sent: boolean; status: string; messageId?: number };
type Viewer = NonNullable<Awaited<ReturnType<typeof getBusinessViewer>>>;

async function requireViewer(userId: string): Promise<Viewer> {
  const viewer = await getBusinessViewer(userId);
  if (!viewer) throw new BusinessReportError("FORBIDDEN", 403, "Нет доступа к бизнес-аналитике");
  return viewer;
}

async function telegramReady(viewer: Viewer): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !viewer.telegramId || !PRIVATE_TELEGRAM_ID.test(viewer.telegramId)) return false;
  const contact = await prisma.telegramBotContact.findUnique({ where: { telegramId: viewer.telegramId } });
  return computeBotStatus(viewer.telegramId, contact, null).state === "STARTED";
}

/** Monday marking the end of the last fully completed calendar week in Moscow. */
export function weeklyReportAnchor(now = new Date(), requireDue = true): Date | null {
  const local = new Date(now.getTime() + 3 * 3_600_000);
  const weekday = (local.getUTCDay() + 6) % 7;
  if (requireDue && weekday === 0 && local.getUTCHours() < 9) return null;
  const midnight = new Date(`${businessDay(now)}T00:00:00+03:00`);
  return new Date(midnight.getTime() - weekday * DAY_MS);
}

export async function getBusinessPreference(userId: string): Promise<BusinessPreference> {
  const viewer = await requireViewer(userId);
  const [preference, last, ready] = await Promise.all([
    prisma.notificationEventPreference.findUnique({ where: { userId_eventType: { userId, eventType: BUSINESS_WEEKLY_EVENT } } }),
    prisma.notificationLog.findFirst({
      where: { userId, eventType: { in: [BUSINESS_WEEKLY_EVENT, BUSINESS_TEST_EVENT] } },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true, sentAt: true },
    }),
    telegramReady(viewer),
  ]);
  return {
    enabled: preference?.enabled === true,
    timezone: "Europe/Moscow",
    schedule: SCHEDULE,
    telegramReady: ready,
    lastDelivery: last ? { status: last.status === "PENDING" ? "UNKNOWN" : last.status, createdAt: last.createdAt.toISOString(), sentAt: last.sentAt?.toISOString() ?? null } : null,
  };
}

export async function setBusinessPreference(userId: string, enabled: boolean): Promise<BusinessPreference> {
  const viewer = await requireViewer(userId);
  if (enabled && !await telegramReady(viewer)) {
    throw new BusinessReportError("TELEGRAM_NOT_READY", 409, "Привяжите личный Telegram и запустите бота");
  }
  await prisma.$transaction(async tx => {
    const data = { enabled, channelKinds: ["TELEGRAM" as const], timezone: "Europe/Moscow", updatedByUserId: userId, updatedVia: "miniapp" };
    await tx.notificationEventPreference.upsert({
      where: { userId_eventType: { userId, eventType: BUSINESS_WEEKLY_EVENT } },
      create: { userId, eventType: BUSINESS_WEEKLY_EVENT, ...data },
      update: data,
    });
    await tx.auditLog.create({ data: {
      userId, action: "analytics.business_subscription.updated", entity: "NotificationEventPreference", entityId: BUSINESS_WEEKLY_EVENT,
      metadata: { enabled, timezone: "Europe/Moscow" },
    } });
  });
  return getBusinessPreference(userId);
}

const currency = (value: number) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

/** No customer names/identifiers, advertising-office figures or unproven profit. */
export function buildBusinessReportMessage(report: BusinessReport, test = false): string {
  const difference = report.totals.net - report.previous.net;
  const lines = report.lines.map(line => `${line.label}: ${currency(line.net)} нетто · ${line.bookings || line.orders} ${line.slug === "cafe" ? "заказов" : "броней"}`);
  return [
    test ? "📊 ТЕСТ · Бизнес-аналитика Делового" : "📊 Бизнес-аналитика Делового",
    `${report.period.from} — ${report.period.to} · МСК`,
    "",
    `Учтённые поступления: ${currency(report.totals.receipts)}`,
    `Возвраты: ${currency(report.totals.refunds)}`,
    `Корректировки: ${currency(report.totals.adjustments)}`,
    `Нетто: ${currency(report.totals.net)}`,
    `К предыдущей неделе: ${difference > 0 ? "+" : ""}${currency(difference)}`,
    "",
    ...lines,
    "",
    "По финансовой книге; учёт частичный. Ручные абонементы, авансы и заказы без проводки могут отсутствовать. Офисы исключены. Это не прибыль и не вся выручка.",
    `Проверить записи: исключено ${report.quality.excludedLedgerRows}, дублей ${report.quality.duplicateLedgerRows}.`,
    `Сформировано: ${new Date(report.generatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`,
    test ? "Тест не включает недельную подписку. Управление — в Mini App." : "Подписку можно выключить в Mini App.",
  ].join("\n");
}

function existingResult(log: { status: string; message: string } | null): DeliveryResult {
  if (!log) return { sent: false, status: "UNKNOWN" };
  if (log.status !== "SENT") return { sent: false, status: log.status === "PENDING" ? "UNKNOWN" : log.status };
  // Only a provider message number is persisted, never the financial payload.
  const match = /^business-report receipt:(\d+)$/.exec(log.message);
  return { sent: true, status: "SENT", ...(match ? { messageId: Number(match[1]) } : {}) };
}

async function finishDelivery(id: string, userId: string, status: "SENT" | "FAILED" | "SKIPPED" | "PENDING", reason: string | null, messageId?: number): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.notificationLog.update({ where: { id }, data: {
      status, error: reason,
      ...(status === "SENT" ? { sentAt: new Date(), message: `business-report receipt:${messageId}` } : {}),
    } });
    await tx.auditLog.create({ data: {
      userId, action: "analytics.business_report.delivery", entity: "NotificationLog", entityId: id,
      metadata: { status, reason, ...(messageId ? { messageId } : {}) },
    } });
  });
}

async function deliver(userId: string, claimId: string, report: BusinessReport, test: boolean): Promise<DeliveryResult> {
  const eventType = test ? BUSINESS_TEST_EVENT : BUSINESS_WEEKLY_EVENT;
  try {
    await prisma.$transaction(async tx => {
      await tx.notificationLog.create({ data: {
        id: claimId, userId, channel: "TELEGRAM", eventType, moduleSlug: "analytics", entityId: report.period.to,
        recipient: "self", message: "business-report pending", status: "PENDING",
      } });
      await tx.auditLog.create({ data: {
        userId, action: "analytics.business_report.claimed", entity: "NotificationLog", entityId: claimId,
        metadata: { eventType, from: report.period.from, to: report.period.to },
      } });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return existingResult(await prisma.notificationLog.findUnique({ where: { id: claimId }, select: { status: true, message: true } }));
    }
    throw error;
  }

  // Last authorization check is after aggregation and durable claim. Neither a
  // stale role nor a pre-existing subscription is authority to send numbers.
  const viewer = await getBusinessViewer(userId);
  const preference = test ? null : await prisma.notificationEventPreference.findUnique({ where: { userId_eventType: { userId, eventType: BUSINESS_WEEKLY_EVENT } } });
  if (!viewer || (!test && preference?.enabled !== true)) {
    await finishDelivery(claimId, userId, "SKIPPED", "ACCESS_OR_SUBSCRIPTION_REVOKED");
    return { sent: false, status: "SKIPPED" };
  }
  if (!await telegramReady(viewer)) {
    await finishDelivery(claimId, userId, "SKIPPED", "TELEGRAM_NOT_READY");
    return { sent: false, status: "TELEGRAM_NOT_READY" };
  }
  // Links lead to an authenticated page, never to public report attachments.
  const reportUrl = `https://delovoy-park.ru/admin/analytics/business?period=7d&weekEnding=${report.period.to}`;
  const result = await telegramApi<{ message_id?: number }>("sendMessage", {
    chat_id: viewer.telegramId,
    text: buildBusinessReportMessage(report, test),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [
      [{ text: "Открыть визуальный отчёт", url: reportUrl }],
      [{ text: "Недельная подписка", web_app: { url: "https://delovoy-park.ru/webapp/business-analytics" } }],
    ] },
  }, { allowFallback: false });
  const messageId = result.ok ? result.result?.message_id : undefined;
  const confirmed = typeof messageId === "number" && Number.isSafeInteger(messageId) && messageId > 0;
  // A timeout or malformed 2xx response may have delivered. Keeping the claim
  // PENDING prevents automatic retries, including retry with the same test id.
  const status = confirmed ? "SENT" : result.ok || result.transportError || (result.status ?? 0) >= 500 ? "PENDING" : "FAILED";
  try {
    await finishDelivery(claimId, userId, status, status === "PENDING" ? "DELIVERY_UNKNOWN" : status === "FAILED" ? "TELEGRAM_REJECTED" : null, messageId);
  } catch {
    // The durable claim already exists; never re-send after a receipt-save error.
    return { sent: confirmed, status: confirmed ? "SENT_LOG_PENDING" : "UNKNOWN", ...(confirmed ? { messageId } : {}) };
  }
  return { sent: confirmed, status: status === "PENDING" ? "UNKNOWN" : status, ...(confirmed ? { messageId } : {}) };
}

export async function sendBusinessTest(userId: string, requestId: string): Promise<DeliveryResult> {
  const viewer = await requireViewer(userId);
  if (!await telegramReady(viewer)) throw new BusinessReportError("TELEGRAM_NOT_READY", 409, "Привяжите личный Telegram и запустите бота");
  const claimId = `business-test:${userId}:${requestId}`;
  const existing = await prisma.notificationLog.findUnique({ where: { id: claimId }, select: { status: true, message: true } });
  if (existing) return existingResult(existing);
  const anchor = weeklyReportAnchor(new Date(), false)!;
  const report = { ...await getBusinessReport("7d", anchor, false), generatedAt: new Date().toISOString() };
  return deliver(userId, claimId, report, true);
}

/** Called by the existing five-minute notification cron; no new credentials. */
export async function processWeeklyBusinessReports(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const anchor = weeklyReportAnchor(now);
  if (!anchor || !process.env.TELEGRAM_BOT_TOKEN) return counts;
  const weekEnding = businessDay(new Date(anchor.getTime() - 1));
  const preferences = await prisma.notificationEventPreference.findMany({ where: { eventType: BUSINESS_WEEKLY_EVENT, enabled: true }, select: { userId: true } });
  let report: BusinessReport | null = null;
  for (const preference of preferences) {
    try {
      const userId = preference.userId;
      const claimId = `business-weekly:${userId}:${weekEnding}`;
      if (await prisma.notificationLog.findUnique({ where: { id: claimId }, select: { id: true } })) { counts.skipped++; continue; }
      const viewer = await getBusinessViewer(userId);
      if (!viewer || !await telegramReady(viewer)) { counts.skipped++; continue; }
      report ??= { ...await getBusinessReport("7d", anchor, false), generatedAt: now.toISOString() };
      const result = await deliver(userId, claimId, report, false);
      if (result.sent) counts.sent++;
      else if (result.status === "SKIPPED" || result.status === "TELEGRAM_NOT_READY") counts.skipped++;
      else counts.failed++;
    } catch {
      // Do not log business payload, account id or provider response. Another
      // scheduler pass can retry only if no durable claim was committed.
      counts.failed++;
    }
  }
  return counts;
}
