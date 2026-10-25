import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

/**
 * Delivery & reaction statistics — ADR 2026-10-25-team-access-notifications
 * §Q3/§5.2/§5.5, PRD US-D1/D2/D4 and the QA control set «Статистика (D)».
 *
 * The SQL itself is checked against a real PostgreSQL outside the unit suite
 * (no DB in unit tests); here `$queryRaw` returns the rows that SQL produces
 * for control set D, and we check the post-processing, the parameters and the
 * definitions baked into the query text.
 */

const mockQueryRaw = vi.fn();
const mockUserFindMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockSkipGroupBy = vi.fn();
const mockSkipAggregate = vi.fn();
const mockLogGroupBy = vi.fn();
const mockLinkAggregate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    notificationDeliverySkip: {
      groupBy: (...args: unknown[]) => mockSkipGroupBy(...args),
      aggregate: (...args: unknown[]) => mockSkipAggregate(...args),
    },
    notificationLog: { groupBy: (...args: unknown[]) => mockLogGroupBy(...args) },
    notificationLink: { aggregate: (...args: unknown[]) => mockLinkAggregate(...args) },
  },
}));

const mockExplain = vi.fn();
vi.mock("../explain", () => ({
  explainStaffNotifications: (...args: unknown[]) => mockExplain(...args),
}));

const mockGetBotContacts = vi.fn();
const mockGetBotTrackingSince = vi.fn();
vi.mock("@/modules/telegram-link/bot-contact", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>();
  return {
    ...actual,
    getBotContacts: (...args: unknown[]) => mockGetBotContacts(...args),
    getBotTrackingSince: () => mockGetBotTrackingSince(),
  };
});

import {
  buildChannelRows,
  buildSkips,
  eventsWithoutPersonalRecipients,
  getMeasurementSince,
  getNotificationStats,
  getUserNotificationStats,
  hasNoWorkingChannel,
  measurementState,
  resetMeasurementSinceCache,
  scopeEventTypes,
  splitAggregateRows,
  toMetrics,
  toRecentItem,
  type StatsAggregateRow,
  type StatsRecentRow,
} from "../stats";
import { MANAGED_EVENT_TYPES } from "../catalog";
import { NotificationDomainError } from "../errors";
import type { StaffNotificationExplain } from "../explain";
import type { NotificationMetrics } from "../types";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const MIGRATED = new Date("2026-10-25T06:00:00.000Z");
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Fixture: what the aggregate SQL returns for QA control set D
// (verified on a real PostgreSQL 16 with the same rows).
// ---------------------------------------------------------------------------

type Counts = {
  sent: number; delivered: number; failed: number; inFlight: number; read: number; clicked: number; clicks: number;
  measurable: number; unmeasurable: number; reactions: number; median: number | null; noReaction24h: number;
  eligible24h: number; failedBotNotStarted: number; failedBotBlocked: number;
};

const ZERO: Counts = {
  sent: 0, delivered: 0, failed: 0, inFlight: 0, read: 0, clicked: 0, clicks: 0, measurable: 0, unmeasurable: 0,
  reactions: 0, median: null, noReaction24h: 0, eligible24h: 0, failedBotNotStarted: 0, failedBotBlocked: 0,
};

/** Prisma returns COUNT(*) as BigInt and PERCENTILE_CONT as a float. */
function aggRow(keys: { e?: string; u?: string; c?: string }, counts: Partial<Counts>): StatsAggregateRow {
  const n = { ...ZERO, ...counts };
  return {
    g_event: keys.e ? 0 : 1,
    g_user: keys.u ? 0 : 1,
    g_channel: keys.c ? 0 : 1,
    event_type: keys.e ?? null,
    user_id: keys.u ?? null,
    channel: keys.c ?? null,
    n_sent: BigInt(n.sent),
    n_delivered: BigInt(n.delivered),
    n_failed: BigInt(n.failed),
    n_in_flight: BigInt(n.inFlight),
    n_read: BigInt(n.read),
    n_clicked: BigInt(n.clicked),
    n_clicks: BigInt(n.clicks),
    n_measurable: BigInt(n.measurable),
    n_unmeasurable: BigInt(n.unmeasurable),
    n_reactions: BigInt(n.reactions),
    median_reaction_s: n.median,
    n_no_reaction_24h: BigInt(n.noReaction24h),
    n_eligible_24h: BigInt(n.eligible24h),
    n_failed_bot_not_started: BigInt(n.failedBotNotStarted),
    n_failed_bot_blocked: BigInt(n.failedBotBlocked),
  };
}

