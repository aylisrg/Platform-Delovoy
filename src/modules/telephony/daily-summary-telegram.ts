import { prisma } from "@/lib/db";
import { resolveStaffRouting } from "@/modules/notifications/audience";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import { getNovofonDataApiToken } from "./novofon-client";
import { buildDailySummaryPayload, dailySummaryDate, fetchDailySummary } from "./daily-summary-service";
import { TELEPHONY_DAILY_EVENT, telephonyDailySummarySchema, type TelephonyDailySummary } from "./daily-summary-types";

/**
 * Telegram copy of the daily call summary (catalog «Сводка звонков в Telegram»,
 * on by default for SUPERADMIN, opt-out in the Mini App Center).
 * ADR 2026-11-09-staff-booking-reports-digest: the owner did not see the
 * in-app card unless they opened the feed, so the same three aggregates also
 * go as a bot message. Only counts — no phone numbers, names or call ids.
 *
 * Idempotency: a `NotificationLog` claim per (day, person) with a fixed
 * primary key — the five-minute cron never queues a second message, and a
 * person without a delivery channel is not re-tried (and re-logged) all day.
 */

export const TELEPHONY_DAILY_TELEGRAM_EVENT = "telephony.daily_summary_telegram";

export function telegramSummaryClaimId(reportDate: string, userId: string): string {
  return `telephony-daily-tg:${reportDate}:${userId}`;
}

type Deps = { fetchImpl?: typeof fetch; token?: string };
export type TelegramSummaryResult = { reportDate: string | null; queued: number; skipped: number };

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru").replace(/\/$/, "");
}

/** Reuse the in-app snapshot when it exists: one provider request per day, same numbers. */
async function loadSummary(reportDate: string, now: Date, deps: Deps, token: string): Promise<TelephonyDailySummary> {
  const card = await prisma.inAppNotification.findFirst({
    where: { eventType: TELEPHONY_DAILY_EVENT, id: { startsWith: `telephony-daily:${reportDate}:` } },
    select: { payload: true },
  });
  const parsed = telephonyDailySummarySchema.safeParse((card?.payload as { telephonySummary?: unknown } | null)?.telephonySummary);
  if (parsed.success && parsed.data.reportDate === reportDate) return parsed.data;
  return fetchDailySummary(reportDate, now, { fetchImpl: deps.fetchImpl, token });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export async function processTelephonyTelegramSummaries(now = new Date(), deps: Deps = {}): Promise<TelegramSummaryResult> {
  const reportDate = dailySummaryDate(now);
  const result: TelegramSummaryResult = { reportDate, queued: 0, skipped: 0 };
  if (!reportDate) return result;
  const token = deps.token ?? getNovofonDataApiToken();
  if (!token) return result;

  const routing = await resolveStaffRouting({ eventType: TELEPHONY_DAILY_TELEGRAM_EVENT, moduleSlug: null });
  const ids = routing.recipients.map((r) => r.userId);
  if (ids.length === 0) return result;
  const claims = await prisma.notificationLog.findMany({
    where: { id: { in: ids.map((id) => telegramSummaryClaimId(reportDate, id)) } },
    select: { id: true },
  });
  const claimed = new Set(claims.map((c) => c.id));
  const pending = ids.filter((id) => !claimed.has(telegramSummaryClaimId(reportDate, id)));
  result.skipped = ids.length - pending.length;
  if (pending.length === 0) return result;

  // A provider failure throws before any claim — the next run retries.
  const { title, body } = buildDailySummaryPayload(await loadSummary(reportDate, now, deps, token));

  for (const userId of pending) {
    const claimId = telegramSummaryClaimId(reportDate, userId);
    try {
      await prisma.notificationLog.create({
        data: {
          id: claimId, userId, channel: "TELEGRAM", eventType: TELEPHONY_DAILY_TELEGRAM_EVENT, moduleSlug: "telephony",
          entityId: reportDate, recipient: "self", message: title, status: "PENDING",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) { result.skipped++; continue; }
      throw error;
    }
    // Recheck after the provider request: role or opt-out may have changed.
    const recheck = await resolveStaffRouting({ eventType: TELEPHONY_DAILY_TELEGRAM_EVENT, moduleSlug: null, userIds: [userId] });
    if (recheck.recipients.length === 0) {
      await prisma.notificationLog.update({ where: { id: claimId }, data: { status: "SKIPPED", error: "ACCESS_OR_SUBSCRIPTION_REVOKED" } });
      result.skipped++;
      continue;
    }
    const outcome = await dispatch({
      userId,
      eventType: TELEPHONY_DAILY_TELEGRAM_EVENT,
      entityType: "telephony",
      entityId: reportDate,
      payload: { title: `☎ ${title}`, body, actions: [{ label: "Открыть Mini App", url: `${appUrl()}/webapp` }] },
    });
    const handedOver = outcome.status === "queued" || outcome.status === "deferred";
    await prisma.notificationLog.update({
      where: { id: claimId },
      data: handedOver
        ? { status: "SENT", sentAt: new Date() }
        : { status: "SKIPPED", error: outcome.status === "skipped" ? outcome.reason : "NOT_QUEUED" },
    });
    if (handedOver) result.queued++;
    else result.skipped++;
  }
  return result;
}
