import { z } from "zod";
import { prisma } from "@/lib/db";
import { getNovofonDataApiToken } from "./novofon-client";
import { fetchCallsReportPage, formatNovofonDate, MAX_OFFSET, NovofonApiError, PAGE_LIMIT, parseNovofonDate } from "./calls-sync";
import { TELEPHONY_DAILY_EVENT, TELEPHONY_DAILY_HOUR_MSK, type TelephonyDailyPayload, type TelephonyDailySummary } from "./daily-summary-types";
import { resolveStaffRouting } from "@/modules/notifications/audience";

const DAY_MS = 86_400_000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAILY_REPORT_TIMEOUT_MS = 45_000;

// This report requests all of these fields; omitted/broken outcome fields must
// not turn an upstream failure into a convincing zero/missed-call summary.
const reportRowSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().nonnegative()]),
  start_time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  direction: z.enum(["in", "out"]),
  is_lost: z.boolean(),
  talk_duration: z.number().finite().nonnegative().nullish(),
});

type ReportDeps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; token?: string };

/** Stable DB primary key, independent of text changes and provider late updates. */
export function dailySummaryId(reportDate: string, userId: string): string {
  return `telephony-daily:${reportDate}:${userId}`;
}

/** Completed Moscow calendar day, released after 09:00 Moscow time. */
export function dailySummaryDate(now: Date): string | null {
  const local = new Date(now.getTime() + MSK_OFFSET_MS);
  if (local.getUTCHours() < TELEPHONY_DAILY_HOUR_MSK) return null;
  return new Date(local.getTime() - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Fetch a complete provider report for one completed day. The shared signal
 * bounds the whole paginated request; exceeding provider pagination is fatal.
 * No raw row is persisted or returned; only verified aggregates leave here.
 */
export async function fetchDailySummary(
  reportDate: string,
  now: Date,
  deps: ReportDeps = {},
): Promise<TelephonyDailySummary> {
  const parsedDate = z.iso.date().safeParse(reportDate);
  const todayMsk = new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
  if (!parsedDate.success || reportDate >= todayMsk) {
    throw new NovofonApiError("invalid_date", "Report date must be a completed calendar day");
  }
  const token = deps.token ?? getNovofonDataApiToken();
  if (!token) throw new NovofonApiError("not_configured", "Novofon report is not configured");
  const from = new Date(`${reportDate}T00:00:00+03:00`);
  const end = new Date(from.getTime() + DAY_MS);
  // Novofon date_till is inclusive and has second precision.
  const till = new Date(end.getTime() - 1000);
  const signal = AbortSignal.timeout(DAILY_REPORT_TIMEOUT_MS);
  const fetchImpl: typeof fetch = (input, init) => (deps.fetchImpl ?? fetch)(input, { ...init, signal });
  const ids = new Set<string>();
  const summary: TelephonyDailySummary = {
    reportDate, timeZone: "Europe/Moscow", generatedAt: now.toISOString(),
    total: 0, inbound: 0, answered: 0, missed: 0, outbound: 0, pending: 0, answerRate: null,
  };

  for (let offset = 0; ; offset += PAGE_LIMIT) {
    if (offset > MAX_OFFSET) throw new NovofonApiError("truncated", "Novofon report exceeded pagination limit");
    signal.throwIfAborted();
    const rows = await fetchCallsReportPage({ token, from, till, offset, limit: PAGE_LIMIT }, { fetchImpl, sleep: deps.sleep });
    if (rows.length > PAGE_LIMIT) throw new NovofonApiError("invalid_response", "Invalid Novofon page size");
    for (const raw of rows) {
      const parsed = reportRowSchema.safeParse(raw);
      if (!parsed.success) throw new NovofonApiError("invalid_response", "Invalid Novofon call row");
      const row = parsed.data;
      const startedAt = parseNovofonDate(row.start_time);
      if (startedAt < from || startedAt >= end || formatNovofonDate(startedAt) !== row.start_time || ids.has(String(row.id))) {
        throw new NovofonApiError("invalid_response", "Inconsistent Novofon report window");
      }
      ids.add(String(row.id));
      summary.total++;
      if (row.direction === "out") summary.outbound++;
      else {
        summary.inbound++;
        if (row.is_lost) summary.missed++;
        else if ((row.talk_duration ?? 0) > 0) summary.answered++;
        else summary.pending++;
      }
    }
    if (rows.length < PAGE_LIMIT) break;
  }
  const known = summary.answered + summary.missed;
  summary.answerRate = known ? Math.round(summary.answered / known * 1000) / 10 : null;
  return summary;
}

export function buildDailySummaryPayload(summary: TelephonyDailySummary): TelephonyDailyPayload {
  const [year, month, day] = summary.reportDate.split("-");
  return {
    title: `Звонки за ${day}.${month}.${year}`,
    body: summary.total === 0
      ? "По отчёту Novofon за этот день звонков не было."
      : `Всего — ${summary.total}. Принято входящих — ${summary.answered}. Пропущено входящих — ${summary.missed}.${summary.pending ? ` Уточняется — ${summary.pending}.` : ""}`,
    telephonySummary: summary,
  };
}

type ProcessResult = { reportDate: string | null; created: number; skipped: number; reason?: "not_configured" };

/** Existing scheduler calls this every five minutes; it never sends externally. */
export async function processTelephonyDailySummaries(
  now = new Date(),
  deps: ReportDeps = {},
): Promise<ProcessResult> {
  const reportDate = dailySummaryDate(now);
  if (!reportDate) return { reportDate: null, created: 0, skipped: 0 };
  const token = deps.token ?? getNovofonDataApiToken();
  if (!token) return { reportDate, created: 0, skipped: 0, reason: "not_configured" };

  // The user explicitly requested daily summaries: owners are subscribed by
  // default; a persisted per-event opt-out wins. A demoted/merged user is out.
  // Same resolver the screens use (ADR 2026-10-25-team-access-notifications §Q7).
  const routing = await resolveStaffRouting({ eventType: TELEPHONY_DAILY_EVENT, moduleSlug: null });
  const recipients = routing.recipients.map(({ userId }) => ({ id: userId }));
  if (!recipients.length) return { reportDate, created: 0, skipped: 0 };
  const existing = await prisma.inAppNotification.findMany({
    where: { id: { in: recipients.map(({ id }) => dailySummaryId(reportDate, id)) } },
    select: { id: true },
  });
  const claimed = new Set(existing.map(({ id }) => id));
  const pending = recipients.filter(({ id }) => !claimed.has(dailySummaryId(reportDate, id)));
  if (!pending.length) return { reportDate, created: 0, skipped: recipients.length };

  // Complete the report before any INSERT. Malformed/partial/provider errors
  // leave no marker and are retried by the next normal scheduler invocation.
  const payload = buildDailySummaryPayload(await fetchDailySummary(reportDate, now, { ...deps, token }));
  let created = 0;
  let skipped = existing.length;
  for (const recipient of pending) {
    const id = dailySummaryId(reportDate, recipient.id);
    try {
      const inserted = await prisma.$transaction(async (tx) => {
        // Recheck after the network request: role or opt-out may have changed.
        const recheck = await resolveStaffRouting(
          { eventType: TELEPHONY_DAILY_EVENT, moduleSlug: null, userIds: [recipient.id] },
          tx,
        );
        if (recheck.recipients.length === 0) return false;
        await tx.inAppNotification.create({
          data: { id, userId: recipient.id, eventType: TELEPHONY_DAILY_EVENT, payload },
        });
        await tx.auditLog.create({
          data: {
            userId: recipient.id, action: "telephony.daily_summary.created", entity: "InAppNotification", entityId: id,
            metadata: { reportDate, total: payload.telephonySummary.total },
          },
        });
        return true;
      });
      if (inserted) created++;
      else skipped++;
    } catch (error) {
      // The primary key handles simultaneous schedulers and retries forever,
      // unlike the dispatcher's five-minute best-effort deduplication window.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") skipped++;
      else throw error;
    }
  }
  return { reportDate, created, skipped };
}
