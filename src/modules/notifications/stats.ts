import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MANAGED_EVENT_TYPES, NOTIFICATION_CATALOG } from "./catalog";
import { explainStaffNotifications, type StaffNotificationExplain } from "./explain";
import {
  DELIVERY_STATUS_LABELS,
  STATS_CHANNELS,
  failureStatusLabel,
  skipReasonLabel,
  skipStatusLabel,
  type StatsChannel,
} from "./delivery-labels";
import { NotificationDomainError } from "./errors";
import {
  computeBotStatus,
  getBotContacts,
  getBotTrackingSince,
  type BotContactSnapshot,
  type BotStatus,
} from "@/modules/telegram-link/bot-contact";
import type {
  NotificationMetrics,
  NotificationStats,
  RecentNotificationItem,
  StatsChannelRow,
  StatsDays,
  StatsEventRow,
  StatsMeasuredSince,
  StatsSkips,
  StatsUserRow,
  UserNotificationStats,
} from "./types";

/**
 * Delivery & reaction statistics for staff notifications (US-D1/D2/D4).
 * ADR 2026-10-25-team-access-notifications §Q3 (definitions), §5.2, §5.5.
 *
 * - Logical notification = an OutgoingNotification fallback chain (root =
 *   `coalesce(fallbackOfId, id)`) or an InAppNotification (channel `IN_APP`).
 * - Sent = all; Delivered = chain has SENT (feed card — always); In flight =
 *   PENDING/DEFERRED and no SENT; Failed = the rest (incl. SKIPPED-stale).
 *   Sent = Delivered + Failed + In flight holds by construction (AC-D1.9).
 * - Measurable = delivered and (feed card or the root has a tracking link).
 *   Reaction (measurable only) = min(read with readVia ≠ 'bulk', first click).
 * - Only the current team (SUPERADMIN/ADMIN/MANAGER, not merged, not `system`)
 *   and only the 12 catalog types (AC-D1.7). Group chats — legacy
 *   NotificationLog rows without a person, a separate line (AC-D1.5).
 *
 * All SQL lives in this file (one aggregate with GROUPING SETS + the recent
 * list); everything after the query is pure and exported for tests.
 */

const TEAM_ROLES: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER"];
const SYSTEM_USER_ID = "system";
const DAY_MS = 86_400_000;
const RECENT_LIMIT = 20;

/** The migration that started click/read/skip tracking (= «измеряется с»). */
export const TRACKING_MIGRATION = "20261025120000_team_access_notifications";

export type StatsQuery = {
  days: StatsDays;
  eventType?: string;
  category?: string;
  userId?: string;
  channel?: StatsChannel;
};

// ---------------------------------------------------------------------------
// Raw SQL rows
// ---------------------------------------------------------------------------

type NumLike = bigint | number | string | null | undefined | { toString(): string };

/** One GROUPING SETS row: `g_*` = 1 when that column is aggregated away. */
export type StatsAggregateRow = {
  g_event: NumLike;
  g_user: NumLike;
  g_channel: NumLike;
  event_type: string | null;
  user_id: string | null;
  channel: string | null;
  n_sent: NumLike;
  n_delivered: NumLike;
  n_failed: NumLike;
  n_in_flight: NumLike;
  n_read: NumLike;
  n_clicked: NumLike;
  n_clicks: NumLike;
  n_measurable: NumLike;
  n_unmeasurable: NumLike;
  n_reactions: NumLike;
  median_reaction_s: NumLike;
  n_no_reaction_24h: NumLike;
  n_eligible_24h: NumLike;
  n_failed_bot_not_started: NumLike;
  n_failed_bot_blocked: NumLike;
};

export type StatsRecentRow = {
  kind: string;
  at: Date;
  event_type: string;
  channel: string | null;
  delivered: boolean;
  in_flight: boolean;
  delivered_at: Date | null;
  read_at: Date | null;
  clicked_at: Date | null;
  failure_code: string | null;
  measurable: boolean;
  reason: string | null;
};

function num(value: NumLike): number {
  if (value === null || value === undefined) return 0;
  const n = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: NumLike): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// SQL (parameterised only — every user-controlled value is a bound parameter)
// ---------------------------------------------------------------------------