const QA_D_TOTAL: Partial<Counts> = {
  sent: 13, delivered: 11, failed: 2, read: 2, clicked: 5, clicks: 6, measurable: 9, unmeasurable: 2, reactions: 6,
  median: 510, noReaction24h: 3, eligible24h: 9, failedBotNotStarted: 1, failedBotBlocked: 1,
};

const QA_D_ROWS: StatsAggregateRow[] = [
  aggRow({}, QA_D_TOTAL),
  // by event
  aggRow({ e: "telephony.daily_summary" }, { sent: 3, delivered: 3, read: 2, clicked: 1, clicks: 1, measurable: 3, reactions: 2, median: 690, noReaction24h: 1, eligible24h: 3 }),
  aggRow({ e: "booking.created" }, { sent: 3, delivered: 2, failed: 1, clicked: 2, clicks: 3, measurable: 2, reactions: 2, median: 510, eligible24h: 2, failedBotNotStarted: 1 }),
  aggRow({ e: "booking.cancelled" }, { sent: 1, delivered: 1, unmeasurable: 1 }),
  aggRow({ e: "order.placed" }, { sent: 2, delivered: 1, failed: 1, clicked: 1, clicks: 1, measurable: 1, reactions: 1, median: 1800, eligible24h: 1, failedBotBlocked: 1 }),
  aggRow({ e: "contract.expiring" }, { sent: 1, delivered: 1, measurable: 1, noReaction24h: 1, eligible24h: 1 }),
  aggRow({ e: "inquiry.created" }, { sent: 1, delivered: 1, measurable: 1, noReaction24h: 1, eligible24h: 1 }),
  aggRow({ e: "payment.succeeded" }, { sent: 1, delivered: 1, clicked: 1, clicks: 1, measurable: 1, reactions: 1, median: 180, eligible24h: 1 }),
  aggRow({ e: "system.release" }, { sent: 1, delivered: 1, unmeasurable: 1 }),
  // by user — the QA subject
  aggRow({ u: "u_a" }, QA_D_TOTAL),
  // by channel
  aggRow({ c: "TELEGRAM" }, { sent: 8, delivered: 6, failed: 2, clicked: 3, clicks: 4, measurable: 4, unmeasurable: 2, reactions: 3, median: 720, noReaction24h: 1, eligible24h: 4, failedBotNotStarted: 1, failedBotBlocked: 1 }),
  aggRow({ c: "PUSH" }, { sent: 2, delivered: 2, clicked: 1, clicks: 1, measurable: 2, reactions: 1, median: 180, noReaction24h: 1, eligible24h: 2 }),
  aggRow({ c: "IN_APP" }, { sent: 3, delivered: 3, read: 2, clicked: 1, clicks: 1, measurable: 3, reactions: 2, median: 690, noReaction24h: 1, eligible24h: 3 }),
];

const TEAM = [
  { id: "u_a", name: "Анна", email: "a@example.com", role: "MANAGER", telegramId: "1001" },
  { id: "u_b", name: "Борис", email: null, role: "MANAGER", telegramId: "1002" },
  { id: "u_s", name: "Сергей", email: null, role: "SUPERADMIN", telegramId: "1003" },
];

const TRACKING_SINCE = new Date("2026-08-26T00:00:00.000Z");

function explainOf(userId: string, events: Array<{ eventType: string; status: "RECEIVES" | "BLOCKED" | "NOT_RECEIVING" | "NO_ACCESS"; blockers?: string[] }>): StaffNotificationExplain {
  return {
    userId,
    role: "MANAGER",
    botStatus: { state: "NOT_LINKED" },
    channels: [],
    globalNotes: [],
    categories: [
      {
        key: "x",
        label: "X",
        description: "",
        icon: "bell",
        delivery: "personal",
        access: { ok: true },
        groupChat: [],
        events: events.map((e) => ({
          eventType: e.eventType,
          label: e.eventType,
          description: "",
          status: e.status,
          toggle: { enabled: true, editable: true, source: "explicit" },
          paths: [],
          contexts: [],
          deliveryChannels: [],
          blockers: (e.blockers ?? []).map((code) => ({ code, label: code })),
          notes: [],
          lastChange: null,
        })),
      },
    ],
  } as unknown as StaffNotificationExplain;
}

