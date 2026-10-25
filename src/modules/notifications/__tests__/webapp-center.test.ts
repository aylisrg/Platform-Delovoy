import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    userNotificationChannel: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// The Center is a view over the shared explanation (ADR 2026-10-25 §Q7);
// routing itself is covered by audience/explain tests.
const mockExplain = vi.fn();
vi.mock("../explain", () => ({
  explainStaffNotifications: (...a: unknown[]) => mockExplain(...a),
}));
const mockSetSubscription = vi.fn();
vi.mock("../subscriptions", () => ({
  setStaffEventSubscription: (...a: unknown[]) => mockSetSubscription(...a),
}));

import { prisma } from "@/lib/db";
import { NotificationDomainError } from "../errors";
import type { ExplainCategory, ExplainEvent, StaffNotificationExplain } from "../explain";
import {
  CenterError,
  EMPTY_STATE,
  TRANSPARENCY_NOTE,
  ensureTelegramChannel,
  getNotificationCenter,
  setEventPreference,
} from "../webapp-center";

function staff(role: Role, sections: string[] = [], id = "u1") {
  return { id, role, sections };
}

function event(overrides: Partial<ExplainEvent> = {}): ExplainEvent {
  return {
    eventType: "booking.created",
    label: "Новая бронь",
    description: "…",
    status: "NOT_RECEIVING",
    toggle: { enabled: false, editable: true, source: "default" },
    paths: [],
    contexts: [],
    deliveryChannels: [],
    blockers: [],
    notes: [],
    lastChange: null,
    ...overrides,
  };
}

function category(key: string, events: ExplainEvent[], ok = true, delivery: "personal" | "in-app" = "personal"): ExplainCategory {
  return {
    key,
    label: key,
    description: "",
    icon: "bell",
    delivery,
    access: ok ? { ok: true } : { ok: false, reason: "NO_SECTION", label: "Нет доступа" },
    groupChat: [],
    events,
  };
}

function explainWith(categories: ExplainCategory[], botStatus: StaffNotificationExplain["botStatus"] = { state: "STARTED", startedAt: null }) {
  mockExplain.mockResolvedValue(
    new Map([["u1", { userId: "u1", role: "MANAGER", botStatus, channels: [], globalNotes: [], categories }]]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.userNotificationChannel.create).mockResolvedValue({} as never);
  vi.mocked(prisma.userNotificationChannel.update).mockResolvedValue({} as never);
  explainWith([]);
});

describe("getNotificationCenter — правда о доставке (AC-C3.1…C3.6)", () => {
  it("отказывает роли USER и не провижинит канал", async () => {
    await expect(getNotificationCenter(staff("USER"), "555")).rejects.toBeInstanceOf(CenterError);
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
    expect(mockExplain).not.toHaveBeenCalled();
  });

  it("показывает только категории с доступом; канал провижинится до расчёта", async () => {
    explainWith([category("bookings", [event()]), category("cafe", [event({ eventType: "order.placed" })], false)]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.categories.map((c) => c.key)).toEqual(["bookings"]);
    expect(prisma.userNotificationChannel.create).toHaveBeenCalled();
    const createOrder = vi.mocked(prisma.userNotificationChannel.create).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(mockExplain.mock.invocationCallOrder[0]);
  });

  it("участник списка раздела видит «Вкл» с подписью (AC-C3.1)", async () => {
    explainWith([category("bookings", [event({
      status: "RECEIVES",
      toggle: { enabled: true, editable: true, source: "default" },
      paths: [{ kind: "module_list", label: "Список получателей раздела «Барбекю Парк»", moduleSlug: "gazebos" }],
    })])]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.categories[0].events[0]).toMatchObject({
      enabled: true,
      source: "default",
      caption: "Вы в списке получателей раздела «Барбекю Парк»",
    });
    expect(view.categories[0].delivery).toBe("personal");
  });

  it("Авито по роли — «Вкл» с подписью; без маршрута — group", async () => {
    explainWith([
      category("avito", [event({ eventType: "avito.lead.new", toggle: { enabled: true, editable: true, source: "default" }, paths: [{ kind: "role_avito", label: "", moduleSlug: null }] })]),
      category("cafe", [event({ eventType: "order.placed" })]),
    ]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.categories[0].events[0].caption).toBe("По роли: суперадмины и назначенные на модуль");
    expect(view.categories[1].delivery).toBe("group");
    expect(view.categories[1].events[0]).toMatchObject({ enabled: false, caption: null });
  });

  it("in-app категория остаётся in-app; блокировки прокидываются", async () => {
    explainWith([category("telephony", [event({
      eventType: "telephony.daily_summary",
      toggle: { enabled: true, editable: true, source: "default" },
      paths: [{ kind: "in_app_superadmin", label: "", moduleSlug: null }],
      blockers: [{ code: "DND", label: "Не беспокоить до 18:00" }],
    })], true, "in-app")]);
    const view = await getNotificationCenter(staff("SUPERADMIN"), "555");
    expect(view.categories[0].delivery).toBe("in-app");
    expect(view.categories[0].events[0].blockers).toEqual([{ code: "DND", label: "Не беспокоить до 18:00" }]);
  });

  it("пустое состояние без разделов (AC-C3.4) и заметка о прозрачности (AC-C3.6)", async () => {
    explainWith([category("cafe", [event()], false)]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.categories).toEqual([]);
    expect(view.emptyState).toBe(EMPTY_STATE);
    expect(view.transparencyNote).toBe(TRANSPARENCY_NOTE);
    expect(view.protected.length).toBeGreaterThan(0);
  });

  it("AC-C3.4: без разделов, но с «Системными» (видны всем сотрудникам) — пустое состояние всё равно есть", async () => {
    explainWith([
      category("system", [event({ eventType: "system.release" })], true),
      category("cafe", [event()], false),
    ]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.categories.map((c) => c.key)).toEqual(["system"]);
    expect(view.emptyState).toBe(EMPTY_STATE);
  });

  it("есть хоть один раздел кроме «Системных» — пустого состояния нет", async () => {
    explainWith([
      category("system", [event({ eventType: "system.release" })], true),
      category("cafe", [event()], true),
    ]);
    const view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.emptyState).toBeNull();
  });

  it("подсказка «Запустите бота» / «Бот заблокирован» с кнопкой (AC-C3.5)", async () => {
    explainWith([], { state: "NOT_STARTED", trackingSince: null });
    let view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.hint).toMatchObject({ code: "START_BOT", botUrl: expect.stringMatching(/^https:\/\/t\.me\//) });

    explainWith([], { state: "BLOCKED", blockedAt: "2026-10-20T00:00:00.000Z" });
    view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.hint?.code).toBe("UNBLOCK_BOT");

    explainWith([], { state: "STARTED", startedAt: null });
    view = await getNotificationCenter(staff("MANAGER"), "555");
    expect(view.hint).toBeNull();
  });
});

