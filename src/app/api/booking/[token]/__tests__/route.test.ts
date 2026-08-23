import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));

const mockFindByToken = vi.fn();
const mockBuildView = vi.fn();
const mockComputeRefund = vi.fn();
const mockLogTokenAction = vi.fn();
vi.mock("@/modules/booking/manage", () => ({
  findBookingByToken: (...a: unknown[]) => mockFindByToken(...a),
  buildBookingView: (...a: unknown[]) => mockBuildView(...a),
  computeRefund: (...a: unknown[]) => mockComputeRefund(...a),
  logTokenAction: (...a: unknown[]) => mockLogTokenAction(...a),
}));

const mockBuildAcceptance = vi.fn();
vi.mock("@/modules/booking/offer", async () => {
  const actual = await vi.importActual<typeof import("@/modules/booking/offer")>(
    "@/modules/booking/offer"
  );
  return { ...actual, buildAcceptance: (...a: unknown[]) => mockBuildAcceptance(...a) };
});

const mockCancelBooking = vi.fn();
const mockReschedule = vi.fn();
const mockCreatePayment = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    ...actual,
    cancelBooking: (...a: unknown[]) => mockCancelBooking(...a),
    rescheduleBookingByClient: (...a: unknown[]) => mockReschedule(...a),
    createBookingPayment: (...a: unknown[]) => mockCreatePayment(...a),
  };
});

const mockBookingUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { booking: { update: (...a: unknown[]) => mockBookingUpdate(...a) } },
}));

import { GET, POST } from "../route";
import { BookingError } from "@/modules/gazebos/service";

const TOKEN = "a".repeat(43);
const params = Promise.resolve({ token: TOKEN });

function req(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/booking/${TOKEN}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const booking = { id: "bk-1", userId: null, status: "CONFIRMED", acceptedOfferAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindByToken.mockResolvedValue(booking);
  mockBuildView.mockResolvedValue({ number: "БП-000001" });
  mockComputeRefund.mockReturnValue({ paidAmount: 0, refundAmount: 0, deductions: [], hoursUntilStart: 48 });
  mockCancelBooking.mockResolvedValue({ penaltyRequired: false, booking: {} });
});

