import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    broadcastCampaign: { findMany: vi.fn() },
    notificationGlobalPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getWebappFeed, markFeedRead } from "../feed";

// ── Крошечная in-memory «БД» ────────────────────────────────────────────────
// Моки реально применяют where/take/orderBy: иначе тест «таргетированная
// кампания не видна» проверял бы фикстуру, а не фильтр в сервисе.

type MockFn = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  outgoingNotification: { findMany: MockFn; count: MockFn; updateMany: MockFn };
  broadcastCampaign: { findMany: MockFn };
  notificationGlobalPreference: { findUnique: MockFn; upsert: MockFn };
};

interface WhereClause {
  userId?: string;
  entityType?: string;
  entityId?: { in: string[] };
  id?: { in: string[] };
  readAt?: null;
  createdAt?: { lt?: Date; lte?: Date; gt?: Date };
  segmentKey?: string;
  status?: { in: string[] };
}

interface QueryArgs {
  where?: WhereClause;
  take?: number;
  select?: Record<string, boolean>;
  data?: { readAt?: Date };
}

interface OutgoingFixture {
  id: string;
  userId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
  dedupKey: string;
}

interface CampaignFixture {
  id: string;
  segmentKey: string;
  status: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}

const USER = "user-1";
const OTHER_USER = "user-2";

const state: {
  outgoing: OutgoingFixture[];
  campaigns: CampaignFixture[];
  feedSeenAt: Date | null;
} = { outgoing: [], campaigns: [], feedSeenAt: null };

function D(iso: string): Date {
  return new Date(iso);
}

function outgoing(row: Partial<OutgoingFixture> & { id: string; createdAt: Date }): OutgoingFixture {
  return {
    userId: USER,
    eventType: "booking.created",
    entityType: "gazebos",
    entityId: "bk-1",
    payload: { title: "Бронь подтверждена", body: "Беседка №3" },
    readAt: null,
    dedupKey: `dedup-${row.id}`,
    ...row,
  };
}

function campaign(row: Partial<CampaignFixture> & { id: string; createdAt: Date }): CampaignFixture {
  return {
    segmentKey: "all_verified_users",
    status: "completed",
    eventType: "BROADCAST",
    payload: { title: "Новости парка", body: "Открылась новая беседка" },
    ...row,
  };
}

function matchesOutgoing(row: OutgoingFixture, where: WhereClause = {}): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.entityType && row.entityType !== where.entityType) return false;
  if (where.entityId?.in && !(row.entityId && where.entityId.in.includes(row.entityId))) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  if (where.readAt === null && row.readAt !== null) return false;
  if (where.createdAt?.lt && !(row.createdAt < where.createdAt.lt)) return false;
  if (where.createdAt?.lte && !(row.createdAt <= where.createdAt.lte)) return false;
  return true;
}

function matchesCampaign(row: CampaignFixture, where: WhereClause = {}): boolean {
  if (where.segmentKey && row.segmentKey !== where.segmentKey) return false;
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  if (where.createdAt?.lt && !(row.createdAt < where.createdAt.lt)) return false;
  if (where.createdAt?.gt && !(row.createdAt > where.createdAt.gt)) return false;
  return true;
}

function byCreatedAtDesc<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

beforeEach(() => {
  vi.clearAllMocks();
  state.outgoing = [];
  state.campaigns = [];
  state.feedSeenAt = null;

  db.outgoingNotification.findMany.mockImplementation((args: QueryArgs = {}) => {
    const rows = byCreatedAtDesc(state.outgoing.filter((r) => matchesOutgoing(r, args.where)));
    return Promise.resolve(args.take ? rows.slice(0, args.take) : rows);
  });

  db.outgoingNotification.count.mockImplementation((args: QueryArgs = {}) =>
    Promise.resolve(state.outgoing.filter((r) => matchesOutgoing(r, args.where)).length)
  );

  db.outgoingNotification.updateMany.mockImplementation((args: QueryArgs = {}) => {
    const targets = state.outgoing.filter((r) => matchesOutgoing(r, args.where));
    for (const row of targets) {
      if (args.data?.readAt) row.readAt = args.data.readAt;
    }
    return Promise.resolve({ count: targets.length });
  });

  db.broadcastCampaign.findMany.mockImplementation((args: QueryArgs = {}) => {
    const rows = byCreatedAtDesc(state.campaigns.filter((r) => matchesCampaign(r, args.where)));
    return Promise.resolve(args.take ? rows.slice(0, args.take) : rows);
  });

  db.notificationGlobalPreference.findUnique.mockImplementation(() =>
    Promise.resolve({ feedSeenAt: state.feedSeenAt })
  );

  db.notificationGlobalPreference.upsert.mockImplementation(
    (args: { create?: { feedSeenAt?: Date }; update?: { feedSeenAt?: Date } }) => {
      state.feedSeenAt = args.update?.feedSeenAt ?? args.create?.feedSeenAt ?? null;
      return Promise.resolve({ userId: USER, feedSeenAt: state.feedSeenAt });
    }
  );
});