type SqlArg = Prisma.Sql;

function sqlCalls(tag: string): SqlArg[] {
  return mockQueryRaw.mock.calls.map((c) => c[0] as SqlArg).filter((q) => q.text.includes(tag));
}

let recentRows: StatsRecentRow[] = [];
let migrationRows: Array<{ finished_at: Date | null }> | Error = [{ finished_at: MIGRATED }];

beforeEach(() => {
  vi.clearAllMocks();
  resetMeasurementSinceCache();
  recentRows = [];
  migrationRows = [{ finished_at: MIGRATED }];
  mockQueryRaw.mockImplementation(async (query: SqlArg) => {
    if (query.text.includes("notification-stats:aggregate")) return QA_D_ROWS;
    if (query.text.includes("notification-stats:recent")) return recentRows;
    if (query.text.includes("notification-stats:migration")) {
      if (migrationRows instanceof Error) throw migrationRows;
      return migrationRows;
    }
    throw new Error(`unexpected query: ${query.text.slice(0, 60)}`);
  });
  mockUserFindMany.mockResolvedValue(TEAM);
  mockSkipGroupBy.mockResolvedValue([
    { reason: "NO_CHANNEL", _count: { _all: 1 } },
    { reason: "DND", _count: { _all: 1 } },
    { reason: "OPTED_OUT", _count: { _all: 1 } },
  ]);
  mockLogGroupBy.mockResolvedValue([
    { status: "SENT", _count: { _all: 3 } },
    { status: "FAILED", _count: { _all: 1 } },
  ]);
  mockLinkAggregate.mockResolvedValue({ _min: { createdAt: new Date("2026-10-25T07:00:00Z") } });
  mockSkipAggregate.mockResolvedValue({ _min: { createdAt: new Date("2026-10-25T08:00:00Z") } });
  mockGetBotTrackingSince.mockResolvedValue(TRACKING_SINCE);
  mockGetBotContacts.mockResolvedValue(
    new Map([
      // A — blocked now (block after the last contact / delivery proof)
      ["1001", { startedAt: new Date("2026-09-30"), startedBackfill: false, lastContactAt: new Date("2026-10-15"), lastDeliveryOkAt: new Date("2026-10-22"), blockedAt: new Date("2026-10-23") }],
      // S — started; B has no contact → «бот не запущен»
      ["1003", { startedAt: new Date("2026-09-01"), startedBackfill: false, lastContactAt: new Date("2026-10-24"), lastDeliveryOkAt: null, blockedAt: null }],
    ]),
  );
  mockExplain.mockResolvedValue(
    new Map([
      ["u_a", explainOf("u_a", [])],
      ["u_b", explainOf("u_b", [{ eventType: "booking.created", status: "BLOCKED", blockers: ["BOT_NOT_STARTED"] }])],
      ["u_s", explainOf("u_s", [{ eventType: "telephony.daily_summary", status: "RECEIVES" }])],
    ]),
  );
});

const COUNT_KEYS = ["sent", "delivered", "failed", "inFlight", "read", "clickedNotifications", "clicksTotal", "measurable", "unmeasurable", "reactions"] as const;

function sumRows(rows: NotificationMetrics[]): Record<(typeof COUNT_KEYS)[number], number> {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) as Record<(typeof COUNT_KEYS)[number], number>;
}

