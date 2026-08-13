import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    userNotificationChannel: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notificationEventPreference: { findMany: vi.fn() },
    module: { findMany: vi.fn() },
  },
}));

vi.mock("../dispatch/preferences-service", () => ({
  getPreferences: vi.fn(),
  upsertEventPreference: vi.fn(),
}));

// Трек D владеет release-notify — мокаем, чтобы тесты Центра были независимы
// и проверяли именно маршрутизацию записи (ADR §6.4).
vi.mock("../release-notify", () => ({
  RELEASE_EVENT_TYPE: "system.release",
  setReleaseSubscription: vi.fn(),
}));

import { prisma } from "@/lib/db";
import {
  getPreferences,
  upsertEventPreference,
} from "../dispatch/preferences-service";
import { setReleaseSubscription } from "../release-notify";
import {
  CenterError,
  ensureTelegramChannel,
  getNotificationCenter,
  setEventPreference,
} from "../webapp-center";

function staff(role: Role, sections: string[], id = "u1") {
  return { id, role, sections };
}

function prefs(rows: Array<{ eventType: string; enabled: boolean }>) {
  vi.mocked(getPreferences).mockResolvedValue({
    global: null,
    events: rows,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.userNotificationChannel.create).mockResolvedValue({} as never);
  vi.mocked(prisma.userNotificationChannel.update).mockResolvedValue({} as never);
  // Grandfather-запрос из resolveManagedCategories: строк нет по умолчанию.
  vi.mocked(prisma.notificationEventPreference.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.module.findMany).mockResolvedValue([] as never);
  prefs([]);
});

describe("getNotificationCenter — видимость категорий", () => {
  it("отказывает роли USER (сервис не полагается только на роут)", async () => {
    await expect(
      getNotificationCenter(staff("USER", []), "555")
    ).rejects.toBeInstanceOf(CenterError);
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
  });

  it("MANAGER с одной секцией gazebos видит только «Бронирования»", async () => {
    const view = await getNotificationCenter(staff("MANAGER", ["gazebos"]), "555");

    expect(view.categories.map((c) => c.key)).toEqual(["bookings"]);
    expect(view.categories[0].events.map((e) => e.eventType)).toEqual([
      "booking.created",
      "booking.cancelled",
    ]);
  });

  it("ADMIN и MANAGER с одинаковыми секциями получают одинаковый набор (AC-5.4)", async () => {
    const asManager = await getNotificationCenter(
      staff("MANAGER", ["gazebos", "cafe"]),
      "555"
    );
    const asAdmin = await getNotificationCenter(
      staff("ADMIN", ["gazebos", "cafe"]),
      "555"
    );

    expect(asAdmin.categories).toEqual(asManager.categories);
  });

  it("«Системные» видны SUPERADMIN без секций (superadminAlways)", async () => {
    const view = await getNotificationCenter(staff("SUPERADMIN", []), "555");

    expect(view.categories.map((c) => c.key)).toContain("system");
  });

  it("«Системные» видны при секции monitoring", async () => {
    const view = await getNotificationCenter(
      staff("MANAGER", ["monitoring"]),
      "555"
    );

    expect(view.categories.map((c) => c.key)).toContain("system");
  });

  it("«Системные» не видны MANAGER без monitoring", async () => {
    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");

    expect(view.categories.map((c) => c.key)).not.toContain("system");
  });

  it("«Системные» видны MANAGER без monitoring с унаследованной строкой (grandfather)", async () => {
    vi.mocked(prisma.notificationEventPreference.findMany).mockResolvedValue([
      { eventType: "system.release" },
    ] as never);
    prefs([{ eventType: "system.release", enabled: true }]);

    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");

    expect(view.categories.map((c) => c.key)).toContain("system");
  });

  it("SUPERADMIN без секций получает только superadminAlways-категорию (strict-access наследуется)", async () => {
    // Строгий доступ (nedelovoy) живёт в getUserAdminSections: секции приходят
    // снаружи. Роль сама по себе не открывает ни одной секционной категории —
    // значит и строго-доступная не появится без явного гранта.
    const view = await getNotificationCenter(staff("SUPERADMIN", []), "555");

    expect(view.categories.map((c) => c.key)).toEqual(["system"]);
  });
});