type ItemsScope = { userIds: string[]; types: string[]; from: Date };

/**
 * CTEs `rows → chains → items`: one row per logical notification.
 * A chain counts only when its root is inside the window (`BOOL_OR(id =
 * root_id)`), so a fallback created after `from` for an older root is not
 * mistaken for a new notification.
 */
function itemsCte(scope: ItemsScope): Prisma.Sql {
  return Prisma.sql`
    rows AS (
      SELECT o.id, o."userId", o."eventType", o.status, o."sentAt", o."readAt", o."readVia",
             o."failureCode", o."clickedAt", o."clickCount", o."createdAt",
             COALESCE(o."fallbackOfId", o.id) AS root_id,
             c.kind::text AS channel_kind
      FROM "OutgoingNotification" o
      JOIN "UserNotificationChannel" c ON c.id = o."channelId"
      WHERE o."userId" = ANY(${scope.userIds}::text[])
        AND o."eventType" = ANY(${scope.types}::text[])
        AND o."createdAt" >= ${scope.from}
    ),
    chains AS (
      SELECT root_id,
             MIN("userId") AS user_id,
             MIN("eventType") AS event_type,
             MIN("createdAt") AS created_at,
             BOOL_OR(status = 'SENT') AS delivered,
             MIN("sentAt") FILTER (WHERE status = 'SENT') AS delivered_at,
             BOOL_OR(status IN ('PENDING', 'DEFERRED')) AS in_flight,
             (ARRAY_AGG(channel_kind ORDER BY (status = 'SENT') DESC, "createdAt" DESC))[1] AS channel,
             MIN("readAt") FILTER (WHERE "readVia" IS DISTINCT FROM 'bulk') AS read_at,
             (ARRAY_AGG("failureCode" ORDER BY "createdAt" DESC))[1] AS failure_code,
             MIN("clickedAt") FILTER (WHERE id = root_id) AS clicked_at,
             COALESCE(SUM("clickCount") FILTER (WHERE id = root_id), 0) AS click_count
      FROM rows
      GROUP BY root_id
      HAVING BOOL_OR(id = root_id)
    ),
    items AS (
      SELECT ch.user_id, ch.event_type, ch.channel, ch.created_at, ch.delivered, ch.delivered_at,
             ch.in_flight, ch.read_at, ch.failure_code, ch.clicked_at, ch.click_count,
             EXISTS (SELECT 1 FROM "NotificationLink" l WHERE l."outgoingId" = ch.root_id) AS has_link
      FROM chains ch
      UNION ALL
      SELECT i."userId", i."eventType", 'IN_APP', i."createdAt", true, i."createdAt",
             false, CASE WHEN i."readVia" IS DISTINCT FROM 'bulk' THEN i."readAt" END, NULL,
             i."clickedAt", i."clickCount", true
      FROM "InAppNotification" i
      WHERE i."userId" = ANY(${scope.userIds}::text[])
        AND i."eventType" = ANY(${scope.types}::text[])
        AND i."createdAt" >= ${scope.from}
    )`;
}

