import { describe, it, expect, vi } from "vitest";
import type { NotificationEventPreference, NotificationGlobalPreference, UserNotificationChannel } from "@prisma/client";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildExplain, pathLabel } from "../explain";
import type { StaffSnapshot } from "../audience-rules";
import type { BotStatus } from "@/modules/telegram-link/bot-contact";

const NOW = new Date("2026-10-25T10:00:00Z");

function snap(partial: Partial<StaffSnapshot> = {}): StaffSnapshot {
  return {
    id: "u1",
    role: "MANAGER",
    merged: false,
    grants: new Set(["gazebos"]),
    assignments: new Set(),
    prefs: new Map(),
    listModules: new Set(),
    ...partial,
  };
}

function channel(partial: Partial<UserNotificationChannel>): UserNotificationChannel {
  return {
    id: "c1", userId: "u1", kind: "TELEGRAM", address: "555", label: null, priority: 10,
    isActive: true, verifiedAt: new Date("2026-01-01"), createdAt: NOW, updatedAt: NOW,
    ...partial,
  } as UserNotificationChannel;
}

function prefRow(eventType: string, enabled: boolean, extra: Partial<NotificationEventPreference> = {}): NotificationEventPreference {
  return {
    id: "p", userId: "u1", eventType, enabled, channelKinds: [], quietHoursFrom: null, quietHoursTo: null,
    quietWeekdaysOnly: false, timezone: "Europe/Moscow", dndUntil: null, updatedByUserId: null, updatedVia: null,
    createdAt: NOW, updatedAt: NOW, ...extra,
  } as NotificationEventPreference;
}

function explain(opts: {
  snapshot?: StaffSnapshot;
  channels?: UserNotificationChannel[];
  prefRows?: NotificationEventPreference[];
  global?: Partial<NotificationGlobalPreference> | null;
  bot?: BotStatus;
  groupChat?: Map<string, boolean>;
  actorNames?: Map<string, string | null>;
}) {
  return buildExplain({
    snapshot: opts.snapshot ?? snap(),
    telegramId: "555",
    channels: opts.channels ?? [channel({})],
    prefRows: new Map((opts.prefRows ?? []).map((r) => [r.eventType, r])),
    global: (opts.global ?? null) as NotificationGlobalPreference | null,
    botStatus: opts.bot ?? { state: "STARTED", startedAt: null },
    groupChat: opts.groupChat ?? new Map(),
    actorNames: opts.actorNames ?? new Map(),
    channelAvailable: () => true,
    now: NOW,
  });
}

const ev = (e: ReturnType<typeof explain>, type: string) => e.categories.flatMap((c) => c.events).find((x) => x.eventType === type)!;
const cat = (e: ReturnType<typeof explain>, key: string) => e.categories.find((c) => c.key === key)!;

describe("buildExplain — статусы (AC-C1.1, AC-C1.2)", () => {
  it("всё 12 событий каталога по категориям; без доступа — серым с причиной", () => {
    const e = explain({});
    expect(e.categories.flatMap((c) => c.events)).toHaveLength(12);
    expect(cat(e, "cafe").access).toMatchObject({ ok: false, label: "Нет доступа к разделу «Кафе»" });
    expect(ev(e, "order.placed").status).toBe("NO_ACCESS");
    expect(cat(e, "telephony").access).toMatchObject({ ok: false, label: "Только для суперадмина" });
  });

  it("доступ без маршрута → «Не получает», тумблер редактируемый", () => {
    const e = explain({});
    expect(ev(e, "booking.created")).toMatchObject({ status: "NOT_RECEIVING", toggle: { enabled: false, editable: true, source: "default" } });
  });

  it("список раздела → «Получает» с путём и каналом", () => {
    const e = explain({ snapshot: snap({ listModules: new Set(["gazebos"]) }) });
    const b = ev(e, "booking.created");
    expect(b.status).toBe("RECEIVES");
    expect(b.paths).toEqual([{ kind: "module_list", label: "Список получателей раздела «Барбекю Парк»", moduleSlug: "gazebos" }]);
    expect(b.deliveryChannels).toEqual([{ kind: "TELEGRAM", label: "Telegram" }]);
    expect(b.contexts).toEqual([
      { moduleSlug: "gazebos", receives: true, paths: ["module_list"] },
      { moduleSlug: "ps-park", receives: false, paths: [] },
    ]);
  });

  it("явное «выкл» → «Не получает» с актором (AC-C2.3)", () => {
    const e = explain({
      snapshot: snap({ listModules: new Set(["gazebos"]), prefs: new Map([["booking.created", { enabled: false }]]) }),
      prefRows: [prefRow("booking.created", false, { updatedByUserId: "boss", updatedVia: "admin" })],
      actorNames: new Map([["boss", "Владелец"]]),
    });
    const b = ev(e, "booking.created");
    expect(b.status).toBe("NOT_RECEIVING");
    expect(b.blockers).toEqual([{ code: "OPTED_OUT", label: "Отключено: Владелец" }]);
    expect(b.lastChange).toMatchObject({ byName: "Владелец", via: "admin" });
    expect(b.toggle).toMatchObject({ enabled: false, source: "explicit" });
  });
});

