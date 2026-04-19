import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => ({
    user: { id: "admin-1", role: "SUPERADMIN", name: "Admin" },
  })),
}));

// Mock requireAdminSection to always pass
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: vi.fn(() => null),
  };
});

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn(),
}));

// Mock prisma
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

import { GET, PUT } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/notifications/routing", () => {
  it("returns routing rules for all categories", async () => {
    mockFindMany.mockResolvedValue([
      {
        slug: "gazebos",
        config: { telegramAdminChatId: "-100111", telegramAdminChatTitle: "Барбекю чат" },
      },
      {
        slug: "system",
        config: { telegramAdminChatId: "-100999", telegramAdminChatTitle: "Общий" },
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.rules).toHaveLength(7); // 7 categories
    expect(body.data.global.chatId).toBe("-100999");

    const gazebosRule = body.data.rules.find((r: { key: string }) => r.key === "gazebos");
    expect(gazebosRule.chatId).toBe("-100111");
    expect(gazebosRule.chatTitle).toBe("Барбекю чат");
    expect(gazebosRule.usesGlobal).toBe(false);

    const cafeRule = body.data.rules.find((r: { key: string }) => r.key === "cafe");
    expect(cafeRule.chatId).toBeNull();
    expect(cafeRule.usesGlobal).toBe(true);
  });

  it("falls back to env var for global chat ID", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100env");
    mockFindMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(body.data.global.chatId).toBe("-100env");
    vi.unstubAllEnvs();
  });
});

describe("PUT /api/admin/notifications/routing", () => {
  it("updates module config with new chat ID", async () => {
    mockFindUnique.mockResolvedValue({
      slug: "cafe",
      config: { someExisting: true },
    });
    mockUpdate.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/admin/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cafe", chatId: "-100222" }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-100222");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "cafe" },
        data: {
          config: { someExisting: true, telegramAdminChatId: "-100222" },
        },
      })
    );
  });

  it("removes chat ID when set to null (falls back to global)", async () => {
    mockFindUnique.mockResolvedValue({
      slug: "cafe",
      config: { telegramAdminChatId: "-100old", someOther: "keep" },
    });
    mockUpdate.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/admin/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cafe", chatId: null }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          config: { someOther: "keep" },
        },
      })
    );
  });

  it("creates module if it does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/admin/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "feedback", chatId: "-100333" }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "feedback",
          config: { telegramAdminChatId: "-100333" },
        }),
      })
    );
  });

  it("rejects invalid category key", async () => {
    const req = new NextRequest("http://localhost/api/admin/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "invalid-module", chatId: "-100" }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing key", async () => {
    const req = new NextRequest("http://localhost/api/admin/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: "-100" }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
