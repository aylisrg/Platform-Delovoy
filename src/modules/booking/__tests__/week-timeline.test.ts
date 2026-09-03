import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResourceFindMany = vi.fn();
const mockBookingFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    resource: { findMany: (...args: unknown[]) => mockResourceFindMany(...args) },
    booking: { findMany: (...args: unknown[]) => mockBookingFindMany(...args) },
  },
}));

import { getWeekTimeline, hoursRange, normalizeWeekStart, weekDays } from "../week-timeline";

const HOURS = { openHour: 8, closeHour: 23, minBookingHours: 1 };

const mockBooking = (overrides: Record<string, unknown> = {}) => ({
  id: "booking-1",
  resourceId: "resource-1",
  date: new Date("2030-06-17T00:00:00.000Z"),
  startTime: new Date("2030-06-17T07:00:00.000Z"),
  endTime: new Date("2030-06-17T11:00:00.000Z"),
  status: "CONFIRMED",
  clientName: "Иван",
  clientPhone: "+79991234567",
  metadata: { guestCount: 6 },
  cashAmount: null,
  cardAmount: { toString: () => "3000" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockResourceFindMany.mockResolvedValue([]);
  mockBookingFindMany.mockResolvedValue([]);
});

describe("normalizeWeekStart / weekDays / hoursRange (ADR 2026-08-23 §2, §9)", () => {
  it("понедельник остаётся понедельником", () => {
    expect(normalizeWeekStart("2030-06-17")).toBe("2030-06-17"); // Пн
  });

  it("среда и воскресенье нормализуются к понедельнику той же недели (неделя Пн–Вс)", () => {
    expect(normalizeWeekStart("2030-06-19")).toBe("2030-06-17"); // Ср
    expect(normalizeWeekStart("2030-06-23")).toBe("2030-06-17"); // Вс
  });

  it("граница года внутри недели: 2027-01-01 (Пт) → понедельник 2026-12-28, дни через смену года", () => {
    expect(normalizeWeekStart("2027-01-01")).toBe("2026-12-28");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("weekDays — ровно 7 дат подряд", () => {
    const days = weekDays("2030-06-17");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2030-06-17");
    expect(days[6]).toBe("2030-06-23");
  });

  it("hoursRange — как у дневного таймлайна: последний час = closeHour-1", () => {
    expect(hoursRange(8, 11)).toEqual(["08:00", "09:00", "10:00"]);
    expect(hoursRange(11, 22)).toHaveLength(11);
    expect(hoursRange(10, 10)).toEqual([]);
  });
});

describe("getWeekTimeline (issue #740)", () => {
  it("один диапазонный запрос [понедельник, понедельник+7) по moduleSlug, активным статусам и deletedAt: null", async () => {
    await getWeekTimeline("gazebos", "2030-06-19", HOURS); // среда → неделя с 17-го

    expect(mockBookingFindMany).toHaveBeenCalledTimes(1);
    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moduleSlug: "gazebos",
          deletedAt: null,
          date: { gte: new Date("2030-06-17T00:00:00.000Z"), lt: new Date("2030-06-24T00:00:00.000Z") },
          status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        },
        orderBy: { startTime: "asc" },
      })
    );
  });

  it("ресурсы — только активные и не удалённые, по имени; для ps-park тот же путь", async () => {
    await getWeekTimeline("ps-park", "2030-06-17", HOURS);

    expect(mockResourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { moduleSlug: "ps-park", isActive: true, deletedAt: null },
        orderBy: { name: "asc" },
      })
    );
    expect(mockBookingFindMany.mock.calls[0][0].where.moduleSlug).toBe("ps-park");
  });

  it("weekStart в ответе нормализован, days — 7 дат, hours/minBookingHours — из настроек модуля", async () => {
    const data = await getWeekTimeline("gazebos", "2030-06-21", { openHour: 11, closeHour: 22, minBookingHours: 4 });

    expect(data.weekStart).toBe("2030-06-17");
    expect(data.days).toEqual(weekDays("2030-06-17"));
    expect(data.hours).toEqual(hoursRange(11, 22));
    expect(data.minBookingHours).toBe(4);
  });

  it("pricePerHour нормализуется Decimal → number, Decimal не пересекает границу Server → Client (#614)", async () => {
    mockResourceFindMany.mockResolvedValue([
      { id: "r-1", name: "Беседка №1", description: null, capacity: 12, pricePerHour: { toString: () => "1500" }, isActive: true },
      { id: "r-2", name: "Беседка №2", description: "у пруда", capacity: null, pricePerHour: null, isActive: true },
    ]);

    const data = await getWeekTimeline("gazebos", "2030-06-17", HOURS);

    expect(data.resources).toEqual([
      { id: "r-1", name: "Беседка №1", description: null, capacity: 12, pricePerHour: 1500, isActive: true },
      { id: "r-2", name: "Беседка №2", description: "у пруда", capacity: null, pricePerHour: null, isActive: true },
    ]);
  });

  it("бронь отдаётся плоским списком с ключом date (YYYY-MM-DD), ISO-временем и суммами строками", async () => {
    mockBookingFindMany.mockResolvedValue([mockBooking()]);

    const data = await getWeekTimeline("gazebos", "2030-06-17", HOURS);

    expect(data.bookings).toEqual([
      {
        id: "booking-1",
        resourceId: "resource-1",
        date: "2030-06-17",
        startTime: "2030-06-17T07:00:00.000Z",
        endTime: "2030-06-17T11:00:00.000Z",
        status: "CONFIRMED",
        clientName: "Иван",
        clientPhone: "+79991234567",
        metadata: { guestCount: 6 },
        cashAmount: null,
        cardAmount: "3000",
      },
    ]);
  });

  it("пустая неделя — пустые списки, а не ошибка", async () => {
    const data = await getWeekTimeline("gazebos", "2030-06-17", HOURS);
    expect(data.bookings).toEqual([]);
    expect(data.resources).toEqual([]);
  });
});