export function buildAggregateSql(input: ItemsScope & { now: Date; channel: string | null }): Prisma.Sql {
  const dayAgo = new Date(input.now.getTime() - DAY_MS);
  return Prisma.sql`/* notification-stats:aggregate */
    WITH ${itemsCte(input)},
    m AS (
      SELECT items.*,
             (delivered AND (channel = 'IN_APP' OR has_link)) AS measurable,
             LEAST(read_at, clicked_at) AS reaction_at
      FROM items
      WHERE (${input.channel}::text IS NULL OR channel = ${input.channel}::text)
    )
    SELECT GROUPING(event_type) AS g_event, GROUPING(user_id) AS g_user, GROUPING(channel) AS g_channel,
           event_type, user_id, channel,
           COUNT(*) AS n_sent,
           COUNT(*) FILTER (WHERE delivered) AS n_delivered,
           COUNT(*) FILTER (WHERE NOT delivered AND NOT in_flight) AS n_failed,
           COUNT(*) FILTER (WHERE NOT delivered AND in_flight) AS n_in_flight,
           COUNT(*) FILTER (WHERE delivered AND read_at IS NOT NULL) AS n_read,
           COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS n_clicked,
           COALESCE(SUM(click_count), 0) AS n_clicks,
           COUNT(*) FILTER (WHERE measurable) AS n_measurable,
           COUNT(*) FILTER (WHERE delivered AND NOT measurable) AS n_unmeasurable,
           COUNT(*) FILTER (WHERE measurable AND reaction_at IS NOT NULL) AS n_reactions,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY GREATEST(0::float8, EXTRACT(EPOCH FROM (reaction_at - delivered_at))::float8)
           ) FILTER (WHERE measurable AND reaction_at IS NOT NULL) AS median_reaction_s,
           COUNT(*) FILTER (
             WHERE measurable AND delivered_at <= ${dayAgo}
               AND (reaction_at IS NULL OR reaction_at > delivered_at + interval '24 hours')
           ) AS n_no_reaction_24h,
           COUNT(*) FILTER (WHERE measurable AND delivered_at <= ${dayAgo}) AS n_eligible_24h,
           COUNT(*) FILTER (WHERE NOT delivered AND NOT in_flight AND failure_code = 'BOT_NOT_STARTED') AS n_failed_bot_not_started,
           COUNT(*) FILTER (WHERE NOT delivered AND NOT in_flight AND failure_code = 'BOT_BLOCKED') AS n_failed_bot_blocked
    FROM m
    GROUP BY GROUPING SETS ((), (event_type), (user_id), (channel))`;
}

/** 20 latest items of one person: chains + feed cards + skips, merged by time, no payload. */
export function buildRecentSql(input: ItemsScope): Prisma.Sql {
  return Prisma.sql`/* notification-stats:recent */
    WITH ${itemsCte(input)},
    x AS (
      SELECT 'notification'::text AS kind, created_at AS at, event_type, channel, delivered, in_flight,
             delivered_at, read_at, clicked_at, failure_code,
             (delivered AND (channel = 'IN_APP' OR has_link)) AS measurable, NULL::text AS reason
      FROM items
      UNION ALL
      SELECT 'skip'::text, s."createdAt", s."eventType", NULL::text, false, false,
             NULL::timestamp, NULL::timestamp, NULL::timestamp, NULL::text, false, s.reason
      FROM "NotificationDeliverySkip" s
      WHERE s."userId" = ANY(${input.userIds}::text[])
        AND s."eventType" = ANY(${input.types}::text[])
        AND s."createdAt" >= ${input.from}
    )
    SELECT * FROM x ORDER BY at DESC LIMIT ${RECENT_LIMIT}`;
}

async function queryAggregate(input: ItemsScope & { now: Date; channel: string | null }): Promise<StatsAggregateRow[]> {
  if (input.userIds.length === 0 || input.types.length === 0) return [];
  return prisma.$queryRaw<StatsAggregateRow[]>(buildAggregateSql(input));
}

async function queryRecent(input: ItemsScope): Promise<StatsRecentRow[]> {
  if (input.userIds.length === 0 || input.types.length === 0) return [];
  return prisma.$queryRaw<StatsRecentRow[]>(buildRecentSql(input));
}

async function querySkips(scope: ItemsScope): Promise<Array<{ reason: string; count: number }>> {
  if (scope.userIds.length === 0 || scope.types.length === 0) return [];
  const groups = await prisma.notificationDeliverySkip.groupBy({
    by: ["reason"],
    where: { userId: { in: scope.userIds }, eventType: { in: scope.types }, createdAt: { gte: scope.from } },
    _count: { _all: true },
  });
  return groups.map((g) => ({ reason: g.reason, count: g._count._all }));
}

/** Legacy group-chat journal: NotificationLog rows without a person (AC-D1.5). */
async function queryGroupChats(types: string[], from: Date): Promise<{ sent: number; failed: number }> {
  if (types.length === 0) return { sent: 0, failed: 0 };
  const groups = await prisma.notificationLog.groupBy({
    by: ["status"],
    where: { userId: null, eventType: { in: types }, createdAt: { gte: from } },
    _count: { _all: true },
  });
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { sent: count("SENT"), failed: count("FAILED") };
}

type TeamMember = { id: string; name: string | null; email: string | null; role: Role; telegramId: string | null };

