import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRequireAdminSection = vi.fn();
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-response")>("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: (...args: unknown[]) => mockRequireAdminSection(...args),
  };
});

const mockRecordPrepayment = vi.fn();
vi.mock("@/modules/booking/prepayment", async () => {
  const actual = await vi.importActual<typeof import("@/modules/booking/prepayment")>(
    "@/modules/booking/prepayment"
  );
  return {
    ...actual,
    recordPrepayment: (...args: unknown[]) => mockRecordPrepayment(...args),
  };
});

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "../route";
import { BookingPrepaymentError } from "@/modules/booking/prepayment";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos/bookings/bk-1/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockRecordPrepayment.mockResolvedValue({ id: "bk-1", status: "CONFIRMED" });
});

describe("POST /api/gazebos/bookings/:id/payment", () => {
  it("записывает принятую оплату, не меняя статус брони", async () => {
    const res = await POST(makeRequest({ cashAmount: 8000, cardAmount: 0 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Бронь осталась активной — оплата это отдельная ось.
    expect(body.data.status).toBe("CONFIRMED");
    expect(mockRecordPrepayment).toHaveBeenCalledWith({
      bookingId: "bk-1",
      moduleSlug: "gazebos",
      actorId: "mgr-1",
      cashAmount: 8000,
      cardAmount: 0,
    });
  });

  it("принимает оплату только картой", async () => {
    await POST(makeRequest({ cardAmount: 2500 }), { params });

    expect(mockRecordPrepayment).toHaveBeenCalledWith(
      expect.objectContaining({ cashAmount: 0, cardAmount: 2500 })
    );
  });

  it("требует авторизацию", async () => {
    mockAuth.mockResolvedValue(null);

    expect((await POST(makeRequest({ cashAmount: 100 }), { params })).status).toBe(401);
  });

  it("не пускает обычного пользователя", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-1", role: "USER" } });

    expect((await POST(makeRequest({ cashAmount: 100 }), { params })).status).toBe(403);
    expect(mockRecordPrepayment).not.toHaveBeenCalled();
  });

  it("уважает ограничение по разделу", async () => {
    mockRequireAdminSection.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 403 })
    );

    expect((await POST(makeRequest({ cashAmount: 100 }), { params })).status).toBe(403);
    expect(mockRecordPrepayment).not.toHaveBeenCalled();
  });

  it("отклоняет нулевую оплату валидацией", async () => {
    const res = await POST(makeRequest({ cashAmount: 0, cardAmount: 0 }), { params });

    expect(res.status).toBe(422);
    expect(mockRecordPrepayment).not.toHaveBeenCalled();
  });

  it("отклоняет отрицательную сумму", async () => {
    const res = await POST(makeRequest({ cashAmount: -500 }), { params });

    expect(res.status).toBe(422);
  });

  it("закрытая бронь отдаёт 409 с понятным кодом", async () => {
    mockRecordPrepayment.mockRejectedValue(
      new BookingPrepaymentError("BOOKING_CLOSED", "Бронь уже закрыта — оплату по ней принять нельзя")
    );

    const res = await POST(makeRequest({ cashAmount: 100 }), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("BOOKING_CLOSED");
  });
});