describe("buildExplain — доставка и блокировки (AC-C1.4, AC-C1.5)", () => {
  const listed = snap({ listModules: new Set(["gazebos"]) });

  it("бот не запущен / заблокирован → «Подписан, но не дойдёт»", () => {
    let b = ev(explain({ snapshot: listed, bot: { state: "NOT_STARTED", trackingSince: null } }), "booking.created");
    expect(b).toMatchObject({ status: "BLOCKED", blockers: [{ code: "BOT_NOT_STARTED", label: "Бот не запущен" }] });
    b = ev(explain({ snapshot: listed, bot: { state: "BLOCKED", blockedAt: NOW } }), "booking.created");
    expect(b.blockers).toEqual([{ code: "BOT_BLOCKED", label: "Бот заблокирован" }]);
  });

  it("запасной канал спасает доставку, порядок — основной, затем запасной", () => {
    const e = explain({
      snapshot: listed,
      bot: { state: "BLOCKED", blockedAt: NOW },
      channels: [channel({}), channel({ id: "c2", kind: "PUSH", address: "https://push", priority: 50 })],
    });
    const b = ev(e, "booking.created");
    expect(b.status).toBe("RECEIVES");
    expect(b.deliveryChannels.map((c) => c.kind)).toEqual(["TELEGRAM", "PUSH"]);
    expect(e.channels).toEqual([
      expect.objectContaining({ kind: "TELEGRAM", order: 1, deliverable: false, note: "Бот заблокирован" }),
      expect.objectContaining({ kind: "PUSH", order: 2, deliverable: true }),
    ]);
  });

  it("нет каналов → «Нет канала доставки»; отключённый канал → «Канал отключён»", () => {
    expect(ev(explain({ snapshot: listed, channels: [] }), "booking.created").blockers[0].code).toBe("NO_CHANNEL");
    expect(ev(explain({ snapshot: listed, channels: [channel({ isActive: false })] }), "booking.created").blockers[0]).toEqual({
      code: "CHANNEL_DISABLED", label: "Канал отключён",
    });
  });

  it("DND блокирует; тихие часы — только заметка (откладывают, а не теряют)", () => {
    const dnd = ev(explain({ snapshot: listed, global: { dndUntil: new Date("2026-10-25T15:00:00Z") } }), "booking.created");
    expect(dnd.status).toBe("BLOCKED");
    expect(dnd.blockers).toEqual([{ code: "DND", label: "Не беспокоить до 18:00" }]);
    const quiet = ev(explain({ snapshot: listed, global: { quietHoursFrom: "22:00", quietHoursTo: "08:00" } }), "booking.created");
    expect(quiet.status).toBe("RECEIVES");
    expect(quiet.notes).toEqual([{ code: "QUIET_HOURS", label: "Тихие часы 22:00–08:00: доставка откладывается" }]);
  });

  it("сводка звонков — лента Mini App, без каналов и блокировок бота", () => {
    const sa = snap({ role: "SUPERADMIN" });
    const t = ev(explain({ snapshot: sa, channels: [], bot: { state: "NOT_STARTED", trackingSince: null } }), "telephony.daily_summary");
    expect(t).toMatchObject({ status: "RECEIVES", deliveryChannels: [{ kind: "IN_APP", label: "Лента Mini App" }], blockers: [] });
  });

  it("строка общего чата по каждому модулю категории (AC-C1.7)", () => {
    const e = explain({ groupChat: new Map([["gazebos", true], ["ps-park", false]]) });
    expect(cat(e, "bookings").groupChat).toEqual([
      { moduleSlug: "gazebos", moduleLabel: "Барбекю Парк", receives: true },
      { moduleSlug: "ps-park", moduleLabel: "Плей Парк", receives: false },
    ]);
  });
});

describe("pathLabel (AC-C1.3)", () => {
  it("русские формулировки путей", () => {
    expect(pathLabel("personal", null)).toBe("Личная подписка");
    expect(pathLabel("module_list", "cafe")).toBe("Список получателей раздела «Кафе»");
    expect(pathLabel("role_avito", null)).toMatch(/^По роли \(Авито/);
    expect(pathLabel("in_app_superadmin", null)).toMatch(/^Лента Mini App/);
  });
});