describe("ensureTelegramChannel", () => {
  it("создаёт канал, когда строки нет", async () => {
    const result = await ensureTelegramChannel("u1", "555");

    expect(prisma.userNotificationChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        kind: "TELEGRAM",
        address: "555",
        label: "Telegram",
        priority: 10,
        isActive: true,
        verifiedAt: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      kind: "TELEGRAM",
      status: "active",
      provisionedNow: true,
    });
  });

  it("идемпотентен при повторном вызове (верифицированный активный канал)", async () => {
    vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([
      { id: "c1", address: "555", isActive: true, verifiedAt: new Date() },
    ] as never);

    const result = await ensureTelegramChannel("u1", "555");

    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "TELEGRAM",
      status: "active",
      provisionedNow: false,
    });
  });

  it("проставляет verifiedAt неверифицированному каналу", async () => {
    vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([
      { id: "c1", address: "555", isActive: true, verifiedAt: null },
    ] as never);

    const result = await ensureTelegramChannel("u1", "555");

    expect(prisma.userNotificationChannel.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { verifiedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      kind: "TELEGRAM",
      status: "active",
      provisionedNow: true,
    });
  });

  it("НЕ реактивирует отключённый канал", async () => {
    vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([
      { id: "c1", address: "555", isActive: false, verifiedAt: null },
    ] as never);

    const result = await ensureTelegramChannel("u1", "555");

    expect(prisma.userNotificationChannel.update).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "TELEGRAM",
      status: "inactive",
      provisionedNow: false,
    });
  });

  it("при другом адресе создаёт вторую строку и не трогает старую", async () => {
    vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([
      { id: "c1", address: "old-999", isActive: true, verifiedAt: new Date() },
    ] as never);

    const result = await ensureTelegramChannel("u1", "555");

    expect(prisma.userNotificationChannel.update).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ address: "555" }),
    });
    expect(result.provisionedNow).toBe(true);
  });

  it("без telegramId канал не заводится", async () => {
    const result = await ensureTelegramChannel("u1", null);

    expect(prisma.userNotificationChannel.findMany).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
    expect(result.status).toBe("inactive");
  });

  it("гонка двух открытий Центра (P2002) не роняет запрос", async () => {
    vi.mocked(prisma.userNotificationChannel.create).mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" })
    );

    const result = await ensureTelegramChannel("u1", "555");

    expect(result).toEqual({
      kind: "TELEGRAM",
      status: "active",
      provisionedNow: false,
    });
  });
});

describe("setEventPreference — тот же путь записи, что у суперадмина (AC-C2.2)", () => {
  it("отказывает на eventType вне каталога", async () => {
    await expect(setEventPreference(staff("MANAGER"), "x.y", true)).rejects.toMatchObject({ status: 422 });
    expect(mockSetSubscription).not.toHaveBeenCalled();
  });

  it("отказывает роли USER", async () => {
    await expect(setEventPreference(staff("USER"), "booking.created", true)).rejects.toBeInstanceOf(CenterError);
  });

  it("делегирует setStaffEventSubscription от имени самого сотрудника (via miniapp)", async () => {
    mockSetSubscription.mockResolvedValue({ eventType: "system.release", enabled: false, before: true });
    expect(await setEventPreference(staff("MANAGER"), "system.release", false)).toEqual({ eventType: "system.release", enabled: false });
    expect(mockSetSubscription).toHaveBeenCalledWith({
      targetUserId: "u1",
      eventType: "system.release",
      enabled: false,
      actor: { userId: "u1", via: "miniapp" },
    });
  });

  it("нет доступа к категории → 403 FORBIDDEN", async () => {
    mockSetSubscription.mockRejectedValue(new NotificationDomainError("NO_ACCESS_TO_CATEGORY", "Нет доступа к разделу «Кафе»", 422));
    await expect(setEventPreference(staff("MANAGER"), "order.placed", true)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
