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
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    PSBookingError: actual.PSBookingError,
    getBooking: vi.fn(),
    updateBookingStatus: (...args: unknown[]) => mockUpdateBookingStatus(...args),
    cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
    softDeleteBooking: vi.fn(),
    hardDeleteBooking: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/deletion", () => ({
  authorizeSuperadminDeletion: vi.fn(),
  logDeletion: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { GET, PATCH } from "../route";
import { getBooking as mockGetBooking } from "@/modules/ps-park/service";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ps-park/bookings/bk-1", {
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

// #560: GET had no role check at all — any authenticated session, including
// plain USER, could pull a single booking's PII.
describe("GET /api/ps-park/bookings/:id", () => {
  function makeGetRequest() {
    return new NextRequest("http://localhost/api/ps-park/bookings/bk-1");
  }

  it("returns the booking for a MANAGER session with section access", async () => {
    vi.mocked(mockGetBooking).mockResolvedValue({ id: "bk-1", status: "CONFIRMED" } as never);

    const res = await GET(makeGetRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("bk-1");
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params });

    expect(res.status).toBe(401);
    expect(mockGetBooking).not.toHaveBeenCalled();
  });

  it("rejects a USER-role session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeGetRequest(), { params });

    expect(res.status).toBe(403);
    expect(mockGetBooking).not.toHaveBeenCalled();
  });

  it("respects requireAdminSection denial", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET(makeGetRequest(), { params });

    expect(res.status).toBe(403);
    expect(mockGetBooking).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/ps-park/bookings/:id — валидация тела (#432)", () => {
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
    [{ status: "COMPLETED", subscriptionId: "s".repeat(65) }, "слишком длинный subscriptionId"],
  ] as [Record<string, unknown>, string][])("отдаёт 422: %s", async (body, _case) => {
    const res = await PATCH(makeRequest(body), { params });

    expect(res.status).toBe(422);
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 422 без статуса", async () => {
    const res = await PATCH(makeRequest({ cashAmount: 100 }), { params });

    expect(res.status).toBe(422);
    expect(mockUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 422 на не-JSON тело, а не 500", async () => {
    const res = await PATCH(makeRequest("не json"), { params });

    expect(res.status).toBe(422);
  });

  it("пропускает валидную разбивку и абонемент в сервис", async () => {
    const res = await PATCH(
      makeRequest({
        status: "COMPLETED",
        cashAmount: 600,
        cardAmount: 400,
        subscriptionId: "sub-1",
      }),
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
      undefined,
      "MANAGER",
      "sub-1"
    );
  });

  it("пустой subscriptionId читается как «без абонемента»", async () => {
    await PATCH(
      makeRequest({ status: "COMPLETED", cashAmount: 1000, cardAmount: 0, subscriptionId: "" }),
      { params }
    );

    expect(mockUpdateBookingStatus).toHaveBeenCalledWith(
      "bk-1",
      "COMPLETED",
      "mgr-1",
      undefined,
      1000,
      0,
      undefined,
      "MANAGER",
      undefined
    );
  });

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
      undefined,
      "MANAGER",
      undefined
    );
  });

  it("USER не может менять чужой статус, но отменяет свою сессию", async () => {
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
