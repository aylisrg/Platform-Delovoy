import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSearchGuestsByPhone = vi.fn();
vi.mock("@/modules/booking/guest-search", () => ({
  searchGuestsByPhone: (...args: unknown[]) => mockSearchGuestsByPhone(...args),
}));

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

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/gazebos/guests/search${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  mockSearchGuestsByPhone.mockResolvedValue([]);
});

describe("GET /api/gazebos/guests/search (issue #666)", () => {
  it("happy path: возвращает найденных гостей", async () => {
    mockSearchGuestsByPhone.mockResolvedValue([{ name: "Иван", phone: "+79991234567" }]);

    const res = await GET(makeRequest("?phone=999"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ name: "Иван", phone: "+79991234567" }]);
    expect(mockSearchGuestsByPhone).toHaveBeenCalledWith("gazebos", "999");
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest("?phone=999"));

    expect(res.status).toBe(401);
    expect(mockSearchGuestsByPhone).not.toHaveBeenCalled();
  });

  it("не пускает роль USER — 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } });

    const res = await GET(makeRequest("?phone=999"));

    expect(res.status).toBe(403);
    expect(mockSearchGuestsByPhone).not.toHaveBeenCalled();
  });

  // AC-4: гейт — доступ к модулю gazebos, а не к CRM-разделу clients.
  it("гейтится через requireAdminSection('gazebos'), не через 'clients'", async () => {
    await GET(makeRequest("?phone=999"));

    expect(mockRequireAdminSection).toHaveBeenCalledWith(expect.anything(), "gazebos");
  });

  it("MANAGER без доступа к модулю gazebos — requireAdminSection отклоняет", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET(makeRequest("?phone=999"));

    expect(res.status).toBe(403);
    expect(mockSearchGuestsByPhone).not.toHaveBeenCalled();
  });

  it("возвращает ошибку валидации при слишком коротком запросе", async () => {
    const res = await GET(makeRequest("?phone=99"));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(mockSearchGuestsByPhone).not.toHaveBeenCalled();
  });

  it("возвращает пустой список без совпадений", async () => {
    mockSearchGuestsByPhone.mockResolvedValue([]);

    const res = await GET(makeRequest("?phone=000"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("рейт-лимитится по authenticated-тиру, per-user (issue #674)", async () => {
    await GET(makeRequest("?phone=999"));

    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "mgr-1");
  });

  it("превышен лимит — 429, поиск не выполняется (issue #674)", async () => {
    mockRateLimit.mockResolvedValue(
      Response.json({ success: false, error: { code: "RATE_LIMITED", message: "Слишком много запросов" } }, { status: 429 })
    );

    const res = await GET(makeRequest("?phone=999"));

    expect(res.status).toBe(429);
    expect(mockSearchGuestsByPhone).not.toHaveBeenCalled();
  });
});
