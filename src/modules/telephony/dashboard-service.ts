import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getNovofonDataApiToken } from "./novofon-client";
import type { TelephonyDashboardQuery } from "./dashboard-validation";
import type { TelephonyDashboard, TelephonyDayStats } from "./dashboard-types";

const DAY_MS = 86_400_000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
export const TELEPHONY_PAGE_SIZE = 25;

type AggregateDay = {
  date: string;
  total: bigint | number;
  inbound: bigint | number;
  answered: bigint | number;
  missed: bigint | number;
  outbound: bigint | number;
  pending: bigint | number;
  talkSeconds: bigint | number;
  talkCount: bigint | number;
};

/** The dashboard never exposes a contact number, including for SUPERADMIN. */
export function maskJournalPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•••";
  return `••• ••• ${digits.slice(-4, -2)} ${digits.slice(-2)}`;
}

function emptyDay(date: string): TelephonyDayStats {
  return { date, total: 0, inbound: 0, answered: 0, missed: 0, outbound: 0, pending: 0 };
}

/** Read the provider journal only: CallLog contains overlapping platform calls. */
export async function getTelephonyDashboard(
  query: TelephonyDashboardQuery,
  now = new Date(),
): Promise<TelephonyDashboard> {
  const days = query.period === "today" ? 1 : query.period === "7d" ? 7 : 30;
  const today = new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
  const firstDay = new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * DAY_MS;
  const dateFrom = new Date(firstDay).toISOString().slice(0, 10);
  const from = new Date(`${dateFrom}T00:00:00+03:00`);
  const till = new Date(new Date(`${today}T00:00:00+03:00`).getTime() + DAY_MS);
  const periodWhere: Prisma.NovofonCallWhereInput = { startedAt: { gte: from, lt: till } };
  const filters: Record<TelephonyDashboardQuery["filter"], Prisma.NovofonCallWhereInput> = {
    all: {},
    inbound: { direction: "INBOUND" },
    answered: { direction: "INBOUND", isLost: false, talkDuration: { gt: 0 } },
    missed: { direction: "INBOUND", isLost: true },
    outbound: { direction: "OUTBOUND" },
  };
  const where = { ...periodWhere, ...filters[query.filter] };

  const [aggregates, calls, total, latestCall, latestUpdate] = await Promise.all([
    // PostgreSQL DateTime columns hold UTC timestamps without a timezone.
    // The +03 offset matches the Novofon account used by calls-sync.ts.
    prisma.$queryRaw<AggregateDay[]>(Prisma.sql`
      SELECT to_char("startedAt" + interval '3 hours', 'YYYY-MM-DD') AS date,
        count(*) AS total,
        count(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
        count(*) FILTER (WHERE direction = 'INBOUND' AND NOT "isLost" AND "talkDuration" > 0) AS answered,
        count(*) FILTER (WHERE direction = 'INBOUND' AND "isLost") AS missed,
        count(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound,
        count(*) FILTER (WHERE direction = 'INBOUND' AND NOT "isLost" AND ("talkDuration" IS NULL OR "talkDuration" <= 0)) AS pending,
        coalesce(sum("talkDuration") FILTER (WHERE "talkDuration" > 0), 0) AS "talkSeconds",
        count(*) FILTER (WHERE "talkDuration" > 0) AS "talkCount"
      FROM "NovofonCall"
      WHERE "startedAt" >= ${from} AND "startedAt" < ${till}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.novofonCall.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * TELEPHONY_PAGE_SIZE,
      take: TELEPHONY_PAGE_SIZE,
      select: {
        id: true, startedAt: true, direction: true, isLost: true,
        contactPhone: true, employeeName: true, talkDuration: true, waitDuration: true,
      },
    }),
    prisma.novofonCall.count({ where }),
    prisma.novofonCall.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.novofonCall.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);

  const byDate = new Map(aggregates.map((row) => [row.date, row]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDay + index * DAY_MS).toISOString().slice(0, 10);
    const row = byDate.get(date);
    return row ? {
      date, total: Number(row.total), inbound: Number(row.inbound), answered: Number(row.answered),
      missed: Number(row.missed), outbound: Number(row.outbound), pending: Number(row.pending),
    } : emptyDay(date);
  });
  const totals = daily.reduce((sum, day) => ({
    total: sum.total + day.total,
    inbound: sum.inbound + day.inbound,
    answered: sum.answered + day.answered,
    missed: sum.missed + day.missed,
    outbound: sum.outbound + day.outbound,
    pending: sum.pending + day.pending,
  }), { total: 0, inbound: 0, answered: 0, missed: 0, outbound: 0, pending: 0 });
  const knownInbound = totals.answered + totals.missed;
  const talkSeconds = aggregates.reduce((sum, day) => sum + Number(day.talkSeconds), 0);
  const talkCount = aggregates.reduce((sum, day) => sum + Number(day.talkCount), 0);

  return {
    period: query.period, dateFrom, dateTo: today, timeZone: "Europe/Moscow",
    summary: {
      ...totals,
      answerRate: knownInbound ? Math.round(totals.answered / knownInbound * 1000) / 10 : null,
      avgTalkSeconds: talkCount ? Math.round(talkSeconds / talkCount) : null,
    },
    daily,
    calls: calls.map((call) => ({
      id: call.id,
      startedAt: call.startedAt.toISOString(),
      direction: call.direction,
      outcome: call.direction === "OUTBOUND" ? "outbound"
        : call.isLost ? "missed" : (call.talkDuration ?? 0) > 0 ? "answered" : "pending",
      maskedPhone: maskJournalPhone(call.contactPhone),
      employeeName: call.employeeName,
      talkDuration: call.talkDuration,
      waitDuration: call.waitDuration,
      isLost: call.isLost,
    })),
    pagination: { page: query.page, perPage: TELEPHONY_PAGE_SIZE, total, totalPages: Math.ceil(total / TELEPHONY_PAGE_SIZE) },
    source: {
      dataApiConfigured: Boolean(getNovofonDataApiToken()),
      webhookConfigured: Boolean(process.env.NOVOFON_WEBHOOK_TOKEN || process.env.NOVOFON_WEBHOOK_SECRET),
      lastCallAt: latestCall?.startedAt.toISOString() ?? null,
      lastJournalUpdate: latestUpdate?.updatedAt.toISOString() ?? null,
    },
  };
}
