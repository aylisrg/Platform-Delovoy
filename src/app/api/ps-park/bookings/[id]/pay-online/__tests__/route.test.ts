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

const mockFindUniqueResource = vi.fn();
const mockFindUniqueUser = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    resource: { findUnique: (...args: unknown[]) => mockFindUniqueResource(...args) },
    user: { findUnique: (...args: unknown[]) => mockFindUniqueUser(...args) },
  },
}));

const mockGetBooking = vi.fn();
const mockGetBookingBill = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    PSBookingError: actual.PSBookingError,
    getBooking: (...args: unknown[]) => mockGetBooking(...args),
    getBookingBill: (...args: unknown[]) => mockGetBookingBill(...args),
  };
});

const mockCreateOnlinePayment = vi.fn();
vi.mock("@/modules/payments/service", () => ({
  createOnlinePayment: (...args: unknown[]) => mockCreateOnlinePayment(...args),
}));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({ logAudit: (...args: unknown[]) => mockLogAudit(...args) }));

import { POST } from "../route";
import { PSBookingError } from "@/modules/ps-park/service";
import { PaymentError } from "@/modules/payments/types";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest() {
  return new NextRequest("http://localhost/api/ps-park/bookings/bk-1/pay-online", { method: "POST" });
}

const booking = {
  id: "bk-1",
  resourceId: "res-1",
  userId: "user-1",
  clientPhone: "+79001234567",
  status: "CONFIRMED",
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockGetBooking.mockResolvedValue(booking);
  mockGetBookingBill.mockResolvedValue({ totalBill: 1000 });
  mockFindUniqueResource.mockResolvedValue({ name: "Стол 1" });
  mockFindUniqueUser.mockResolvedValue({ email: "user@example.com", phone: "+79001234567" });
  mockCreateOnlinePayment.mockResolvedValue({
    id: "pay-1",
    confirmationUrl: "https://yookassa.ru/pay/pay-1",
  });
});

describe("POST /api/ps-park/bookings/:id/pay-online", () => {
  it("менеджер создаёт платёжную ссылку на остаток счёта", async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockCreateOnlinePayment).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: "bk-1", moduleSlug: "ps-park", amount: 1000 })
    );
    expect(body.data.paymentId).toBe("pay-1");
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(mockCreateOnlinePayment).not.toHaveBeenCalled();
  });

  it("не пускает обычного пользователя — 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCreateOnlinePayment).not.toHaveBeenCalled();
  });

  it("#622: менеджер без ModuleAssignment на ps-park — requireAdminSection отклоняет", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(mockGetBooking).not.toHaveBeenCalled();
    expect(mockCreateOnlinePayment).not.toHaveBeenCalled();
  });

  it("бронь не найдена — 404", async () => {
    mockGetBooking.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("issue #625: ищет бронь через сервисный getBooking (фильтрует deletedAt: null), а не напрямую через Prisma", async () => {
    await POST(makeRequest(), { params });

    expect(mockGetBooking).toHaveBeenCalledWith("bk-1");
  });

  it("issue #671: берёт email из booking.metadata, если у User email не задан", async () => {
    mockFindUniqueUser.mockResolvedValue({ email: null, phone: "+79001234567" });
    mockGetBooking.mockResolvedValue({
      ...booking,
      metadata: { email: "guest@example.com" },
    });

    await POST(makeRequest(), { params });

    expect(mockCreateOnlinePayment).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "guest@example.com" })
    );
  });

  it("issue #671: User.email в приоритете над booking.metadata.email", async () => {
    mockFindUniqueUser.mockResolvedValue({ email: "user@example.com", phone: "+79001234567" });
    mockGetBooking.mockResolvedValue({
      ...booking,
      metadata: { email: "guest@example.com" },
    });

    await POST(makeRequest(), { params });

    expect(mockCreateOnlinePayment).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "user@example.com" })
    );
  });

  it("счёт уже оплачен онлайн — 409 NOTHING_TO_PAY", async () => {
    mockGetBookingBill.mockResolvedValue({ totalBill: 1000 });
    mockGetBooking.mockResolvedValue({
      ...booking,
      metadata: { onlinePaidAmount: "1000" },
    });

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("NOTHING_TO_PAY");
    expect(mockCreateOnlinePayment).not.toHaveBeenCalled();
  });

  it("ошибка платёжного провайдера — код прокидывается как есть", async () => {
    mockCreateOnlinePayment.mockRejectedValue(new PaymentError("PROVIDER_ERROR", "ЮKassa недоступна"));

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("PROVIDER_ERROR");
  });

  it("ошибка сервиса бронирований — код прокидывается как есть", async () => {
    mockGetBookingBill.mockRejectedValue(new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено"));

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("неожиданная ошибка — 500, без утечки деталей", async () => {
    mockCreateOnlinePayment.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
