import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/webapp-auth", () => ({
  loadWebAppStaff: vi.fn(),
  verifyWebAppToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockGetCenter = vi.fn();
const mockSetPreference = vi.fn();
vi.mock("@/modules/notifications/webapp-center", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/notifications/webapp-center")
  >("@/modules/notifications/webapp-center");
  return {
    CenterError: actual.CenterError,
    getNotificationCenter: (...args: unknown[]) => mockGetCenter(...args),
    setEventPreference: (...args: unknown[]) => mockSetPreference(...args),
  };
});

import { loadWebAppStaff, verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { CenterError } from "@/modules/notifications/webapp-center";
import { GET, PUT } from "../route";

const staff = { id: "u1", role: "MANAGER" as const, sections: ["gazebos"] };

const centerView = {
  role: "MANAGER",
  channel: { kind: "TELEGRAM", status: "active", provisionedNow: true },
  categories: [],
  protected: [],
};

function makeRequest(body?: unknown) {
  return new NextRequest("http://localhost/api/webapp/notification-center", {
    method: body === undefined ? "GET" : "PUT",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadWebAppStaff).mockResolvedValue({ ok: true, staff });
  vi.mocked(verifyWebAppToken).mockResolvedValue({
    id: "u1",
    telegramId: "555",
    role: "MANAGER",
  });
  vi.mocked(rateLimit).mockResolvedValue(null);
  mockGetCenter.mockResolvedValue(centerView);
  mockSetPreference.mockResolvedValue({
    eventType: "booking.created",
    enabled: false,
  });
});

describe("GET /api/webapp/notification-center", () => {
  it("401 без валидного токена — сервис не вызывается", async () => {
    vi.mocked(loadWebAppStaff).mockResolvedValue({ ok: false, status: 401 });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(mockGetCenter).not.toHaveBeenCalled();
  });

  it("403 при понижении роли (ре-чек из БД)", async () => {
    vi.mocked(loadWebAppStaff).mockResolvedValue({ ok: false, status: 403 });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(mockGetCenter).not.toHaveBeenCalled();
  });

  it("200: сервис получает staff из БД и telegramId из подписанного токена", async () => {
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(centerView);
    expect(mockGetCenter).toHaveBeenCalledWith(staff, "555");
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "u1");
  });

  it("отдаёт 429 из rate limit, не вызывая сервис", async () => {
    const { apiError } = await import("@/lib/api-response");
    vi.mocked(rateLimit).mockResolvedValue(
      apiError("RATE_LIMIT_EXCEEDED", "Слишком много запросов", 429)
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(429);
    expect(mockGetCenter).not.toHaveBeenCalled();
  });
});

describe("PUT /api/webapp/notification-center", () => {
  it("422 на eventType вне каталога (закрытый enum)", async () => {
    const res = await PUT(makeRequest({ eventType: "health.down", enabled: true }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockSetPreference).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("422 на нестроковом enabled", async () => {
    const res = await PUT(
      makeRequest({ eventType: "booking.created", enabled: "yes" })
    );

    expect(res.status).toBe(422);
    expect(mockSetPreference).not.toHaveBeenCalled();
  });

  it("403, когда у сотрудника нет доступа к секции категории", async () => {
    mockSetPreference.mockRejectedValue(
      new CenterError("FORBIDDEN", "Нет доступа к этой категории уведомлений", 403)
    );

    const res = await PUT(makeRequest({ eventType: "order.placed", enabled: true }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("401 без токена — предпочтение не пишется", async () => {
    vi.mocked(loadWebAppStaff).mockResolvedValue({ ok: false, status: 401 });

    const res = await PUT(
      makeRequest({ eventType: "booking.created", enabled: false })
    );

    expect(res.status).toBe(401);
    expect(mockSetPreference).not.toHaveBeenCalled();
  });

  it("200: пишет предпочтение и аудит мутации", async () => {
    const res = await PUT(
      makeRequest({ eventType: "booking.created", enabled: false })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ eventType: "booking.created", enabled: false });
    expect(mockSetPreference).toHaveBeenCalledWith(staff, "booking.created", false);
    expect(mockLogAudit).toHaveBeenCalledWith(
      "u1",
      "notification.preference.update",
      "NotificationEventPreference",
      "booking.created",
      { enabled: false, source: "webapp" }
    );
  });
});
