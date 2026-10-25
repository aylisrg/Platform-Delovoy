import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    notificationLog: { create: vi.fn() },
    booking: { findUnique: vi.fn() },
    resource: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("../channels/telegram", () => ({
  telegramAdapter: {
    channel: "TELEGRAM",
    send: vi.fn(),
    resolveRecipient: vi.fn(),
  },
}));

vi.mock("../dispatch/dispatcher", () => ({
  dispatch: vi.fn(),
}));

const mockRecordSkips = vi.fn();
vi.mock("../skips", () => ({ recordSkips: (...a: unknown[]) => mockRecordSkips(...a) }));

import { prisma } from "@/lib/db";
import { installStaffFixtures, type StaffFixture } from "./helpers/staff-fixture";
import { telegramAdapter } from "../channels/telegram";
import { dispatch } from "../dispatch/dispatcher";
import { notify } from "../service";
import type { NotificationEvent } from "../types";

const cancelledEvent: NotificationEvent = {
  type: "booking.cancelled",
  moduleSlug: "gazebos",
  entityId: "b1",
  actor: "admin",
  data: {
    resourceName: "Беседка №1",
    date: "2026-07-01",
    startTime: "10:00",
    endTime: "14:00",
    userName: "Иванов",
  },
};

function mockGazebosConfig(config: Record<string, unknown> | null) {
  vi.mocked(prisma.module.findUnique).mockImplementation(((
    { where }: { where: { slug: string } }
  ) => {
    if (where.slug === "gazebos") {
      return Promise.resolve(config === null ? null : { config });
    }
    // "system" global fallback lookup — no global chat configured by default.
    return Promise.resolve({ config: {} });
  }) as never);
}

// Staff seen by the real recipient resolver (ADR 2026-10-25 §Q7).
let staff: StaffFixture[] = [];
/** On the gazebos recipient list (was Module.config.notificationRecipients). */
const listed = (id: string): StaffFixture => ({ id, role: "MANAGER", assignments: ["gazebos"], lists: ["gazebos"] });
/** Turned the event on in the Mini App Center, has the section. */
const subscribed = (id: string, eventType: string): StaffFixture => ({
  id, role: "MANAGER", grants: ["gazebos"], prefs: { [eventType]: true },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
  staff = [];
  installStaffFixtures(prisma as never, () => staff);
  vi.mocked(telegramAdapter.send).mockResolvedValue({ success: true });
  vi.mocked(prisma.notificationLog.create).mockResolvedValue({} as never);
  vi.mocked(dispatch).mockResolvedValue({ status: "skipped", reason: "test" });
  vi.mocked(prisma.booking.findUnique).mockResolvedValue(null);
});

describe("notifyAdmin — telegramAdminChatEnabled kill switch", () => {
  it("sends to the group chat when enabled (default, unset)", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.send).toHaveBeenCalledWith(
      "-100111",
      expect.any(String),
      expect.anything()
    );
  });

  it("skips the group chat entirely when explicitly disabled, with no fallback", async () => {
    mockGazebosConfig({
      telegramAdminChatId: "-100111",
      telegramAdminChatEnabled: false,
    });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("does not fall back to the global admin chat when disabled", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100global");
    mockGazebosConfig({ telegramAdminChatEnabled: false });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("still delivers to explicit per-user recipients when the group chat is disabled", async () => {
    mockGazebosConfig({
      telegramAdminChatId: "-100111",
      telegramAdminChatEnabled: false,
    });
    staff = [listed("user-1")];

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" })
    );
  });
});