describe("getNotificationStats — QA control set D", () => {
  it("AC-D1.2/AC-D1.6: totals match the PRD numbers exactly", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.totals).toEqual({
      sent: 13,
      delivered: 11,
      failed: 2,
      inFlight: 0,
      read: 2,
      clickedNotifications: 5,
      clicksTotal: 6,
      measurable: 9,
      unmeasurable: 2,
      reactions: 6,
      reactionRate: 6 / 9,
      medianReactionSeconds: 510,
      noReaction24hShare: 3 / 9,
    });
    expect(Math.round((stats.totals.reactionRate ?? 0) * 100)).toBe(67);
  });

  it("AC-D1.3: reactions per channel — Telegram 3, Push 1, feed 2; measurable 4 + 2 + 3", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    const ch = Object.fromEntries(stats.byChannel.map((r) => [r.channel, r]));
    expect(stats.byChannel.map((r) => r.channel)).toEqual(["TELEGRAM", "PUSH", "EMAIL", "IN_APP"]);
    expect([ch.TELEGRAM.reactions, ch.PUSH.reactions, ch.IN_APP.reactions]).toEqual([3, 1, 2]);
    expect([ch.TELEGRAM.measurable, ch.PUSH.measurable, ch.IN_APP.measurable]).toEqual([4, 2, 3]);
    expect(ch.TELEGRAM.unmeasurable).toBe(2);
    expect(ch.IN_APP.read).toBe(2);
    expect(ch.IN_APP.sent).toBe(3);
    expect(ch.EMAIL).toMatchObject({ sent: 0, reactionRate: null, medianReactionSeconds: null });
  });

  it("AC-D1.9: every slice sums to the totals; Sent = Delivered + Failed + InFlight on every row", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    const totals = sumRows([stats.totals]);
    expect(sumRows(stats.byEvent)).toEqual(totals);
    expect(sumRows(stats.byUser)).toEqual(totals);
    expect(sumRows(stats.byChannel)).toEqual(totals);
    for (const row of [stats.totals, ...stats.byEvent, ...stats.byUser, ...stats.byChannel]) {
      expect(row.sent).toBe(row.delivered + row.failed + row.inFlight);
    }
  });

  it("AC-D1.3: every catalog event and every team member is listed (zero-filled), labels and categories attached", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.byEvent.map((r) => r.eventType)).toEqual([...MANAGED_EVENT_TYPES]);
    expect(stats.byEvent.find((r) => r.eventType === "booking.created")).toMatchObject({
      label: "Новая бронь",
      categoryKey: "bookings",
      sent: 3,
      failed: 1,
    });
    expect(stats.byEvent.find((r) => r.eventType === "order.cancelled")).toMatchObject({ sent: 0, reactionRate: null });
    expect(stats.byUser.map((r) => r.user)).toEqual([
      { id: "u_a", name: "Анна", role: "MANAGER" },
      { id: "u_b", name: "Борис", role: "MANAGER" },
      { id: "u_s", name: "Сергей", role: "SUPERADMIN" },
    ]);
    expect(stats.byUser[0].sent).toBe(13);
  });

  it("AC-D4.1: problems — bot not started 1 failed delivery, blocked 1; people by current bot status", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.problems.botNotStarted).toEqual({ users: 1, failedDeliveries: 1, userIds: ["u_b"] });
    expect(stats.problems.botBlocked).toEqual({ users: 1, failedDeliveries: 1, userIds: ["u_a"] });
  });

  it("AC-D4.2: «подписаны, но нет рабочего канала» and events nobody receives personally come from explain", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.problems.noWorkingChannel).toEqual({ users: 1, userIds: ["u_b"] });
    const orphan = stats.problems.eventsWithoutPersonalRecipients;
    expect(orphan.eventTypes).not.toContain("booking.created");
    expect(orphan.eventTypes).not.toContain("telephony.daily_summary");
    expect(orphan.count).toBe(MANAGED_EVENT_TYPES.length - 2);
    expect(mockExplain).toHaveBeenCalledWith(["u_a", "u_b", "u_s"], NOW);
  });

  it("AC-D4.3: skips are reported apart from errors, with human reasons", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.skips.total).toBe(3);
    expect(stats.skips.byReason.map((r) => r.label).sort()).toEqual(["Нет канала", "Не беспокоить", "Отключено сотрудником"].sort());
    expect(stats.totals.failed).toBe(2);
  });

  it("AC-D1.5: group chats are a separate line from the legacy journal (no person, catalog types, window)", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.groupChats).toEqual({ sent: 3, failed: 1 });
    expect(mockLogGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: null, eventType: { in: [...MANAGED_EVENT_TYPES] }, createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) } },
      _count: { _all: true },
    });
    // not mixed into the personal numbers
    expect(stats.totals.sent).toBe(13);
  });

  it("returns the period window and never leaks payload / externalId", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.period).toEqual({ days: 30, from: "2026-09-25T10:00:00.000Z", to: "2026-10-25T10:00:00.000Z" });
    const json = JSON.stringify(stats);
    expect(json).not.toMatch(/externalId|payload/);
  });
});

