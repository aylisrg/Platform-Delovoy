import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));

import { getBookingHistory } from "../history";
import { prisma } from "@/lib/db";

type MockPrisma = {
  booking: { findFirst: ReturnType<typeof vi.fn> };
  auditLog: { findMany: ReturnType<typeof vi.fn> };
};
const mp = prisma as unknown as MockPrisma;

const booking = {
  id: "bk-1",
  userId: "user-1",
  createdAt: new Date("2026-08-01T10:00:00.000Z"),
  clientName: "Ксения Шмакова",
};

function log(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    action: "booking.status_change",
    userId: "mgr-1",
    createdAt: new Date("2026-08-13T12:00:00.000Z"),
    metadata: {},
    user: { name: "Менеджер Аня", email: "anya@example.com" },
    ...overrides,
  };
}

describe("getBookingHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mp.booking.findFirst.mockResolvedValue(booking);
  });

  it("возвращает пустую ленту для чужого модуля, а не историю чужой брони", async () => {
    mp.booking.findFirst.mockResolvedValue(null);

    expect(await getBookingHistory("bk-1", "ps-park")).toEqual([]);
    expect(mp.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("расшифровывает смену статуса в «было → стало» с причиной", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({
        metadata: {
          previousStatus: "CONFIRMED",
          newStatus: "CANCELLED",
          reason: "Гость отказался",
        },
      }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "gazebos");

    expect(entry.label).toBe("Смена статуса");
    expect(entry.actor).toBe("Менеджер Аня");
    expect(entry.details).toContain("Подтверждена → Отменена");
    expect(entry.details).toContain("Причина: Гость отказался");
  });

  it("для завершения показывает сумму и разбивку по кассе (AC-3)", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({
        action: "booking.complete",
        metadata: { totalAmount: 8000, cashAmount: 5000, cardAmount: 3000 },
      }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "gazebos");

    expect(entry.label).toBe("Бронь завершена");
    expect(entry.details.join(" ")).toContain("8");
    expect(entry.details.some((d) => d.startsWith("Наличные"))).toBe(true);
    expect(entry.details.some((d) => d.startsWith("Карта"))).toBe(true);
  });

  it("понимает и `session.*` от PS Park — исторические имена тех же событий", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({ action: "session.cancel", metadata: { reason: "Дубль" } }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "ps-park");

    expect(entry.label).toBe("Сессия отменена");
    expect(entry.details).toContain("Причина: Дубль");
  });

  it("для скидки показывает процент, сумму и причину", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({
        action: "booking.discount_applied",
        metadata: { discountPercent: 10, discountAmount: 800, discountReason: "loyalty" },
      }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "gazebos");

    expect(entry.details).toContain("Скидка 10%");
    expect(entry.details).toContain("Причина: loyalty");
  });

  it("автоматические действия подписаны «Система», а не именем крон-юзера", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({ action: "booking.auto_complete", metadata: { actor: "CRON" }, user: { name: "cron", email: null } }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "gazebos");

    expect(entry.actor).toBe("Система");
  });

  it("дописывает создание брони, когда его нет в журнале", async () => {
    mp.auditLog.findMany.mockResolvedValue([log()]);

    const entries = await getBookingHistory("bk-1", "gazebos");

    const created = entries.at(-1);
    expect(created?.label).toBe("Бронь создана");
    expect(created?.at).toBe(booking.createdAt.toISOString());
  });

  it("не дублирует создание, если оно уже записано", async () => {
    mp.auditLog.findMany.mockResolvedValue([log({ action: "booking.create" })]);

    const entries = await getBookingHistory("bk-1", "gazebos");

    expect(entries.filter((e) => e.label === "Бронь создана")).toHaveLength(1);
  });

  it("восстановление читается как отдельное событие (AC-8)", async () => {
    mp.auditLog.findMany.mockResolvedValue([
      log({
        action: "booking.restore",
        metadata: { previousStatus: "COMPLETED", newStatus: "CONFIRMED", reason: "Ошибка смены" },
      }),
    ]);

    const [entry] = await getBookingHistory("bk-1", "gazebos");

    expect(entry.label).toBe("Бронь восстановлена");
    expect(entry.details).toContain("Завершена → Подтверждена");
  });
});