// Путь 2b (ADR 2026-08-13 §3.3): тумблеры Центра уведомлений должны работать
// для тех, кого нет в Module.config.notificationRecipients — но не ценой
// регресса группового чата.
describe("notifyAdmin — путь 2b: самоподписанные сотрудники", () => {
  it("самоподписанный с доступом к секции получает персональный dispatch", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [subscribed("self-1", "booking.cancelled")];

    await notify(cancelledEvent);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "self-1",
        eventType: "booking.cancelled",
        entityType: "gazebos",
        entityId: "b1",
      })
    );
  });

  it("подписка без доступа к разделу (и без назначения) не даёт доставки", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [{ id: "cafe-only", role: "MANAGER", grants: ["cafe"], prefs: { "booking.cancelled": true } }];

    await notify(cancelledEvent);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("групповая отправка (путь 1) сохраняется при наличии самоподписанных", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [subscribed("self-1", "booking.cancelled")];

    await notify(cancelledEvent);

    expect(telegramAdapter.send).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.send).toHaveBeenCalledWith(
      "-100111",
      expect.any(String),
      expect.anything()
    );
  });

  it("без явных подписок поведение не меняется — dispatch не вызывается", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });

    await notify(cancelledEvent);

    expect(dispatch).not.toHaveBeenCalled();
    expect(telegramAdapter.send).toHaveBeenCalledTimes(1);
  });

  it("не дублирует dispatch тому, кто уже в explicit-получателях", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [
      { ...listed("user-1"), prefs: { "booking.cancelled": true } },
      subscribed("self-2", "booking.cancelled"),
    ];

    await notify(cancelledEvent);

    const dispatched = vi
      .mocked(dispatch)
      .mock.calls.map(([arg]) => arg.userId);
    expect(dispatched.filter((id) => id === "user-1")).toHaveLength(1);
    expect(dispatched).toContain("self-2");
    expect(dispatched).toHaveLength(2);
  });

  it("самоподписанный получает уведомление и при выключенном групповом чате", async () => {
    mockGazebosConfig({
      telegramAdminChatId: "-100111",
      telegramAdminChatEnabled: false,
    });
    staff = [subscribed("self-1", "booking.cancelled")];

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "self-1" })
    );
  });
});

// Сообщение в админ-чат раньше ждало `userName`, которого не передавало ни
// одно место вызова, — в чат уходило пустое «Клиент:». Контакт клиента и
// ссылку на бронь notifyAdmin теперь берёт из самой брони.
describe("notifyAdmin — контекст брони для текста", () => {
  const sentText = () => vi.mocked(telegramAdapter.send).mock.calls[0][1];

  it("подставляет имя и телефон клиента из профиля и ссылку на бронь", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      resourceId: "r1",
      date: new Date("2026-10-10T00:00:00Z"),
      startTime: new Date("2026-10-10T13:00:00Z"),
      endTime: new Date("2026-10-10T19:00:00Z"),
      clientName: null,
      clientPhone: null,
      user: { name: "Иван Петров", phone: "+79991234567" },
    } as never);

    await notify({
      type: "booking.created",
      moduleSlug: "gazebos",
      entityId: "b1",
      actor: "client",
      data: { resourceName: "Беседка №3", date: "2026-10-10", startTime: "16:00", endTime: "22:00" },
    });

    expect(prisma.booking.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1" } })
    );
    expect(sentText()).toContain("👤 Иван Петров · +79991234567");
    expect(sentText()).toContain("https://delovoy-park.ru/admin/gazebos/bookings/b1");
    expect(sentText()).not.toContain("Требуется подтверждение");
  });

  it("гостевая бронь: контакт с самой брони важнее профиля", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      resourceId: "r1",
      date: new Date("2026-10-10T00:00:00Z"),
      startTime: new Date("2026-10-10T13:00:00Z"),
      endTime: new Date("2026-10-10T19:00:00Z"),
      clientName: "Гость Мария",
      clientPhone: "+79990000000",
      user: null,
    } as never);

    await notify(cancelledEvent);

    expect(sentText()).toContain("Гость Мария · +79990000000");
    // actor события превращается в «кто отменил».
    expect(sentText()).toContain("Отменена администратором");
  });

  it("платёж по брони: ресурс, слот и клиент берутся из брони", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      status: "CONFIRMED",
      resourceId: "r1",
      date: new Date("2026-10-10T00:00:00Z"),
      startTime: new Date("2026-10-10T13:00:00Z"),
      endTime: new Date("2026-10-10T19:00:00Z"),
      clientName: "Гость Мария",
      clientPhone: null,
      user: null,
    } as never);
    vi.mocked(prisma.resource.findUnique).mockResolvedValue({ name: "Беседка №3" } as never);

    await notify({
      type: "payment.succeeded",
      moduleSlug: "gazebos",
      entityId: "pay1",
      data: { amount: "12 000,00", description: "Беседка", subjectType: "BOOKING", subjectId: "b1" },
    });

    expect(prisma.booking.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1" } })
    );
    expect(sentText()).toContain("Бронь оплачена онлайн: 12 000,00 ₽");
    expect(sentText()).toContain("Беседка №3");
    expect(sentText()).toContain("сб, 10 октября · 16:00–22:00");
    expect(sentText()).toContain("Гость Мария");
  });

  it("платёж пришёл по уже отменённой брони — статус брони попадает в текст", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      status: "CANCELLED",
      resourceId: "r1",
      date: new Date("2026-10-10T00:00:00Z"),
      startTime: new Date("2026-10-10T13:00:00Z"),
      endTime: new Date("2026-10-10T19:00:00Z"),
      clientName: null,
      clientPhone: null,
      user: null,
    } as never);
    vi.mocked(prisma.resource.findUnique).mockResolvedValue({ name: "Беседка №3" } as never);

    await notify({
      type: "payment.succeeded",
      moduleSlug: "gazebos",
      entityId: "pay1",
      data: { amount: "12 000,00", description: "Беседка", subjectType: "BOOKING", subjectId: "b1" },
    });

    expect(sentText()).toContain("Оплата по отменённой брони");
  });

  it("заказ кафе: имя клиента из профиля, без телефона", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { telegramAdminChatId: "-100cafe" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Мария" } as never);

    await notify({
      type: "order.placed",
      moduleSlug: "cafe",
      entityId: "o1",
      userId: "u1",
      actor: "client",
      data: { orderNumber: "A1B2C3", totalAmount: "850", itemCount: 2 },
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { name: true },
    });
    expect(sentText()).toContain("👤 Мария");
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it("ошибка чтения брони не блокирует сообщение", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    vi.mocked(prisma.booking.findUnique).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await notify(cancelledEvent);

    expect(telegramAdapter.send).toHaveBeenCalledTimes(1);
    expect(sentText()).toContain("Бронь отменена");
  });
});