describe("GET /api/booking/[token]", () => {
  it("отдаёт бронь по действительному токену", async () => {
    const res = await GET(req(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.number).toBe("БП-000001");
  });

  it("на неизвестный токен отвечает 404 — чужой и несуществующий неразличимы", async () => {
    mockFindByToken.mockResolvedValue(null);

    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/booking/[token] — отмена", () => {
  it("отменяет бронь без удержаний в один запрос", async () => {
    const res = await POST(req({ action: "cancel" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.cancelled).toBe(true);
    expect(mockCancelBooking).toHaveBeenCalledWith(
      "bk-1",
      null,
      expect.any(String),
      true
    );
  });

  it("при удержаниях сначала показывает расчёт, а не отменяет молча", async () => {
    mockComputeRefund.mockReturnValue({
      paidAmount: 8800,
      refundAmount: 0,
      deductions: [{ label: "Стоимость аренды", amount: 8800 }],
      hoursUntilStart: 2,
    });

    const res = await POST(req({ action: "cancel" }), { params });
    const body = await res.json();

    expect(body.data.confirmationRequired).toBe(true);
    expect(body.data.refund.deductions).toHaveLength(1);
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });

  it("после подтверждения расчёта отменяет", async () => {
    mockComputeRefund.mockReturnValue({
      paidAmount: 8800,
      refundAmount: 0,
      deductions: [{ label: "Стоимость аренды", amount: 8800 }],
      hoursUntilStart: 2,
    });

    const res = await POST(req({ action: "cancel", confirmRefund: true }), { params });
    await res.json();

    expect(mockCancelBooking).toHaveBeenCalled();
  });

  it("на неизвестный токен не отменяет ничего", async () => {
    mockFindByToken.mockResolvedValue(null);

    const res = await POST(req({ action: "cancel" }), { params });
    expect(res.status).toBe(404);
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });
});

describe("POST /api/booking/[token] — перенос", () => {
  it("переносит и возвращает обновлённую бронь", async () => {
    mockReschedule.mockResolvedValue({ booking: { id: "bk-1" }, priceDelta: 0 });

    const res = await POST(
      req({ action: "reschedule", date: "2026-09-01", startTime: "12:00", endTime: "16:00" }),
      { params }
    );
    await res.json();

    expect(mockReschedule).toHaveBeenCalledWith("bk-1", {
      date: "2026-09-01",
      startTime: "12:00",
      endTime: "16:00",
    });
  });

  it("отклоняет мусорную дату до похода в сервис", async () => {
    const res = await POST(
      req({ action: "reschedule", date: "01.09.2026", startTime: "12:00", endTime: "16:00" }),
      { params }
    );

    expect(res.status).toBe(422);
    expect(mockReschedule).not.toHaveBeenCalled();
  });

  it("передаёт наверх причину отказа сервиса", async () => {
    mockReschedule.mockRejectedValue(
      new BookingError("RESCHEDULE_NOT_ALLOWED", "Бесплатный перенос уже использован")
    );

    const res = await POST(
      req({ action: "reschedule", date: "2026-09-01", startTime: "12:00", endTime: "16:00" }),
      { params }
    );
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RESCHEDULE_NOT_ALLOWED");
  });
});

describe("POST /api/booking/[token] — акцепт и оплата брони от оператора", () => {
  beforeEach(() => {
    mockFindByToken.mockResolvedValue({ ...booking, status: "PENDING", acceptedOfferAt: null });
    mockBuildAcceptance.mockResolvedValue({
      offerVersionId: "ov-1",
      offerContentHash: "hash",
      acceptedOfferAt: new Date(),
      acceptedMarketing: false,
      acceptedIp: "203.0.113.7",
      acceptedUserAgent: "UA",
    });
    mockCreatePayment.mockResolvedValue({ id: "pay-1", confirmationUrl: "https://pay" });
  });

  it("пишет акцепт и только потом выдаёт ссылку на оплату", async () => {
    const res = await POST(
      req({ action: "pay", acceptOffer: true, offerVersionSlug: "v1" }, { "x-real-ip": "203.0.113.7" }),
      { params }
    );
    const body = await res.json();

    expect(mockBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bk-1" } })
    );
    expect(mockCreatePayment).toHaveBeenCalledWith("bk-1");
    expect(body.data.confirmationUrl).toBe("https://pay");
  });

  it("без отметки о согласии не платит", async () => {
    const res = await POST(req({ action: "pay", offerVersionSlug: "v1" }), { params });

    expect(res.status).toBe(422);
    expect(mockCreatePayment).not.toHaveBeenCalled();
    expect(mockBookingUpdate).not.toHaveBeenCalled();
  });

  it("берёт IP из доверенного заголовка, а не из тела", async () => {
    await POST(
      req(
        { action: "pay", acceptOffer: true, offerVersionSlug: "v1", acceptedIp: "1.2.3.4" },
        { "x-real-ip": "203.0.113.7" }
      ),
      { params }
    );

    expect(mockBuildAcceptance).toHaveBeenCalledWith(
      "gazebos-offer",
      expect.objectContaining({ ip: "203.0.113.7" })
    );
  });

  it("не принимает повторный акцепт по уже акцептованной брони", async () => {
    mockFindByToken.mockResolvedValue({ ...booking, status: "PENDING" });

    const res = await POST(req({ action: "pay", acceptOffer: true, offerVersionSlug: "v1" }), {
      params,
    });
    const body = await res.json();

    expect(body.error.code).toBe("ALREADY_ACCEPTED");
    expect(mockCreatePayment).not.toHaveBeenCalled();
  });

  it("не даёт оплатить уже подтверждённую бронь", async () => {
    mockFindByToken.mockResolvedValue({ ...booking, status: "CONFIRMED", acceptedOfferAt: null });

    const res = await POST(req({ action: "pay", acceptOffer: true, offerVersionSlug: "v1" }), {
      params,
    });
    const body = await res.json();

    expect(body.error.code).toBe("INVALID_STATUS");
  });
});
