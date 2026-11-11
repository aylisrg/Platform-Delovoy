import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn() }));
vi.mock("@/modules/booking/manage", async () => ({
  ...(await vi.importActual<typeof import("@/modules/booking/manage")>(
    "@/modules/booking/manage",
  )),
  buildBookingView: vi.fn().mockResolvedValue({
    acceptanceRequired: true,
    paymentUrl: "unsafe-stale-url",
  }),
}));
vi.mock("@/modules/gazebos/service", () => ({
  cancelBooking: vi.fn(),
  createBookingPayment: vi.fn(),
  rescheduleBookingByClient: vi.fn(),
}));
vi.mock("@/modules/ps-park/service", () => ({ cancelBooking: vi.fn() }));
vi.mock("@/modules/booking/offer", async () => ({
  ...(await vi.importActual<typeof import("@/modules/booking/offer")>(
    "@/modules/booking/offer",
  )),
  buildAcceptance: vi.fn().mockResolvedValue({
    acceptedOfferAt: new Date(),
    offerVersionId: "offer-v1",
  }),
}));
import { prisma } from "@/lib/db";
import {
  cancelBooking,
  createBookingPayment,
  rescheduleBookingByClient,
} from "@/modules/gazebos/service";
import { buildAcceptance } from "@/modules/booking/offer";
import { getOwnBooking, actOnOwnBooking } from "../booking-service";
const context = { ip: "127.0.0.1", userAgent: "test" };
const booking = {
  id: "b1",
  userId: "owner",
  moduleSlug: "gazebos",
  status: "PENDING",
  metadata: { totalPrice: "5000", basePrice: "5000" },
  startTime: new Date(Date.now() + 86400000 * 3),
  acceptedOfferAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.booking.findFirst).mockResolvedValue(booking as never);
  vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);
});
describe("customer booking access and actions", () => {
  it("queries by the session owner and never returns guest manage tokens", async () => {
    const result = await getOwnBooking("owner", "b1");
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: {
        id: "b1",
        userId: "owner",
        deletedAt: null,
        moduleSlug: { in: ["gazebos", "ps-park"] },
      },
    });
    expect(result).not.toHaveProperty("manageTokenHash");
    expect(result.view.paymentUrl).toBeNull();
  });
  it("rejects inaccessible bookings before performing a mutation", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    await expect(
      actOnOwnBooking(
        "other",
        "b1",
        { action: "cancel", confirmRefund: true },
        context,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(cancelBooking).not.toHaveBeenCalled();
  });
  it("does not issue an unaccepted or expired checkout URL", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      confirmationUrl: "https://pay.example/checkout",
      amount: 5000,
      expiresAt: new Date(Date.now() + 86400000),
    } as never);
    expect((await getOwnBooking("owner", "b1")).view.paymentUrl).toBeNull();
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({
      ...booking,
      acceptedOfferAt: new Date(),
    } as never);
    expect((await getOwnBooking("owner", "b1")).view.paymentUrl).toBe(
      "https://pay.example/checkout",
    );
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      confirmationUrl: "https://pay.example/checkout",
      amount: 5000,
      expiresAt: new Date(0),
    } as never);
    expect((await getOwnBooking("owner", "b1")).view.paymentUrl).toBeNull();
  });
  it("does not reuse a payment for a mismatched remaining amount", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({
      ...booking,
      acceptedOfferAt: new Date(),
      metadata: { totalPrice: "5000", onlinePaidAmount: "2000" },
    } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      confirmationUrl: "https://pay.example/checkout",
      amount: 5000,
      expiresAt: null,
    } as never);
    expect((await getOwnBooking("owner", "b1")).view.paymentUrl).toBeNull();
    await expect(
      actOnOwnBooking(
        "owner",
        "b1",
        {
          action: "pay",
          acceptOffer: true,
          offerVersionSlug: "v1",
          acceptMarketing: false,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    expect(createBookingPayment).not.toHaveBeenCalled();
  });
  it("preserves penalty confirmation and does not force confirmation on the first click", async () => {
    vi.mocked(cancelBooking).mockResolvedValue({
      penaltyRequired: true,
      penaltyAmount: 2500,
      basePrice: 5000,
    });
    const result = await actOnOwnBooking(
      "owner",
      "b1",
      { action: "cancel", confirmRefund: false },
      context,
    );
    expect(result).toMatchObject({
      confirmationRequired: true,
      penaltyAmount: 2500,
    });
    expect(cancelBooking).toHaveBeenCalledWith(
      "b1",
      "owner",
      expect.any(String),
      false,
    );
  });
  it("accepts the actual offer before generating a new payment link", async () => {
    vi.mocked(createBookingPayment).mockResolvedValue({
      id: "p1",
      confirmationUrl: "https://pay.example/p1",
    });
    const result = await actOnOwnBooking(
      "owner",
      "b1",
      {
        action: "pay",
        acceptOffer: true,
        offerVersionSlug: "v1",
        acceptMarketing: false,
      },
      context,
    );
    expect(buildAcceptance).toHaveBeenCalledWith(
      "gazebos-offer",
      expect.objectContaining({
        offerVersionSlug: "v1",
        acceptMarketing: false,
      }),
    );
    expect(result).toEqual({ confirmationUrl: "https://pay.example/p1" });
  });
  it("reuses existing reschedule logic and prevents actions on terminal statuses", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({
      ...booking,
      status: "COMPLETED",
    } as never);
    await expect(
      actOnOwnBooking(
        "owner",
        "b1",
        {
          action: "reschedule",
          date: "2026-12-01",
          startTime: "12:00",
          endTime: "13:00",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(rescheduleBookingByClient).not.toHaveBeenCalled();
  });
  it("does not expose a cancel action for PS Park prepaid reservations", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({
      ...booking,
      moduleSlug: "ps-park",
      metadata: { paymentPurpose: "reservation" },
    } as never);
    expect((await getOwnBooking("owner", "b1")).canCancel).toBe(false);
  });
});

it("does not create a full-price payment for a discounted quote or a past visit", async () => {
  for (const override of [
    { metadata: { totalPrice: "5000", discount: { finalAmount: 4000 } } },
    { startTime: new Date(0) },
  ]) {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({
      ...booking,
      ...override,
    } as never);
    await expect(
      actOnOwnBooking(
        "owner",
        "b1",
        {
          action: "pay",
          acceptOffer: true,
          offerVersionSlug: "v1",
          acceptMarketing: false,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    expect((await getOwnBooking("owner", "b1")).canPay).toBe(false);
  }
  expect(createBookingPayment).not.toHaveBeenCalled();
});
