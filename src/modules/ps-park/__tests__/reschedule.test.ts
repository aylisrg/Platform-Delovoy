import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking } from "@prisma/client";

vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findFirst: vi.fn(), update: vi.fn() }, resource: { findFirst: vi.fn() },
  payment: { findFirst: vi.fn() }, auditLog: { create: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn(),
} }));
vi.mock("../service", () => ({
  getOpenCloseHours: vi.fn().mockResolvedValue({ openHour: 8, closeHour: 23 }),
  PSBookingError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("@/lib/logger", () => ({ log: { error: vi.fn() } }));
vi.mock("@/modules/inventory/service", () => ({ saleBookingItems: vi.fn() }));
import { prisma } from "@/lib/db";
import { saleBookingItems } from "@/modules/inventory/service";
import { reschedulePaidReservation } from "../reschedule";

let row: Booking;
const input = { date: "2030-06-12", startTime: "12:00", expectedStartTime: "2030-06-10T07:00:00.000Z" };
const snapshot = { paymentPurpose: "reservation", pricePerHour: "500", totalPrice: "1000", onlinePaidAmount: "1000", items: [], reservationDurationMinutes: 120, reservationItemsTotal: "0.00" };

beforeEach(() => {
  vi.clearAllMocks();
  row = { id: "booking-1", moduleSlug: "ps-park", resourceId: "table-1", status: "CONFIRMED", deletedAt: null,
    date: new Date("2030-06-10"), startTime: new Date(input.expectedStartTime), endTime: new Date("2030-06-10T09:00:00Z"),
    metadata: { ...snapshot } } as unknown as Booking;
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
  vi.mocked(prisma.resource.findFirst).mockResolvedValue({ id: "table-1", pricePerHour: 9000 } as never);
  vi.mocked(prisma.payment.findFirst).mockResolvedValue({ amount: 1000 } as never);
  vi.mocked(prisma.booking.findFirst).mockImplementation((async ({ where }: { where: { id: unknown } }) => typeof where.id === "string" ? row : null) as never);
  vi.mocked(prisma.booking.update).mockImplementation((async ({ data }: { data: Partial<Booking> }) => { row = { ...row, ...data }; return row; }) as never);
});

describe("Перенос оплаченной Play Park reservation", () => {
  it("не считает неоплаченное продление частью оплаченного периода", async () => {
    row.endTime = new Date("2030-06-10T10:00:00Z");
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "RESERVATION_CHANGED" });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });
  it("не обещает бесплатный перенос с добавленными после оплаты товарами", async () => {
    row.metadata = { ...snapshot, itemsTotal: "500" };
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "RESERVATION_CHANGED" });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });
  it("сохраняет цену, оплату и длительность при смене тарифа; второй запрос — no-op", async () => {
    const updated = await reschedulePaidReservation(row.id, "manager-1", input);
    expect(updated.startTime.toISOString()).toBe("2030-06-12T09:00:00.000Z");
    expect(updated.endTime.toISOString()).toBe("2030-06-12T11:00:00.000Z");
    expect(updated.metadata).toMatchObject(snapshot);
    await reschedulePaidReservation(row.id, "manager-1", input);
    expect(prisma.booking.update).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(saleBookingItems).not.toHaveBeenCalled();
  });
  it("не переносит чужой модуль/менеджерский session bill", async () => {
    row.moduleSlug = "gazebos";
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    row.moduleSlug = "ps-park"; row.metadata = {};
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "CHECKED_IN", "COMPLETED"] as const)("отклоняет статус %s", async (status) => {
    row.status = status;
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "RESCHEDULE_NOT_ALLOWED" });
  });
  it("отклоняет отменённую после игры бронь", async () => {
    row.status = "CANCELLED"; row.metadata = { ...snapshot, checkedInAt: "2030-06-10T07:00:00Z" };
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "RESCHEDULE_NOT_ALLOWED" });
  });
  it("не принимает metadata вместо действительного платежа без возвратов", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: "SUCCEEDED", refundedAmount: 0, refunds: { none: { status: { in: ["pending", "succeeded"] } } },
    }) }));
  });
  it("отклоняет устаревшую форму", async () => {
    await expect(reschedulePaidReservation(row.id, "manager-1", { ...input, expectedStartTime: "2030-06-09T07:00:00Z" })).rejects.toMatchObject({ code: "BOOKING_CHANGED" });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });
  it("проверяет новый слот внутри транзакции и сохраняет старую бронь при конфликте", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValueOnce({ id: "other" } as never);
    await expect(reschedulePaidReservation(row.id, "manager-1", input)).rejects.toMatchObject({ code: "BOOKING_CONFLICT" });
    expect(prisma.booking.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it.each([{ ...input, date: "2020-01-01" }, { ...input, startTime: "22:00" }])("не переносит в прошлое или за пределы смены", async (value) => {
    await expect(reschedulePaidReservation(row.id, "manager-1", value)).rejects.toMatchObject({ code: "INVALID_BOOKING_TIME" });
  });
  it.each(["CANCELLED", "NO_SHOW"] as const)("сохраняет оплаченный остаток при переносе статуса %s", async (status) => {
    row.status = status;
    const updated = await reschedulePaidReservation(row.id, "manager-1", input);
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.metadata).toMatchObject({ onlinePaidAmount: "1000", totalPrice: "1000" });
  });
  it("повторно резервирует возвращённые товары отменённой брони ровно один раз", async () => {
    row.status = "CANCELLED"; row.metadata = { ...snapshot, items: [{ skuId: "snack", quantity: 1 }] };
    await reschedulePaidReservation(row.id, "manager-1", input);
    await reschedulePaidReservation(row.id, "manager-1", input);
    expect(saleBookingItems).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
