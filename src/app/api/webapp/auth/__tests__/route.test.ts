import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockValidateInitData = vi.fn();
vi.mock("@/lib/telegram-webapp", () => ({
  validateInitData: (...args: unknown[]) => mockValidateInitData(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null) },
}));

const mockSignWebAppToken = vi.fn();
vi.mock("@/lib/webapp-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webapp-auth")>(
    "@/lib/webapp-auth"
  );
  return {
    WebAppAuthConfigError: actual.WebAppAuthConfigError,
    signWebAppToken: (...args: unknown[]) => mockSignWebAppToken(...args),
  };
});

const mockGetCapabilities = vi.fn();
vi.mock("@/lib/webapp/capabilities", () => ({
  getWebAppCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
}));

import { prisma } from "@/lib/db";
import { WebAppAuthConfigError } from "@/lib/webapp-auth";
import { POST } from "../route";

const GUEST_CAPS = {
  isStaff: false,
  staffSections: [],
  notificationCategories: [],
  canNotificationCenter: false,
};

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webapp/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const tgUser = { id: 42, first_name: "Иван", last_name: "Петров" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockValidateInitData.mockReturnValue({ user: tgUser, auth_date: 1, hash: "h" });
  mockSignWebAppToken.mockResolvedValue("signed.jwt");
  mockGetCapabilities.mockResolvedValue(GUEST_CAPS);
});

describe("POST /api/webapp/auth", () => {
  it("429 от rate limit — initData не валидируется", async () => {
    const { apiError } = await import("@/lib/api-response");
    mockRateLimit.mockResolvedValue(apiError("RATE_LIMIT_EXCEEDED", "429", 429));

    const res = await POST(makeRequest({ initData: "x" }));
    expect(res.status).toBe(429);
    expect(mockValidateInitData).not.toHaveBeenCalled();
  });

  it("422 без initData", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
  });

  it("401 при невалидном initData", async () => {
    mockValidateInitData.mockReturnValue(null);
    const res = await POST(makeRequest({ initData: "bad" }));
    expect(res.status).toBe(401);
  });

  it("503 NOT_CONFIGURED без серверного секрета — не fallback", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      name: "Иван Петров",
      role: "USER",
      image: null,
      telegramId: "42",
    } as never);
    mockSignWebAppToken.mockRejectedValue(new WebAppAuthConfigError());

    const res = await POST(makeRequest({ initData: "ok" }));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error.code).toBe("NOT_CONFIGURED");
  });

  it("создаёт нового USER и возвращает token+capabilities", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u-new",
      name: "Иван Петров",
      role: "USER",
      image: null,
      telegramId: "42",
    } as never);

    const res = await POST(makeRequest({ initData: "ok" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.token).toBe("signed.jwt");
    expect(json.data.user.role).toBe("USER");
    expect(json.data.capabilities).toEqual(GUEST_CAPS);
    expect(json.data.needsLinking).toBe(true);
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "USER", telegramId: "42" }),
      })
    );
  });

  it("для ADMIN возвращает staff-capabilities из getWebAppCapabilities", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u-admin",
      name: "Иван Петров",
      role: "ADMIN",
      image: null,
      telegramId: "42",
    } as never);
    const staffCaps = {
      isStaff: true,
      staffSections: ["gazebos", "monitoring"],
      notificationCategories: ["bookings", "system"],
      canNotificationCenter: true,
    };
    mockGetCapabilities.mockResolvedValue(staffCaps);

    const res = await POST(makeRequest({ initData: "ok" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.capabilities).toEqual(staffCaps);
    expect(mockGetCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-admin", role: "ADMIN" })
    );
  });
});