async function loadTeam(): Promise<TeamMember[]> {
  return prisma.user.findMany({
    where: { role: { in: TEAM_ROLES }, mergedIntoUserId: null, NOT: { id: SYSTEM_USER_ID } },
    select: { id: true, name: true, email: true, role: true, telegramId: true },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Measurement start (AC-D1.8)
// ---------------------------------------------------------------------------

let migrationAtCache: Date | null = null;

async function trackingMigrationAt(): Promise<Date | null> {
  if (migrationAtCache) return migrationAtCache;
  try {
    const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null }>>(Prisma.sql`/* notification-stats:migration */
      SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name = ${TRACKING_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at ASC LIMIT 1`);
    migrationAtCache = rows[0]?.finished_at ?? null;
  } catch {
    // No migrations table (db push / tests) — fall back to the first tracked rows.
    return null;
  }
  return migrationAtCache;
}

/** Test hook. */
export function resetMeasurementSinceCache(): void {
  migrationAtCache = null;
}

/**
 * When tracking started. Clicks/reads and skips started with the tracking
 * migration (its `finished_at`); without it — the first tracked row. Bot
 * contacts — `getBotTrackingSince()` (same date the staff screens show).
 */
export async function getMeasurementSince(): Promise<{ clicks: Date | null; skips: Date | null; bot: Date | null }> {
  const [migratedAt, firstLink, firstSkip, bot] = await Promise.all([
    trackingMigrationAt(),
    prisma.notificationLink.aggregate({ _min: { createdAt: true } }),
    prisma.notificationDeliverySkip.aggregate({ _min: { createdAt: true } }),
    getBotTrackingSince(),
  ]);
  return {
    clicks: migratedAt ?? firstLink._min.createdAt ?? null,
    skips: migratedAt ?? firstSkip._min.createdAt ?? null,
    bot,
  };
}

// ---------------------------------------------------------------------------
// Pure post-processing
// ---------------------------------------------------------------------------

/** Event types in scope: catalog → category → single type (intersection). */
export function scopeEventTypes(q: { eventType?: string; category?: string }): string[] {
  let types: string[] = [...MANAGED_EVENT_TYPES];
  if (q.category) {
    const category = NOTIFICATION_CATALOG.find((c) => c.key === q.category);
    types = category ? category.events.map((e) => e.eventType) : [];
  }
  if (q.eventType) types = types.filter((t) => t === q.eventType);
  return types;
}

export function periodWindow(days: StatsDays, now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

/** `partial` — the window starts before tracking did (or tracking never started). */
export function measurementState(from: Date, clicksSince: Date | null): StatsMeasuredSince {
  return {
    clicks: clicksSince ? clicksSince.toISOString() : null,
    partial: clicksSince === null || from.getTime() < clicksSince.getTime(),
  };
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export const EMPTY_METRICS: NotificationMetrics = {
  sent: 0,
  delivered: 0,
  failed: 0,
  inFlight: 0,
  read: 0,
  clickedNotifications: 0,
  clicksTotal: 0,
  measurable: 0,
  unmeasurable: 0,
  reactions: 0,
  reactionRate: null,
  medianReactionSeconds: null,
  noReaction24hShare: null,
};

/** One SQL row → the Metrics block (rates: reactions / measurable; null at 0). */
export function toMetrics(row: StatsAggregateRow | undefined): NotificationMetrics {
  if (!row) return { ...EMPTY_METRICS };
  const measurable = num(row.n_measurable);
  const reactions = num(row.n_reactions);
  const median = numOrNull(row.median_reaction_s);
  return {
    sent: num(row.n_sent),
    delivered: num(row.n_delivered),
    failed: num(row.n_failed),
    inFlight: num(row.n_in_flight),
    read: num(row.n_read),
    clickedNotifications: num(row.n_clicked),
    clicksTotal: num(row.n_clicks),
    measurable,
    unmeasurable: num(row.n_unmeasurable),
    reactions,
    reactionRate: ratio(reactions, measurable),
    medianReactionSeconds: median === null ? null : Math.round(median),
    noReaction24hShare: ratio(num(row.n_no_reaction_24h), num(row.n_eligible_24h)),
  };
}

export type SplitAggregate = {
  total: StatsAggregateRow | undefined;
  byEvent: Map<string, StatsAggregateRow>;
  byUser: Map<string, StatsAggregateRow>;
  byChannel: Map<string, StatsAggregateRow>;
};

/** GROUPING SETS ((), (event_type), (user_id), (channel)) → the four slices. */
export function splitAggregateRows(rows: StatsAggregateRow[]): SplitAggregate {
  const out: SplitAggregate = { total: undefined, byEvent: new Map(), byUser: new Map(), byChannel: new Map() };
  for (const row of rows) {
    const e = num(row.g_event) === 0;
    const u = num(row.g_user) === 0;
    const c = num(row.g_channel) === 0;
    if (!e && !u && !c) out.total = row;
    else if (e && !u && !c && row.event_type !== null) out.byEvent.set(row.event_type, row);
    else if (u && !e && !c && row.user_id !== null) out.byUser.set(row.user_id, row);
    else if (c && !e && !u && row.channel !== null) out.byChannel.set(row.channel, row);
  }
  return out;
}

const EVENT_META = new Map(
  NOTIFICATION_CATALOG.flatMap((category) =>
    category.events.map((event) => [event.eventType, { label: event.label, categoryKey: category.key }] as const),
  ),
);

export function eventLabelOf(eventType: string): string {
  return EVENT_META.get(eventType)?.label ?? eventType;
}

/** Every event type in scope, catalog order, zero-filled. */
export function buildEventRows(types: string[], byEvent: Map<string, StatsAggregateRow>): StatsEventRow[] {
  return types.map((eventType) => ({
    eventType,
    label: eventLabelOf(eventType),
    categoryKey: EVENT_META.get(eventType)?.categoryKey ?? "",
    ...toMetrics(byEvent.get(eventType)),
  }));
}

/** The four stats channels (or the filtered one), plus any other kind found in the data. */
export function buildChannelRows(channel: string | null, byChannel: Map<string, StatsAggregateRow>): StatsChannelRow[] {
  if (channel) return [{ channel, ...toMetrics(byChannel.get(channel)) }];
  const base: string[] = [...STATS_CHANNELS];
  const extra = [...byChannel.keys()].filter((k) => !base.includes(k)).sort();
  return [...base, ...extra].map((kind) => ({ channel: kind, ...toMetrics(byChannel.get(kind)) }));
}

/**
 * Team members in scope (zero-filled), most notified first. The SQL only ever
 * sees these ids (they are its parameter), so no row can be left out.
 */
export function buildUserRows(
  members: Array<Pick<TeamMember, "id" | "name" | "email" | "role">>,
  byUser: Map<string, StatsAggregateRow>,
): StatsUserRow[] {
  return members
    .map((m) => ({ user: { id: m.id, name: m.name ?? m.email ?? null, role: m.role }, ...toMetrics(byUser.get(m.id)) }))
    .sort((a, b) => b.sent - a.sent || (a.user.name ?? "").localeCompare(b.user.name ?? "", "ru"));
}

export function buildSkips(groups: Array<{ reason: string; count: number }>): StatsSkips {
  const byReason = [...groups]
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .map((g) => ({ reason: g.reason, label: skipReasonLabel(g.reason), count: g.count }));
  return { total: byReason.reduce((sum, g) => sum + g.count, 0), byReason };
}

const NO_CHANNEL_BLOCKERS = new Set(["NO_CHANNEL", "BOT_NOT_STARTED", "BOT_BLOCKED", "CHANNEL_DISABLED"]);

/** Subscribed to ≥ 1 event in scope, but no channel can deliver it (AC-D4.2). */
export function hasNoWorkingChannel(explain: StaffNotificationExplain, types: string[]): boolean {
  const scope = new Set(types);
  return explain.categories.some((category) =>
    category.events.some(
      (event) =>
        scope.has(event.eventType) &&
        event.status === "BLOCKED" &&
        event.blockers.some((b) => NO_CHANNEL_BLOCKERS.has(b.code)),
    ),
  );
}

/** Event types in scope that no team member receives personally (AC-D4.2). */
export function eventsWithoutPersonalRecipients(explains: StaffNotificationExplain[], types: string[]): string[] {
  const routed = new Set<string>();
  for (const explain of explains) {
    for (const category of explain.categories) {
      for (const event of category.events) {
        if (event.status === "RECEIVES" || event.status === "BLOCKED") routed.add(event.eventType);
      }
    }
  }
  return types.filter((t) => !routed.has(t));
}

type BotFailureSource = Pick<StatsAggregateRow, "n_failed_bot_not_started" | "n_failed_bot_blocked"> | undefined;

/**
 * «Проблемы» (AC-D4.1/D4.2): bot status — current, via `computeBotStatus`
 * (same as every staff screen); failed deliveries — chains in the window
 * whose last failure is the bot; channel/orphan checks — the same explain the
 * staff page and the matrix use.
 */
export function buildTeamProblems(input: {
  scope: Array<{ id: string; botStatus: BotStatus }>;
  total: BotFailureSource;
  explains: Map<string, StaffNotificationExplain>;
  teamIds: string[];
  types: string[];
}): NotificationStats["problems"] {
  const notStarted = input.scope.filter((u) => u.botStatus.state === "NOT_STARTED").map((u) => u.id);
  const blocked = input.scope.filter((u) => u.botStatus.state === "BLOCKED").map((u) => u.id);
  const noChannel = input.scope
    .filter((u) => {
      const explain = input.explains.get(u.id);
      return explain ? hasNoWorkingChannel(explain, input.types) : false;
    })
    .map((u) => u.id);
  const teamExplains = input.teamIds
    .map((id) => input.explains.get(id))
    .filter((e): e is StaffNotificationExplain => e !== undefined);
  const orphanEvents = eventsWithoutPersonalRecipients(teamExplains, input.types);
  return {
    botNotStarted: { users: notStarted.length, failedDeliveries: num(input.total?.n_failed_bot_not_started), userIds: notStarted },
    botBlocked: { users: blocked.length, failedDeliveries: num(input.total?.n_failed_bot_blocked), userIds: blocked },
    noWorkingChannel: { users: noChannel.length, userIds: noChannel },
    eventsWithoutPersonalRecipients: { count: orphanEvents.length, eventTypes: orphanEvents },
  };
}

export function buildUserProblems(botStatus: BotStatus, total: BotFailureSource): UserNotificationStats["problems"] {
  const failedBotNotStarted = num(total?.n_failed_bot_not_started);
  const failedBotBlocked = num(total?.n_failed_bot_blocked);
  return {
    botNotStarted: botStatus.state === "NOT_STARTED",
    botBlocked: botStatus.state === "BLOCKED",
    failedByBot: failedBotNotStarted + failedBotBlocked,
    failedBotNotStarted,
    failedBotBlocked,
  };
}

function reactionOf(row: StatsRecentRow): RecentNotificationItem["reaction"] {
  if (!row.measurable) return null;
  const read = row.read_at;
  const click = row.clicked_at;
  if (!read && !click) return null;
  const kind: "read" | "click" = read && (!click || read.getTime() <= click.getTime()) ? "read" : "click";
  const at = kind === "read" ? (read as Date) : (click as Date);
  const base = row.delivered_at ?? row.at;
  return { kind, afterSeconds: Math.max(0, Math.round((at.getTime() - base.getTime()) / 1000)) };
}

/** SQL row → «Последние уведомления» item: status label, reaction; never the text. */
export function toRecentItem(row: StatsRecentRow): RecentNotificationItem {
  const base = {
    at: row.at.toISOString(),
    eventType: row.event_type,
    eventLabel: eventLabelOf(row.event_type),
  };
  if (row.kind === "skip") {
    return { ...base, channel: null, status: "SKIPPED", statusLabel: skipStatusLabel(row.reason ?? ""), measurable: false, reaction: null };
  }
  if (row.delivered) {
    return {
      ...base,
      channel: row.channel,
      status: "DELIVERED",
      statusLabel: DELIVERY_STATUS_LABELS.DELIVERED,
      measurable: row.measurable,
      reaction: reactionOf(row),
    };
  }
  if (row.in_flight) {
    return { ...base, channel: row.channel, status: "IN_FLIGHT", statusLabel: DELIVERY_STATUS_LABELS.IN_FLIGHT, measurable: false, reaction: null };
  }
  return { ...base, channel: row.channel, status: "FAILED", statusLabel: failureStatusLabel(row.failure_code), measurable: false, reaction: null };
}

function botStatusOf(
  member: Pick<TeamMember, "telegramId">,
  contacts: Map<string, BotContactSnapshot>,
  trackingSince: Date | null,
): BotStatus {
  const tg = member.telegramId;
  return computeBotStatus(tg, tg ? contacts.get(tg) : null, trackingSince);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** General statistics page (US-D1 + problems US-D4). */
export async function getNotificationStats(q: StatsQuery, now: Date = new Date()): Promise<NotificationStats> {
  const { from, to } = periodWindow(q.days, now);
  const types = scopeEventTypes(q);
  const team = await loadTeam();
  const scope = q.userId ? team.filter((m) => m.id === q.userId) : team;
  const items: ItemsScope = { userIds: scope.map((m) => m.id), types, from };
  const channel = q.channel ?? null;
  // Skips have no channel; group chats have no person and are Telegram only.
  const skipsApplicable = channel === null;
  const groupChatsApplicable = !q.userId && (channel === null || channel === "TELEGRAM");

  const [aggregate, skipGroups, groupChats, since, explains, contacts, trackingSince] = await Promise.all([
    queryAggregate({ ...items, now, channel }),
    skipsApplicable ? querySkips(items) : Promise.resolve([]),
    groupChatsApplicable ? queryGroupChats(types, from) : Promise.resolve({ sent: 0, failed: 0 }),
    getMeasurementSince(),
    explainStaffNotifications(team.map((m) => m.id), now),
    getBotContacts(scope.map((m) => m.telegramId).filter((t): t is string => Boolean(t))),
    getBotTrackingSince(),
  ]);

  const split = splitAggregateRows(aggregate);
  return {
    period: { days: q.days, from: from.toISOString(), to: to.toISOString() },
    measuredSince: measurementState(from, since.clicks),
    totals: toMetrics(split.total),
    byEvent: buildEventRows(types, split.byEvent),
    byUser: buildUserRows(scope, split.byUser),
    byChannel: buildChannelRows(channel, split.byChannel),
    skips: buildSkips(skipGroups),
    groupChats,
    problems: buildTeamProblems({
      scope: scope.map((m) => ({ id: m.id, botStatus: botStatusOf(m, contacts, trackingSince) })),
      total: split.total,
      explains,
      teamIds: team.map((m) => m.id),
      types,
    }),
  };
}

/** Statistics block on the staff page (US-D2). Only the current team is counted. */
export async function getUserNotificationStats(
  userId: string,
  days: StatsDays,
  now: Date = new Date(),
): Promise<UserNotificationStats> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, mergedIntoUserId: true, telegramId: true },
  });
  if (!user) throw new NotificationDomainError("USER_NOT_FOUND", "Пользователь не найден", 404);

  const inTeam = TEAM_ROLES.includes(user.role) && user.mergedIntoUserId === null && user.id !== SYSTEM_USER_ID;
  const { from, to } = periodWindow(days, now);
  const types: string[] = [...MANAGED_EVENT_TYPES];
  const items: ItemsScope = { userIds: inTeam ? [user.id] : [], types, from };

  const [aggregate, skipGroups, recentRows, since, contacts, trackingSince] = await Promise.all([
    queryAggregate({ ...items, now, channel: null }),
    querySkips(items),
    queryRecent(items),
    getMeasurementSince(),
    getBotContacts(user.telegramId ? [user.telegramId] : []),
    getBotTrackingSince(),
  ]);

  const split = splitAggregateRows(aggregate);
  return {
    period: { days, from: from.toISOString(), to: to.toISOString() },
    measuredSince: measurementState(from, since.clicks),
    totals: toMetrics(split.total),
    byEvent: buildEventRows(types, split.byEvent),
    byChannel: buildChannelRows(null, split.byChannel),
    skips: buildSkips(skipGroups),
    recent: recentRows.map(toRecentItem),
    problems: buildUserProblems(botStatusOf(user, contacts, trackingSince), split.total),
  };
}
