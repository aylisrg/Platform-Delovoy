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

const mockUpdateBookingStatus = vi.fn();
const mockCancelBooking = vi.fn();
const mockRescheduleBooking = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    BookingError: actual.BookingError,
    getBooking: vi.fn(),
    updateBookingStatus: (...args: unknown[]) => mockUpdateBookingStatus(...args),
    cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
    rescheduleBooking: (...args: unknown[]) => mockRescheduleBooking(...args),
  };
});

vi.mock("@/lib/logger", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/deletion", () => ({
  authorizeSuperadminDeletion: vi.fn(),
  logDeletion: vi.fn(),
}));
vi.mock("@/modules/notifications/queue", () => ({ enqueueNotification: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { PATCH } from "../route";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos/bookings/bk-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockUpdateBookingStatus.mockResolvedValue({ id: "bk-1", status: "COMPLETED", metadata: null });
  mockCancelBooking.mockResolvedValue({
    penaltyRequired: false,
    booking: { id: "bk-1", status: "CANCELLED", metadata: null },
  });
});

describe("PATCH /api/gazebos/bookings/:id — валидация тела (#432)", () => {
  // Ядро бага: 2000 нал / −1000 карта при счёте 1000 проходило гейт
  // PAYMENT_REQUIRED (сумма сходится) и уезжало в FinancialTransaction,
  // искажая сверку смены.
  it("отдаёт 422 на отрицательный cardAmount и не трогает сервис", async () => {
    const res = await PATCH(
      makeRequest({ status: "COMPLETED", cashAmount: 2000, cardAmount: -1000 }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 422 на отрицательный cashAmount", async () => {
    const res = await PATCH(
      makeRequest({ status: "COMPLETED", cashAmount: -500, cardAmount: 1500 }),
      { params }
    );

    expect(res.status).toBe(422);
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "PAID" }, "статуса нет в enum"],
    [{ status: 42 }, "статус не строка"],
    [{ status: "COMPLETED", reason: "x".repeat(501) }, "reason длиннее 500"],
    [{ status: "COMPLETED", cashAmount: "1000" }, "сумма строкой"],
    [{ status: "COMPLETED", cashAmount: 10_000_001 }, "сумма выше потолка"],
  ] as [Record<string, unknown>, string][])("отдаёт 422: %s", async (body, _case) => {
    const res = await PATCH(makeRequest(body), { params });

    expect(res.status).toBe(422);
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 422 на не-JSON тело, а не 500", async () => {
    const res = await PATCH(makeRequest("не json"), { params });

    expect(res.status).toBe(422);
  });

  it("пропускает валидную разбивку в сервис", async () => {
    const res = await PATCH(
      makeRequest({ status: "COMPLETED", cashAmount: 600, cardAmount: 400 }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mockUpdateBookingStatus).toHaveBeenCalledWith(
      "bk-1",
      "COMPLETED",
      "mgr-1",
      undefined,
      600,
      400,
      undefined
    );
  });

  // nullish, а не строгий optional: клиенты присылают «нет суммы» и как
  // пропуск ключа, и как null — 422 здесь ломал бы завершение брони.
  it("принимает null в суммах и причине, передавая undefined в сервис", async () => {
    const res = await PATCH(
      makeRequest({ status: "CONFIRMED", cashAmount: null, cardAmount: null, reason: null }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mockUpdateBookingStatus).toHaveBeenCalledWith(
      "bk-1",
      "CONFIRMED",
      "mgr-1",
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it("не считает discountPercent=0 скидкой и завершает бронь без неё", async () => {
    const res = await PATCH(
      makeRequest({ status: "COMPLETED", cashAmount: 1000, cardAmount: 0, discountPercent: 0 }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mockUpdateBookingStatus).toHaveBeenCalledWith(
      "bk-1",
      "COMPLETED",
      "mgr-1",
      undefined,
      1000,
      0,
      undefined
    );
  });

  it("режим правки брони (без status) по-прежнему идёт в rescheduleBooking", async () => {
    mockRescheduleBooking.mockResolvedValue({ id: "bk-1" });

    const res = await PATCH(makeRequest({ startTime: "10:00", endTime: "12:00" }), { params });

    expect(res.status).toBe(200);
    expect(mockRescheduleBooking).toHaveBeenCalled();
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it("USER не может менять чужой статус, но отменяет свою бронь", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const forbidden = await PATCH(makeRequest({ status: "COMPLETED" }), { params });
    expect(forbidden.status).toBe(403);

    const cancelled = await PATCH(makeRequest({ status: "CANCELLED" }), { params });
    expect(cancelled.status).toBe(200);
    expect(mockCancelBooking).toHaveBeenCalledWith("bk-1", "user-1", undefined, false);
  });

  it("отдаёт 401 без сессии", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ status: "COMPLETED" }), { params });

    expect(res.status).toBe(401);
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });
});