describe("notifyAdmin — staffAudience", () => {
  const personalEvent: NotificationEvent = {
    ...cancelledEvent,
    type: "booking.created",
    staffAudience: "personal",
    data: { ...cancelledEvent.data, paymentFlow: "online", paid: true },
  };

  it("none — персоналу не доставляется вовсе, даже самоподписанным", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [subscribed("self-1", "booking.created")];

    await notify({ ...personalEvent, staffAudience: "none" });

    expect(telegramAdapter.send).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("не шлёт в общий чат", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });

    await notify(personalEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("не уходит в глобальный фолбэк-чат", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100global");
    mockGazebosConfig({});

    await notify(personalEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("явные получатели (замена чата) его не получают, самоподписанные — получают", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [listed("explicit-1"), subscribed("self-1", "booking.created")];

    await notify(personalEvent);

    const dispatched = vi.mocked(dispatch).mock.calls.map(([arg]) => arg.userId);
    expect(dispatched).toEqual(["self-1"]);
  });

  it("самоподписанный, который ещё и явный получатель, всё равно получает", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [{ ...listed("user-1"), prefs: { "booking.created": true } }];

    await notify(personalEvent);

    const dispatched = vi.mocked(dispatch).mock.calls.map(([arg]) => arg.userId);
    expect(dispatched).toEqual(["user-1"]);
  });
});

// ADR 2026-10-25-team-access-notifications §Q7: one resolver, honest toggles.
describe("notifyAdmin — единый резолвер (AC-C2.1, AC-C3.1)", () => {
  it("явное «выкл» перекрывает список раздела и пишется пропуском OPTED_OUT", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [{ ...listed("muted"), prefs: { "booking.cancelled": false } }, listed("user-2")];

    await notify(cancelledEvent);

    expect(vi.mocked(dispatch).mock.calls.map(([arg]) => arg.userId)).toEqual(["user-2"]);
    expect(mockRecordSkips).toHaveBeenCalledWith([
      expect.objectContaining({ userId: "muted", eventType: "booking.cancelled", reason: "OPTED_OUT", entityId: "b1" }),
    ]);
    // the list is not empty → the group chat stays replaced, as before
    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("исключённый (USER) или влитый из списка ничего не получает", async () => {
    mockGazebosConfig({});
    staff = [
      { id: "ex", role: "USER", assignments: ["gazebos"], lists: ["gazebos"] },
      { ...listed("merged"), merged: true },
    ];

    await notify(cancelledEvent);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("SUPERADMIN в списке раздела получает как обычный участник", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });
    staff = [{ id: "sa", role: "SUPERADMIN", lists: ["gazebos"] }];

    await notify(cancelledEvent);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "sa" }));
  });
});
