/**
 * Чистая агрегация для scripts/outgoing-stats.ts (#708, #917).
 * Только счётчики: никаких payload, адресов, userId, имён.
 * dedupKey наружу выходит только как короткий sha256-хэш.
 */
import { createHash } from "node:crypto";

/** Дубай без перехода на летнее время: всегда UTC+4. */
export const DUBAI_OFFSET_MIN = 4 * 60;

export type StatsRow = {
  status: string;
  eventType: string;
  channelKind: string;
  dedupKey: string;
  createdAt: Date;
};

export type HourBucket = {
  hour: string; // "00".."23" по Дубаю
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byEventType: Record<string, number>;
};

export type DupEntry = { keyHash: string; eventType: string; sentCount: number };

export type OutgoingStats = {
  date: string;
  fromUtc: string;
  toUtc: string;
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byEventType: Record<string, number>;
  hours: HourBucket[];
  duplicates: { keysWithMultipleSent: number; extraSentRows: number; top: DupEntry[] };
};

/** Границы суток по Дубаю в UTC: [from, to). */
export function dubaiDayRange(date: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date: ожидается YYYY-MM-DD");
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(midnightUtc)) throw new Error("--date: неверная дата");
  const from = new Date(midnightUtc - DUBAI_OFFSET_MIN * 60_000);
  return { from, to: new Date(from.getTime() + 24 * 3_600_000) };
}

export function dubaiHour(d: Date): string {
  const h = new Date(d.getTime() + DUBAI_OFFSET_MIN * 60_000).getUTCHours();
  return String(h).padStart(2, "0");
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function inc(m: Record<string, number>, k: string) {
  m[k] = (m[k] ?? 0) + 1;
}

export function aggregate(rows: Iterable<StatsRow>, date: string, topN = 20): OutgoingStats {
  const { from, to } = dubaiDayRange(date);
  const hours: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({
    hour: String(i).padStart(2, "0"),
    total: 0,
    byStatus: {},
    byChannel: {},
    byEventType: {},
  }));
  const s: OutgoingStats = {
    date,
    fromUtc: from.toISOString(),
    toUtc: to.toISOString(),
    total: 0,
    byStatus: {},
    byChannel: {},
    byEventType: {},
    hours,
    duplicates: { keysWithMultipleSent: 0, extraSentRows: 0, top: [] },
  };
  const sent = new Map<string, { eventType: string; n: number }>();
  for (const r of rows) {
    const t = r.createdAt.getTime();
    if (t < from.getTime() || t >= to.getTime()) continue;
    s.total++;
    inc(s.byStatus, r.status);
    inc(s.byChannel, r.channelKind);
    inc(s.byEventType, r.eventType);
    const b = hours[Number(dubaiHour(r.createdAt))];
    b.total++;
    inc(b.byStatus, r.status);
    inc(b.byChannel, r.channelKind);
    inc(b.byEventType, r.eventType);
    if (r.status === "SENT") {
      const cur = sent.get(r.dedupKey);
      if (cur) cur.n++;
      else sent.set(r.dedupKey, { eventType: r.eventType, n: 1 });
    }
  }
  const dups: DupEntry[] = [];
  for (const [key, v] of sent) {
    if (v.n > 1) dups.push({ keyHash: hashKey(key), eventType: v.eventType, sentCount: v.n });
  }
  dups.sort((a, b) => b.sentCount - a.sentCount || a.keyHash.localeCompare(b.keyHash));
  s.duplicates = {
    keysWithMultipleSent: dups.length,
    extraSentRows: dups.reduce((acc, d) => acc + d.sentCount - 1, 0),
    top: dups.slice(0, Math.max(0, topN)),
  };
  return s;
}

function fmt(m: Record<string, number>): string {
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export function formatStats(s: OutgoingStats): string {
  const out: string[] = [];
  out.push(`OutgoingNotification за ${s.date} (Asia/Dubai, UTC ${s.fromUtc} .. ${s.toUtc})`);
  out.push(`Всего: ${s.total}`);
  out.push(`  status:    ${fmt(s.byStatus)}`);
  out.push(`  channel:   ${fmt(s.byChannel)}`);
  out.push(`  eventType: ${fmt(s.byEventType)}`);
  out.push("", "По часам (Dubai):");
  for (const h of s.hours) {
    if (!h.total) continue;
    out.push(`${h.hour}:00  total=${h.total}`);
    out.push(`    status:    ${fmt(h.byStatus)}`);
    out.push(`    channel:   ${fmt(h.byChannel)}`);
    out.push(`    eventType: ${fmt(h.byEventType)}`);
  }
  out.push("", `Дубли по dedupKey (>1 SENT): ключей ${s.duplicates.keysWithMultipleSent}, лишних SENT ${s.duplicates.extraSentRows}`);
  for (const d of s.duplicates.top) out.push(`  ${d.keyHash}  ${d.eventType}  sent=${d.sentCount}`);
  return out.join("\n");
}