describe("getWebappFeed — слияние источников", () => {
  it("сливает персональные записи и новости парка, сортирует createdAt desc", async () => {
    state.outgoing = [
      outgoing({ id: "p-old", createdAt: D("2026-08-13T08:00:00.000Z") }),
      outgoing({ id: "p-new", createdAt: D("2026-08-13T10:00:00.000Z") }),
    ];
    state.campaigns = [campaign({ id: "c-mid", createdAt: D("2026-08-13T09:00:00.000Z") })];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items.map((i) => i.id)).toEqual(["on:p-new", "bc:c-mid", "on:p-old"]);
    expect(feed.items.map((i) => i.kind)).toEqual(["personal", "news", "personal"]);
  });

  it("схлопывает fallback-цепочку по dedupKey до самой свежей строки", async () => {
    state.outgoing = [
      outgoing({
        id: "first-try",
        dedupKey: "same-key",
        createdAt: D("2026-08-13T10:00:00.000Z"),
        payload: { title: "Первая попытка", body: "Telegram" },
      }),
      outgoing({
        id: "fallback",
        dedupKey: "same-key",
        createdAt: D("2026-08-13T10:05:00.000Z"),
        payload: { title: "Повтор через email", body: "Email" },
      }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].id).toBe("on:fallback");
    expect(feed.items[0].title).toBe("Повтор через email");
  });

  it("не дублирует кампанию, доставленную персонально", async () => {
    state.outgoing = [
      outgoing({
        id: "delivered",
        eventType: "BROADCAST",
        entityType: "BroadcastCampaign",
        entityId: "camp-1",
        createdAt: D("2026-08-13T09:00:01.000Z"),
        payload: { title: "Новости парка", body: "Персональная копия" },
      }),
    ];
    state.campaigns = [campaign({ id: "camp-1", createdAt: D("2026-08-13T09:00:00.000Z") })];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items.map((i) => i.id)).toEqual(["on:delivered"]);
    // Доставленная рассылка — это новость, а не персональное событие.
    expect(feed.items[0].kind).toBe("news");
  });

  it("показывает all_verified_users и скрывает таргетированную кампанию без персональной копии", async () => {
    state.campaigns = [
      campaign({ id: "public", createdAt: D("2026-08-13T09:00:00.000Z") }),
      campaign({
        id: "tenants-only",
        segmentKey: "active_office_tenants",
        createdAt: D("2026-08-13T09:30:00.000Z"),
      }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items.map((i) => i.id)).toEqual(["bc:public"]);
  });

  it("не показывает черновик рассылки (status вне running/completed)", async () => {
    state.campaigns = [
      campaign({ id: "draft", status: "draft", createdAt: D("2026-08-13T09:00:00.000Z") }),
      campaign({ id: "running", status: "running", createdAt: D("2026-08-13T08:00:00.000Z") }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items.map((i) => i.id)).toEqual(["bc:running"]);
  });

  it("читает только свои персональные записи", async () => {
    state.outgoing = [
      outgoing({ id: "mine", createdAt: D("2026-08-13T10:00:00.000Z") }),
      outgoing({ id: "foreign", userId: OTHER_USER, createdAt: D("2026-08-13T11:00:00.000Z") }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items.map((i) => i.id)).toEqual(["on:mine"]);
  });
});

describe("getWebappFeed — контракт элемента", () => {
  it("отдаёт поля ADR §3.1: префикс id, ISO-даты, moduleSlug", async () => {
    state.outgoing = [
      outgoing({
        id: "n-1",
        entityType: "gazebos",
        createdAt: D("2026-08-13T09:00:00.000Z"),
        readAt: D("2026-08-13T09:30:00.000Z"),
        payload: {
          title: "Бронь подтверждена",
          body: "Беседка №3, 14 августа 14:00–18:00",
          actions: [{ label: "Открыть", url: "/webapp/bookings" }],
        },
      }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items[0]).toEqual({
      id: "on:n-1",
      kind: "personal",
      eventType: "booking.created",
      title: "Бронь подтверждена",
      body: "Беседка №3, 14 августа 14:00–18:00",
      actions: [{ label: "Открыть", url: "/webapp/bookings" }],
      createdAt: "2026-08-13T09:00:00.000Z",
      readAt: "2026-08-13T09:30:00.000Z",
      moduleSlug: "gazebos",
    });
  });

  it("выводит moduleSlug из типа события, когда entityType не slug модуля", async () => {
    state.outgoing = [
      outgoing({
        id: "n-2",
        eventType: "order.placed",
        entityType: "Order",
        createdAt: D("2026-08-13T09:00:00.000Z"),
      }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items[0].moduleSlug).toBe("cafe");
  });

  it("ограничивает limit сверху (защита при прямом вызове сервиса)", async () => {
    state.outgoing = Array.from({ length: 60 }, (_, index) =>
      outgoing({
        id: `n-${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 13, 0, index)),
      })
    );

    const feed = await getWebappFeed(USER, { limit: 500 });

    expect(feed.items).toHaveLength(50);
    expect(feed.nextCursor).not.toBeNull();
  });
});

describe("getWebappFeed — пагинация", () => {
  it("cursor отсекает более старые записи, nextCursor = createdAt последнего", async () => {
    state.outgoing = [
      outgoing({ id: "p1", createdAt: D("2026-08-13T10:00:00.000Z") }),
      outgoing({ id: "p2", createdAt: D("2026-08-13T09:00:00.000Z") }),
      outgoing({ id: "p3", createdAt: D("2026-08-13T08:00:00.000Z") }),
    ];

    const first = await getWebappFeed(USER, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(["on:p1", "on:p2"]);
    expect(first.nextCursor).toBe("2026-08-13T09:00:00.000Z");

    const second = await getWebappFeed(USER, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((i) => i.id)).toEqual(["on:p3"]);
    expect(second.nextCursor).toBeNull();
  });

  it("отдаёт nextCursor: null, когда лента пуста", async () => {
    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items).toEqual([]);
    expect(feed.nextCursor).toBeNull();
    expect(feed.unreadCount).toBe(0);
  });
});

describe("getWebappFeed — unreadCount", () => {
  it("считает персональные без readAt и новости свежее feedSeenAt", async () => {
    state.feedSeenAt = D("2026-08-13T08:30:00.000Z");
    state.outgoing = [
      outgoing({ id: "unread-1", createdAt: D("2026-08-13T10:00:00.000Z") }),
      outgoing({ id: "unread-2", createdAt: D("2026-08-13T09:00:00.000Z") }),
      outgoing({
        id: "already-read",
        createdAt: D("2026-08-13T07:00:00.000Z"),
        readAt: D("2026-08-13T07:05:00.000Z"),
      }),
      outgoing({ id: "foreign", userId: OTHER_USER, createdAt: D("2026-08-13T10:30:00.000Z") }),
    ];
    state.campaigns = [
      campaign({ id: "fresh-news", createdAt: D("2026-08-13T09:30:00.000Z") }),
      campaign({ id: "seen-news", createdAt: D("2026-08-13T07:00:00.000Z") }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.unreadCount).toBe(3);
  });

  it("не считает новость дважды, если она доставлена персонально", async () => {
    state.feedSeenAt = null;
    state.outgoing = [
      outgoing({
        id: "delivered",
        eventType: "BROADCAST",
        entityType: "BroadcastCampaign",
        entityId: "camp-1",
        createdAt: D("2026-08-13T09:00:01.000Z"),
      }),
    ];
    state.campaigns = [campaign({ id: "camp-1", createdAt: D("2026-08-13T09:00:00.000Z") })];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.unreadCount).toBe(1);
  });

  it("помечает новость прочитанной по watermark", async () => {
    state.feedSeenAt = D("2026-08-13T12:00:00.000Z");
    state.campaigns = [campaign({ id: "old-news", createdAt: D("2026-08-13T09:00:00.000Z") })];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items[0].readAt).toBe("2026-08-13T12:00:00.000Z");
    expect(feed.unreadCount).toBe(0);
  });
});

describe("getWebappFeed — санитизация actions[].url", () => {
  it("вырезает javascript:, tg:// и protocol-relative, сохраняет https:// и /webapp/...", async () => {
    state.outgoing = [
      outgoing({
        id: "p1",
        createdAt: D("2026-08-13T10:00:00.000Z"),
        payload: {
          title: "Бронь",
          body: "Текст",
          actions: [
            { label: "XSS", url: "javascript:alert(1)" },
            { label: "Телега", url: "tg://resolve?domain=evil" },
            { label: "Данные", url: "data:text/html,<script>alert(1)</script>" },
            { label: "Протокол-релативная", url: "//evil.example/steal" },
            { label: "Сайт", url: "https://delovoy.example/news" },
            { label: "Мои брони", url: "/webapp/bookings" },
          ],
        },
      }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items[0].actions).toEqual([
      { label: "Сайт", url: "https://delovoy.example/news" },
      { label: "Мои брони", url: "/webapp/bookings" },
    ]);
  });

  it("переживает мусорный payload без падения", async () => {
    state.outgoing = [
      outgoing({ id: "broken", createdAt: D("2026-08-13T10:00:00.000Z"), payload: "не объект" }),
    ];

    const feed = await getWebappFeed(USER, { limit: 20 });

    expect(feed.items[0]).toMatchObject({ title: "Уведомление", body: "", actions: [] });
  });
});

describe("markFeedRead", () => {
  it("upTo: проставляет readAt только своим строкам и двигает feedSeenAt", async () => {
    const upTo = "2026-08-13T10:00:00.000Z";
    state.outgoing = [
      outgoing({ id: "mine-old", createdAt: D("2026-08-13T09:00:00.000Z") }),
      outgoing({ id: "mine-new", createdAt: D("2026-08-13T11:00:00.000Z") }),
      outgoing({ id: "foreign", userId: OTHER_USER, createdAt: D("2026-08-13T09:00:00.000Z") }),
    ];

    const result = await markFeedRead(USER, { upTo });

    expect(result.updated).toBe(1);
    expect(state.outgoing.find((r) => r.id === "mine-old")?.readAt).toBeInstanceOf(Date);
    expect(state.outgoing.find((r) => r.id === "mine-new")?.readAt).toBeNull();
    expect(state.outgoing.find((r) => r.id === "foreign")?.readAt).toBeNull();

    const updateArgs = db.outgoingNotification.updateMany.mock.calls[0][0] as QueryArgs;
    expect(updateArgs.where?.userId).toBe(USER);

    expect(result.feedSeenAt).toBe(upTo);
    expect(state.feedSeenAt).toEqual(D(upTo));
    expect(result.unreadCount).toBe(1);
  });

  it("ids: обновляет только перечисленные свои строки, чужой id ничего не задевает", async () => {
    state.outgoing = [
      outgoing({ id: "mine", createdAt: D("2026-08-13T09:00:00.000Z") }),
      outgoing({ id: "mine-other", createdAt: D("2026-08-13T09:30:00.000Z") }),
      outgoing({ id: "foreign", userId: OTHER_USER, createdAt: D("2026-08-13T09:00:00.000Z") }),
    ];

    const result = await markFeedRead(USER, { ids: ["on:mine", "on:foreign"] });

    expect(result.updated).toBe(1);
    expect(state.outgoing.find((r) => r.id === "mine")?.readAt).toBeInstanceOf(Date);
    expect(state.outgoing.find((r) => r.id === "foreign")?.readAt).toBeNull();
    expect(state.outgoing.find((r) => r.id === "mine-other")?.readAt).toBeNull();

    const updateArgs = db.outgoingNotification.updateMany.mock.calls[0][0] as QueryArgs;
    expect(updateArgs.where).toMatchObject({ userId: USER, id: { in: ["mine", "foreign"] } });
  });

  it("ids новостей двигают watermark до createdAt кампании", async () => {
    state.campaigns = [campaign({ id: "camp-1", createdAt: D("2026-08-13T09:00:00.000Z") })];

    const result = await markFeedRead(USER, { ids: ["bc:camp-1"] });

    expect(result.feedSeenAt).toBe("2026-08-13T09:00:00.000Z");
    expect(result.unreadCount).toBe(0);
  });

  it("не двигает feedSeenAt назад", async () => {
    state.feedSeenAt = D("2026-08-13T12:00:00.000Z");

    const result = await markFeedRead(USER, { upTo: "2026-08-13T09:00:00.000Z" });

    expect(db.notificationGlobalPreference.upsert).not.toHaveBeenCalled();
    expect(result.feedSeenAt).toBe("2026-08-13T12:00:00.000Z");
    expect(state.feedSeenAt).toEqual(D("2026-08-13T12:00:00.000Z"));
  });

  it("игнорирует id без известного префикса и не пишет в БД впустую", async () => {
    const result = await markFeedRead(USER, { ids: ["evil-raw-id"] });

    expect(db.outgoingNotification.updateMany).not.toHaveBeenCalled();
    expect(db.notificationGlobalPreference.upsert).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });
});