describe("getNotificationStats — scope and parameters", () => {
  it("AC-D1.7: only the current team (roles, not merged, not system) — their ids and the catalog types are SQL parameters", async () => {
    await getNotificationStats({ days: 30 }, NOW);
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] }, mergedIntoUserId: null, NOT: { id: "system" } },
      }),
    );
    const [aggregate] = sqlCalls("notification-stats:aggregate");
    expect(aggregate.values).toContainEqual(["u_a", "u_b", "u_s"]);
    expect(aggregate.values).toContainEqual([...MANAGED_EVENT_TYPES]);
    expect(aggregate.values).toContainEqual(new Date(NOW.getTime() - 30 * DAY));
    expect(mockSkipGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: ["u_a", "u_b", "u_s"] }, eventType: { in: [...MANAGED_EVENT_TYPES] }, createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) } },
      }),
    );
  });

  it("encodes the ADR definitions in the query (chains, bulk reads, measurable, reaction, grouping sets)", async () => {
    await getNotificationStats({ days: 30 }, NOW);
    const text = sqlCalls("notification-stats:aggregate")[0].text;
    expect(text).toContain(`COALESCE(o."fallbackOfId", o.id) AS root_id`);
    expect(text).toContain("HAVING BOOL_OR(id = root_id)");
    expect(text).toContain(`"readVia" IS DISTINCT FROM 'bulk'`);
    expect(text).toContain("(delivered AND (channel = 'IN_APP' OR has_link)) AS measurable");
    expect(text).toContain("LEAST(read_at, clicked_at) AS reaction_at");
    expect(text).toContain("GROUP BY GROUPING SETS ((), (event_type), (user_id), (channel))");
    expect(text).toContain(`FROM "InAppNotification" i`);
  });

  it("category → only its event types; eventType narrows further; unknown combination → no query", async () => {
    await getNotificationStats({ days: 7, category: "bookings" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")[0].values).toContainEqual(["booking.created", "booking.cancelled"]);

    mockQueryRaw.mockClear();
    const narrowed = await getNotificationStats({ days: 7, category: "bookings", eventType: "booking.cancelled" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")[0].values).toContainEqual(["booking.cancelled"]);
    expect(narrowed.byEvent.map((r) => r.eventType)).toEqual(["booking.cancelled"]);

    mockQueryRaw.mockClear();
    const empty = await getNotificationStats({ days: 7, category: "cafe", eventType: "booking.created" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")).toHaveLength(0);
    expect(empty.totals.sent).toBe(0);
    expect(empty.byEvent).toEqual([]);
  });

  it("channel filter is a bound parameter; skips (no channel) are not mixed in; group chats only for Telegram", async () => {
    const push = await getNotificationStats({ days: 30, channel: "PUSH" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")[0].values).toContain("PUSH");
    expect(mockSkipGroupBy).not.toHaveBeenCalled();
    expect(mockLogGroupBy).not.toHaveBeenCalled();
    expect(push.skips).toEqual({ total: 0, byReason: [] });
    expect(push.groupChats).toEqual({ sent: 0, failed: 0 });
    expect(push.byChannel.map((r) => r.channel)).toEqual(["PUSH"]);

    mockLogGroupBy.mockClear();
    const tg = await getNotificationStats({ days: 30, channel: "TELEGRAM" }, NOW);
    expect(mockLogGroupBy).toHaveBeenCalled();
    expect(tg.groupChats).toEqual({ sent: 3, failed: 1 });
  });

  it("userId filter: scope = that team member, no group chats; explain still covers the whole team", async () => {
    const stats = await getNotificationStats({ days: 30, userId: "u_b" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")[0].values).toContainEqual(["u_b"]);
    expect(stats.byUser.map((r) => r.user.id)).toEqual(["u_b"]);
    expect(mockLogGroupBy).not.toHaveBeenCalled();
    expect(stats.groupChats).toEqual({ sent: 0, failed: 0 });
    expect(stats.problems.botBlocked.userIds).toEqual([]);
    expect(stats.problems.botNotStarted.userIds).toEqual(["u_b"]);
    expect(mockExplain).toHaveBeenCalledWith(["u_a", "u_b", "u_s"], NOW);
  });

  it("a userId outside the team (or hostile input) never reaches SQL — empty result", async () => {
    const stats = await getNotificationStats({ days: 30, userId: "x' OR 1=1 --" }, NOW);
    expect(sqlCalls("notification-stats:aggregate")).toHaveLength(0);
    expect(stats.totals).toMatchObject({ sent: 0, delivered: 0, reactionRate: null });
    expect(stats.byUser).toEqual([]);
  });
});

describe("measurement start (AC-D1.8)", () => {
  it("AC-D1.8: window starting before the tracking migration → partial with the date", async () => {
    const stats = await getNotificationStats({ days: 30 }, NOW);
    expect(stats.measuredSince).toEqual({ clicks: MIGRATED.toISOString(), partial: true });
    expect(sqlCalls("notification-stats:migration")[0].values).toEqual(["20261025120000_team_access_notifications"]);
  });

  it("AC-D1.8: tracking older than the window → not partial", async () => {
    migrationRows = [{ finished_at: new Date("2026-01-01T00:00:00Z") }];
    const stats = await getNotificationStats({ days: 90 }, NOW);
    expect(stats.measuredSince.partial).toBe(false);
  });

  it("without the migrations table — falls back to the first tracked rows; bot = contact tracking start", async () => {
    migrationRows = new Error('relation "_prisma_migrations" does not exist');
    const since = await getMeasurementSince();
    expect(since).toEqual({
      clicks: new Date("2026-10-25T07:00:00Z"),
      skips: new Date("2026-10-25T08:00:00Z"),
      bot: TRACKING_SINCE,
    });
  });

  it("measurementState: no tracking at all is partial (never bare zeros)", () => {
    expect(measurementState(new Date(), null)).toEqual({ clicks: null, partial: true });
  });
});

describe("pure post-processing", () => {
  it("toMetrics: rates are null when the denominator is 0; BigInt and Decimal-like values are coerced", () => {
    expect(toMetrics(undefined)).toMatchObject({ sent: 0, reactionRate: null, medianReactionSeconds: null, noReaction24hShare: null });
    const m = toMetrics({ ...aggRow({}, { sent: 4, delivered: 4, measurable: 0, reactions: 0 }), median_reaction_s: { toString: () => "61.6" } });
    expect(m.reactionRate).toBeNull();
    expect(m.medianReactionSeconds).toBe(62);
    expect(m.sent).toBe(4);
  });

  it("splitAggregateRows sorts GROUPING SETS rows into the four slices", () => {
    const split = splitAggregateRows(QA_D_ROWS);
    expect(split.total && Number(split.total.n_sent)).toBe(13);
    expect([...split.byEvent.keys()]).toHaveLength(8);
    expect([...split.byUser.keys()]).toEqual(["u_a"]);
    expect([...split.byChannel.keys()]).toEqual(["TELEGRAM", "PUSH", "IN_APP"]);
  });

  it("buildChannelRows keeps unexpected kinds found in the data (sum stays equal to the total)", () => {
    const rows = buildChannelRows(null, new Map([["VK", aggRow({ c: "VK" }, { sent: 1, delivered: 1 })]]));
    expect(rows.map((r) => r.channel)).toEqual(["TELEGRAM", "PUSH", "EMAIL", "IN_APP", "VK"]);
  });

  it("scopeEventTypes: catalog / category / event", () => {
    expect(scopeEventTypes({})).toEqual([...MANAGED_EVENT_TYPES]);
    expect(scopeEventTypes({ category: "cafe" })).toEqual(["order.placed", "order.cancelled"]);
    expect(scopeEventTypes({ eventType: "system.release" })).toEqual(["system.release"]);
  });

  it("buildSkips drops empty groups and sums the rest", () => {
    expect(buildSkips([{ reason: "DUPLICATE", count: 2 }, { reason: "DND", count: 0 }])).toEqual({
      total: 2,
      byReason: [{ reason: "DUPLICATE", label: "Дубль", count: 2 }],
    });
  });

  it("AC-D4.2: no working channel = a BLOCKED event in scope with a channel blocker (DND alone does not count)", () => {
    const dndOnly = explainOf("u", [{ eventType: "booking.created", status: "BLOCKED", blockers: ["DND"] }]);
    const noChannel = explainOf("u", [{ eventType: "booking.created", status: "BLOCKED", blockers: ["NO_CHANNEL"] }]);
    expect(hasNoWorkingChannel(dndOnly, ["booking.created"])).toBe(false);
    expect(hasNoWorkingChannel(noChannel, ["booking.created"])).toBe(true);
    expect(hasNoWorkingChannel(noChannel, ["order.placed"])).toBe(false);
    expect(eventsWithoutPersonalRecipients([noChannel], ["booking.created", "order.placed"])).toEqual(["order.placed"]);
  });
});

describe("toRecentItem (AC-D2.2 / AC-D2.3)", () => {
  const base: StatsRecentRow = {
    kind: "notification",
    at: new Date("2026-10-20T10:00:00Z"),
    event_type: "booking.created",
    channel: "TELEGRAM",
    delivered: true,
    in_flight: false,
    delivered_at: new Date("2026-10-20T10:00:10Z"),
    read_at: null,
    clicked_at: null,
    failure_code: null,
    measurable: true,
    reason: null,
  };

  it("AC-D2.2: delivered with a click → «Клик через 12 мин» data; read first → read", () => {
    expect(toRecentItem({ ...base, clicked_at: new Date("2026-10-20T10:12:10Z") })).toEqual({
      at: "2026-10-20T10:00:00.000Z",
      eventType: "booking.created",
      eventLabel: "Новая бронь",
      channel: "TELEGRAM",
      status: "DELIVERED",
      statusLabel: "Доставлено",
      measurable: true,
      reaction: { kind: "click", afterSeconds: 720 },
    });
    const readFirst = toRecentItem({
      ...base,
      channel: "IN_APP",
      read_at: new Date("2026-10-20T10:03:10Z"),
      clicked_at: new Date("2026-10-20T10:03:10Z"),
    });
    expect(readFirst.reaction).toEqual({ kind: "read", afterSeconds: 180 });
  });

  it("unmeasurable delivered (Telegram without a button) has no reaction", () => {
    expect(toRecentItem({ ...base, measurable: false, read_at: new Date("2026-10-20T11:00:00Z") })).toMatchObject({
      status: "DELIVERED",
      measurable: false,
      reaction: null,
    });
  });

  it("AC-D2.3: failures and skips read as human labels, never raw codes", () => {
    const blocked = toRecentItem({ ...base, delivered: false, delivered_at: null, failure_code: "BOT_BLOCKED" });
    expect(blocked).toMatchObject({ status: "FAILED", statusLabel: "Ошибка: бот заблокирован", reaction: null });
    expect(toRecentItem({ ...base, delivered: false, failure_code: "NETWORK" }).statusLabel).toBe("Ошибка: канал недоступен");
    expect(toRecentItem({ ...base, delivered: false, failure_code: "SOMETHING_NEW" }).statusLabel).toBe("Ошибка: канал недоступен");
    expect(toRecentItem({ ...base, delivered: false, in_flight: true }).status).toBe("IN_FLIGHT");
    const skip = toRecentItem({ ...base, kind: "skip", channel: null, delivered: false, reason: "NO_CHANNEL" });
    expect(skip).toMatchObject({ status: "SKIPPED", statusLabel: "Пропущено: нет канала", channel: null });
    for (const item of [blocked, skip]) expect(item.statusLabel).not.toMatch(/[A-Z_]{4,}/);
  });
});

describe("getUserNotificationStats (US-D2)", () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({ id: "u_a", role: "MANAGER", mergedIntoUserId: null, telegramId: "1001" });
    recentRows = [
      { kind: "skip", at: new Date("2026-10-24T10:00:00Z"), event_type: "booking.cancelled", channel: null, delivered: false, in_flight: false, delivered_at: null, read_at: null, clicked_at: null, failure_code: null, measurable: false, reason: "OPTED_OUT" },
      { kind: "notification", at: new Date("2026-10-23T10:00:00Z"), event_type: "order.placed", channel: "TELEGRAM", delivered: false, in_flight: false, delivered_at: null, read_at: null, clicked_at: null, failure_code: "BOT_BLOCKED", measurable: false, reason: null },
      { kind: "notification", at: new Date("2026-10-21T10:00:00Z"), event_type: "telephony.daily_summary", channel: "IN_APP", delivered: true, in_flight: false, delivered_at: new Date("2026-10-21T10:00:00Z"), read_at: new Date("2026-10-21T10:20:00Z"), clicked_at: null, failure_code: null, measurable: true, reason: null },
    ];
  });

  it("AC-D2.1: same metrics for one employee (QA set D), by event and channel", async () => {
    const stats = await getUserNotificationStats("u_a", 30, NOW);
    expect(stats.totals).toMatchObject({ sent: 13, delivered: 11, failed: 2, read: 2, clickedNotifications: 5, clicksTotal: 6, reactions: 6, measurable: 9, unmeasurable: 2 });
    expect(stats.byChannel.map((r) => r.channel)).toEqual(["TELEGRAM", "PUSH", "EMAIL", "IN_APP"]);
    expect(stats.byEvent).toHaveLength(MANAGED_EVENT_TYPES.length);
    const [aggregate] = sqlCalls("notification-stats:aggregate");
    expect(aggregate.values).toContainEqual(["u_a"]);
  });

  it("AC-D2.2: recent items — labels and reactions, no payload, no externalId", async () => {
    const stats = await getUserNotificationStats("u_a", 30, NOW);
    expect(stats.recent.map((r) => r.statusLabel)).toEqual(["Пропущено: отключено сотрудником", "Ошибка: бот заблокирован", "Доставлено"]);
    expect(stats.recent[2].reaction).toEqual({ kind: "read", afterSeconds: 1200 });
    const [recent] = sqlCalls("notification-stats:recent");
    expect(recent.text).not.toMatch(/payload/i);
    expect(recent.text).toContain("LIMIT");
    expect(recent.values).toContain(20);
    expect(JSON.stringify(stats)).not.toMatch(/externalId|payload/);
  });

  it("AC-D4.1: problems split by bot reason + current bot state", async () => {
    const stats = await getUserNotificationStats("u_a", 30, NOW);
    expect(stats.problems).toEqual({
      botNotStarted: false,
      botBlocked: true,
      failedByBot: 2,
      failedBotNotStarted: 1,
      failedBotBlocked: 1,
    });
    expect(mockGetBotContacts).toHaveBeenCalledWith(["1001"]);
  });

  it("unknown user → USER_NOT_FOUND (404)", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(getUserNotificationStats("nope", 30, NOW)).rejects.toMatchObject({
      constructor: NotificationDomainError,
      code: "USER_NOT_FOUND",
      status: 404,
    });
  });

  it("AC-D1.7: someone outside the team (client, merged) gets no SQL at all — only team members are counted", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "u_c", role: "USER", mergedIntoUserId: null, telegramId: null });
    const client = await getUserNotificationStats("u_c", 30, NOW);
    expect(sqlCalls("notification-stats:aggregate")).toHaveLength(0);
    expect(sqlCalls("notification-stats:recent")).toHaveLength(0);
    expect(mockSkipGroupBy).not.toHaveBeenCalled();
    expect(client.totals.sent).toBe(0);
    expect(client.recent).toEqual([]);

    mockUserFindUnique.mockResolvedValue({ id: "u_m", role: "MANAGER", mergedIntoUserId: "u_a", telegramId: null });
    const merged = await getUserNotificationStats("u_m", 30, NOW);
    expect(merged.totals.sent).toBe(0);
    expect(merged.problems.botNotStarted).toBe(false);
  });
});
