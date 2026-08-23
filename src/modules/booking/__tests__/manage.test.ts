import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn() },
    resource: { findUnique: vi.fn() },
    offerVersion: { findUnique: vi.fn() },
    payment: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn() },
}));

import type { Booking } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createManageToken } from "../offer";
import {
  buildBookingView,
  checkRescheduleEligibility,
  computeRefund,
  findBookingByToken,
  markRescheduleUsed,
} from "../manage";
import { PREPAID_CANCELLATION_POLICY } from "../types";

const HOUR = 3_600_000;

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const start = new Date(Date.now() + 48 * HOUR);
  return {
    id: "clx0000000000000booking",
    moduleSlug: "gazebos",
    resourceId: "res-1",
    userId: null,
    date: new Date(start.toISOString().split("T")[0]),
    startTime: start,
    endTime: new Date(start.getTime() + 4 * HOUR),
    status: "CONFIRMED",
    clientName: "Иван",
    clientPhone: "+79001234567",
    clientTelegram: null,
    cancelReason: null,
    googleEventId: null,
    managerId: null,
    cashAmount: null,
    cardAmount: null,
    metadata: { totalPrice: "8800.00", onlinePaidAmount: "8800.00" },
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    offerVersionId: "ov-1",
    offerContentHash: "hash",
    acceptedOfferAt: new Date(),
    acceptedMarketing: false,
    acceptedIp: "203.0.113.7",
    acceptedUserAgent: "UA",
    manageTokenHash: "hash",
    ...overrides,
  } as Booking;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
});

describe("findBookingByToken", () => {
  it("ищет по хешу токена, а не по самому токену", async () => {
    const { token, hash } = createManageToken("bk-1")!;
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(makeBooking() as never);

    await findBookingByToken(token);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { manageTokenHash: hash, deletedAt: null },
    });
  });

  it("не ходит в БД за заведомо коротким мусором", async () => {
    expect(await findBookingByToken("abc")).toBeNull();
    expect(await findBookingByToken("")).toBeNull();
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
  });
});

describe("computeRefund", () => {
  it("возвращает всё, если до начала больше порога", () => {
    const booking = makeBooking({ startTime: new Date(Date.now() + 48 * HOUR) });
    const refund = computeRefund(booking);

    expect(refund.paidAmount).toBe(8800);
    expect(refund.refundAmount).toBe(8800);
    expect(refund.deductions).toEqual([]);
  });

  it("удерживает стоимость аренды при отмене внутри порога и объясняет, за что", () => {
    const booking = makeBooking({ startTime: new Date(Date.now() + 2 * HOUR) });
    const refund = computeRefund(booking);

    expect(refund.refundAmount).toBe(0);
    expect(refund.deductions).toHaveLength(1);
    expect(refund.deductions[0].amount).toBe(8800);
    expect(refund.deductions[0].label).toContain(String(PREPAID_CANCELLATION_POLICY.thresholdHours));
  });

  it("не выдумывает удержаний, когда оплаты не было", () => {
    const booking = makeBooking({
      startTime: new Date(Date.now() + 1 * HOUR),
      metadata: { totalPrice: "8800.00" },
    });
    const refund = computeRefund(booking);

    expect(refund.paidAmount).toBe(0);
    expect(refund.refundAmount).toBe(0);
    expect(refund.deductions).toEqual([]);
  });
});

describe("checkRescheduleEligibility", () => {
  it("разрешает перенос при достаточном запасе времени", () => {
    const result = checkRescheduleEligibility(makeBooking());
    expect(result.allowed).toBe(true);
  });

  it("запрещает перенос ближе порога и отправляет к оператору", () => {
    const result = checkRescheduleEligibility(
      makeBooking({ startTime: new Date(Date.now() + 3 * HOUR) })
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("Позвоните");
  });

  it("даёт бесплатный перенос ровно один раз", () => {
    const result = checkRescheduleEligibility(
      makeBooking({ metadata: { totalPrice: "1", clientRescheduleCount: 1 } as never })
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("уже использован");
  });

  it("не даёт переносить закрытую бронь", () => {
    for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
      expect(checkRescheduleEligibility(makeBooking({ status })).allowed).toBe(false);
    }
  });

  it("ограничивает окно переноса 90 днями от даты бронирования", () => {
    const booking = makeBooking();
    const result = checkRescheduleEligibility(booking);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      const days = Math.round(
        (result.windowEndsAt.getTime() - booking.date.getTime()) / (24 * HOUR)
      );
      expect(days).toBe(90);
    }
  });
});

describe("markRescheduleUsed", () => {
  it("увеличивает счётчик переносов, сохраняя остальную metadata", () => {
    const next = markRescheduleUsed({ totalPrice: "100" });
    expect(next.clientRescheduleCount).toBe(1);
    expect(next.totalPrice).toBe("100");
    expect(next.lastClientRescheduleAt).toBeTruthy();
  });

  it("считает от уже израсходованных", () => {
    expect(markRescheduleUsed({ clientRescheduleCount: 1 } as never).clientRescheduleCount).toBe(2);
  });
});

describe("buildBookingView", () => {
  beforeEach(() => {
    vi.mocked(prisma.resource.findUnique).mockResolvedValue({ name: "Беседка №1" } as never);
    vi.mocked(prisma.offerVersion.findUnique).mockResolvedValue({ slug: "v1", number: 1 } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null as never);
  });

  it("собирает человекочитаемый номер и редакцию оферты", async () => {
    const view = await buildBookingView(makeBooking());

    expect(view.number).toBe("БП-OOKING"); // последние 6 символов id
    expect(view.offer).toEqual({ slug: "v1", number: 1 });
    expect(view.resourceName).toBe("Беседка №1");
  });

  it("помечает бронь без акцепта как требующую подтверждения условий", async () => {
    const view = await buildBookingView(makeBooking({ acceptedOfferAt: null }));
    expect(view.acceptanceRequired).toBe(true);
  });

  it("не считает акцептованную бронь требующей подтверждения", async () => {
    const view = await buildBookingView(makeBooking());
    expect(view.acceptanceRequired).toBe(false);
  });

  it("не отдаёт ссылку на протухший платёж", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      confirmationUrl: "https://yookassa/pay",
      expiresAt: new Date(Date.now() - HOUR),
    } as never);

    const view = await buildBookingView(makeBooking({ status: "PENDING" }));
    expect(view.paymentUrl).toBeNull();
  });

  it("отдаёт ссылку на живой платёж", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      confirmationUrl: "https://yookassa/pay",
      expiresAt: new Date(Date.now() + HOUR),
    } as never);

    const view = await buildBookingView(makeBooking({ status: "PENDING" }));
    expect(view.paymentUrl).toBe("https://yookassa/pay");
  });
});
