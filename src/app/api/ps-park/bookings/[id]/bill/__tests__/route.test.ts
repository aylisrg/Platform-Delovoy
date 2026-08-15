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

const mockGetBookingBill = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    ...actual,
    getBookingBill: (...args: unknown[]) => mockGetBookingBill(...args),
  };
});

import { GET } from "../route";
import { PSBookingError } from "@/modules/ps-park/service";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest() {
  return new NextRequest("http://localhost/api/ps-park/bookings/bk-1/bill");
}

const bill = {
  resourceName: "Стол 1",
  date: "2026-06-15",
  startTime: "10:00",
  endTime: "12:00",
  billedHours: 2,
  pricePerHour: 500,
  hoursCost: 1000,
  items: [],
  itemsTotal: 0,
  totalBill: 1000,
  clientName: "Иван",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockGetBookingBill.mockResolvedValue(bill);
});

describe("GET /api/ps-park/bookings/:id/bill", () => {
  it("менеджеру отдаёт чек по завершённой брони", async () => {
    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetBookingBill).toHaveBeenCalledWith("bk-1");
    expect(body.data.totalBill).toBe(1000);
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(mockGetBookingBill).not.toHaveBeenCalled();
  });

  it("не пускает обычного пользователя — 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockGetBookingBill).not.toHaveBeenCalled();
  });

  it("менеджер без гранта на модуль ps-park — requireAdminSection отклоняет, сервис не вызван (issue #561)", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа к модулю" } }, { status: 403 })
    );

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockGetBookingBill).not.toHaveBeenCalled();
  });

  it("вызывает requireAdminSection с секцией ps-park", async () => {
    await GET(makeRequest(), { params });

    expect(mockRequireAdminSection).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: "mgr-1" }) }),
      "ps-park"
    );
  });

  it("несуществующая бронь — код ошибки сервиса прокидывается как есть", async () => {
    mockGetBookingBill.mockRejectedValue(new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено"));

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockGetBookingBill.mockRejectedValue(new Error("boom"));

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
