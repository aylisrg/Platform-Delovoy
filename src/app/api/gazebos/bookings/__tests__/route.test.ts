import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockListBookingsPaginated = vi.fn();
vi.mock("@/modules/gazebos/service", () => ({
  listBookingsPaginated: (...args: unknown[]) => mockListBookingsPaginated(...args),
}));

const mockGetSummaries = vi.fn();
vi.mock("@/modules/payments/service", () => ({
  getBookingPaymentSummaries: (...args: unknown[]) => mockGetSummaries(...args),
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/gazebos/bookings${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSummaries.mockResolvedValue(new Map());
  // SUPERADMIN skips the hasAdminSectionAccess DB lookup in requireAdminSection.
  mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
});

// #431: UI шлёт page/perPage, Zod их отбрасывала (не было в схеме), а сервис
// использовал listBookings() с хардкодом take:100 без skip — стрелки листания
// перезапрашивали тот же срез.
describe("GET /api/gazebos/bookings", () => {
  it("happy path: routes to listBookingsPaginated and returns meta.total/page/perPage", async () => {
    mockListBookingsPaginated.mockResolvedValue({
      bookings: [{ id: "bk-1" }, { id: "bk-2" }],
      total: 45,
      page: 2,
      perPage: 20,
    });

    const res = await GET(makeRequest("?page=2&perPage=20"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.meta).toEqual({ total: 45, page: 2, perPage: 20 });
    expect(mockListBookingsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, perPage: 20 })
    );
  });

  it("defaults to page 1 / perPage 20 when the query has none", async () => {
    mockListBookingsPaginated.mockResolvedValue({ bookings: [], total: 0, page: 1, perPage: 20 });

    await GET(makeRequest(""));

    expect(mockListBookingsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, perPage: 20 })
    );
  });

  it("second page requests a different slice than the first (regression: was always the same take:100)", async () => {
    mockListBookingsPaginated.mockResolvedValue({ bookings: [], total: 0, page: 1, perPage: 20 });
    await GET(makeRequest("?page=1&perPage=20"));

    mockListBookingsPaginated.mockResolvedValue({ bookings: [], total: 0, page: 2, perPage: 20 });
    await GET(makeRequest("?page=2&perPage=20"));

    const calls = mockListBookingsPaginated.mock.calls;
    expect(calls[0][0]).toMatchObject({ page: 1 });
    expect(calls[1][0]).toMatchObject({ page: 2 });
  });

  it("rejects perPage above the cap without calling the service", async () => {
    const res = await GET(makeRequest("?perPage=500"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockListBookingsPaginated).not.toHaveBeenCalled();
  });

  it("enriches bookings with paymentStatus from the batch summary lookup", async () => {
    mockListBookingsPaginated.mockResolvedValue({
      bookings: [{ id: "bk-1" }],
      total: 1,
      page: 1,
      perPage: 20,
    });
    mockGetSummaries.mockResolvedValue(new Map([["bk-1", { status: "PAID" }]]));

    const res = await GET(makeRequest(""));
    const json = await res.json();

    expect(json.data[0].paymentStatus).toBe("PAID");
  });

  // #560: this admin listing (client PII: name/phone) had no role check at
  // all — any authenticated session, including plain USER, passed.
  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest(""));

    expect(res.status).toBe(401);
    expect(mockListBookingsPaginated).not.toHaveBeenCalled();
  });

  it("rejects a USER-role session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeRequest(""));

    expect(res.status).toBe(403);
    expect(mockListBookingsPaginated).not.toHaveBeenCalled();
  });
});
