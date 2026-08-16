import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResourceFindMany = vi.fn();
const mockBookingFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    resource: { findMany: (...args: unknown[]) => mockResourceFindMany(...args) },
    booking: { findMany: (...args: unknown[]) => mockBookingFindMany(...args) },
  },
}));

import { getPrintableDaySchedule } from "../print-schedule";

const mockBooking = (overrides: Record<string, unknown> = {}) => ({
  id: "booking-1",
  resourceId: "resource-1",
  startTime: new Date("2030-06-15T10:00:00Z"),
  endTime: new Date("2030-06-15T11:00:00Z"),
  status: "CONFIRMED",
  clientName: "Иван",
  clientPhone: "+79991234567",
  metadata: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockResourceFindMany.mockResolvedValue([{ id: "resource-1", name: "Беседка №1" }]);
  mockBookingFindMany.mockResolvedValue([]);
});

describe("getPrintableDaySchedule (issue #668)", () => {
  it("фильтрует ресурсы по moduleSlug и deletedAt: null", async () => {
    await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(mockResourceFindMany).toHaveBeenCalledWith({
      where: { moduleSlug: "gazebos", deletedAt: null },
      select: { id: true, name: true },
    });
  });

  it("без includeCancelled запрашивает только ACTIVE_BOOKING_STATUSES", async () => {
    await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          moduleSlug: "gazebos",
          deletedAt: null,
          status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        }),
      })
    );
  });

  it("с includeCancelled=true добавляет CANCELLED к статусам (AC-4)", async () => {
    await getPrintableDaySchedule("gazebos", "2030-06-15", true);

    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "CANCELLED"] },
        }),
      })
    );
  });

  it("запрашивает брони отсортированными по времени начала (AC-3)", async () => {
    await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startTime: "asc" } })
    );
  });

  it("подставляет имя ресурса по resourceId", async () => {
    mockBookingFindMany.mockResolvedValue([mockBooking({ resourceId: "resource-1" })]);

    const rows = await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(rows[0].resourceName).toBe("Беседка №1");
  });

  it("подставляет '—' для ресурса, не найденного в текущем списке (например, удалённого)", async () => {
    mockBookingFindMany.mockResolvedValue([mockBooking({ resourceId: "unknown-resource" })]);

    const rows = await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(rows[0].resourceName).toBe("—");
  });

  it("читает guestCount и comment из metadata, когда они есть", async () => {
    mockBookingFindMany.mockResolvedValue([
      mockBooking({ metadata: { guestCount: 6, comment: "Аллергия на орехи" } }),
    ]);

    const rows = await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(rows[0].guestCount).toBe(6);
    expect(rows[0].comment).toBe("Аллергия на орехи");
  });

  it("guestCount/comment — null, когда их нет в metadata или они не того типа", async () => {
    mockBookingFindMany.mockResolvedValue([
      mockBooking({ metadata: { guestCount: "шесть", comment: 123 } }),
    ]);

    const rows = await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(rows[0].guestCount).toBeNull();
    expect(rows[0].comment).toBeNull();
  });

  it("сериализует startTime/endTime в ISO-строки", async () => {
    mockBookingFindMany.mockResolvedValue([mockBooking()]);

    const rows = await getPrintableDaySchedule("gazebos", "2030-06-15", false);

    expect(rows[0].startTime).toBe("2030-06-15T10:00:00.000Z");
    expect(rows[0].endTime).toBe("2030-06-15T11:00:00.000Z");
  });

  it("работает с ps-park так же, как с gazebos (AC-5)", async () => {
    await getPrintableDaySchedule("ps-park", "2030-06-15", false);

    expect(mockResourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ moduleSlug: "ps-park" }) })
    );
    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ moduleSlug: "ps-park" }) })
    );
  });
});