describe("getNotificationCenter — состояние событий и доставка", () => {
  it("отсутствие строки = не подписан (source default, enabled false)", async () => {
    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");
    const events = view.categories[0].events;

    expect(events.every((e) => e.enabled === false)).toBe(true);
    expect(events.every((e) => e.source === "default")).toBe(true);
  });

  it("явная строка определяет enabled и помечается source explicit", async () => {
    prefs([
      { eventType: "order.placed", enabled: true },
      { eventType: "order.cancelled", enabled: false },
    ]);

    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");
    const events = view.categories[0].events;

    expect(events.find((e) => e.eventType === "order.placed")).toMatchObject({
      enabled: true,
      source: "explicit",
    });
    expect(events.find((e) => e.eventType === "order.cancelled")).toMatchObject({
      enabled: false,
      source: "explicit",
    });
  });

  it("delivery = group без подписки и без места в notificationRecipients", async () => {
    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");

    expect(view.categories[0].delivery).toBe("group");
  });

  it("delivery = personal, если пользователь в Module.config.notificationRecipients", async () => {
    vi.mocked(prisma.module.findMany).mockResolvedValue([
      { slug: "cafe", config: { notificationRecipients: ["u1"] } },
    ] as never);

    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");

    expect(view.categories[0].delivery).toBe("personal");
  });

  it("delivery = personal при явной подписке", async () => {
    prefs([{ eventType: "order.placed", enabled: true }]);

    const view = await getNotificationCenter(staff("MANAGER", ["cafe"]), "555");

    expect(view.categories[0].delivery).toBe("personal");
  });

  it("отдаёт защищённый блок и роль", async () => {
    const view = await getNotificationCenter(staff("ADMIN", ["cafe"]), "555");

    expect(view.role).toBe("ADMIN");
    expect(view.protected).toEqual([
      {
        label: "Критические алерты инфраструктуры",
        note: "Приходят всегда и не отключаются",
      },
    ]);
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

describe("setEventPreference", () => {
  it("отказывает на eventType вне каталога", async () => {
    await expect(
      setEventPreference(staff("SUPERADMIN", ["monitoring"]), "health.down", true)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    expect(upsertEventPreference).not.toHaveBeenCalled();
    expect(setReleaseSubscription).not.toHaveBeenCalled();
  });

  it("отказывает при отсутствии доступа к секции категории", async () => {
    await expect(
      setEventPreference(staff("MANAGER", ["cafe"]), "booking.created", true)
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(upsertEventPreference).not.toHaveBeenCalled();
  });

  it("отказывает роли USER", async () => {
    await expect(
      setEventPreference(staff("USER", []), "booking.created", true)
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("system.release пишется через setReleaseSubscription", async () => {
    const result = await setEventPreference(
      staff("SUPERADMIN", ["monitoring"]),
      "system.release",
      true
    );

    expect(setReleaseSubscription).toHaveBeenCalledWith("u1", true);
    expect(upsertEventPreference).not.toHaveBeenCalled();
    expect(result).toEqual({ eventType: "system.release", enabled: true });
  });

  it("остальные типы идут через upsertEventPreference", async () => {
    const result = await setEventPreference(
      staff("MANAGER", ["gazebos"]),
      "booking.created",
      false
    );

    expect(upsertEventPreference).toHaveBeenCalledWith("u1", "booking.created", {
      enabled: false,
    });
    expect(setReleaseSubscription).not.toHaveBeenCalled();
    expect(result).toEqual({ eventType: "booking.created", enabled: false });
  });
});
