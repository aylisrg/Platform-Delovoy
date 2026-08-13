import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

const mockGetUserAdminSections = vi.fn();
vi.mock("@/lib/permissions", () => ({
  getUserAdminSections: (...args: unknown[]) => mockGetUserAdminSections(...args),
}));

import { prisma } from "@/lib/db";
import {
  signWebAppToken,
  verifyWebAppToken,
  loadWebAppStaff,
  WebAppAuthConfigError,
} from "../webapp-auth";

const VALID_SECRET = "test-secret-with-enough-length";

function makeRequest(token?: string) {
  return new NextRequest("http://localhost/api/webapp/feed", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", VALID_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signWebAppToken / verifyWebAppToken", () => {
  it("бросает WebAppAuthConfigError при пустом секрете (нет fallback)", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    await expect(
      signWebAppToken({ sub: "u1", telegramId: "123", role: "USER" })
    ).rejects.toBeInstanceOf(WebAppAuthConfigError);
  });

  it("бросает WebAppAuthConfigError при коротком секрете", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "short");
    await expect(
      signWebAppToken({ sub: "u1", telegramId: "123", role: "USER" })
    ).rejects.toBeInstanceOf(WebAppAuthConfigError);
  });

  it("round-trip: sign → verify возвращает {id, telegramId, role}", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "MANAGER",
    });
    const user = await verifyWebAppToken(makeRequest(token));
    expect(user).toEqual({ id: "u1", telegramId: "123", role: "MANAGER" });
  });

  it("возвращает null без заголовка Authorization", async () => {
    expect(await verifyWebAppToken(makeRequest())).toBeNull();
  });

  it("возвращает null для токена с чужой подписью", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "USER",
    });
    vi.stubEnv("NEXTAUTH_SECRET", "another-secret-with-enough-length");
    expect(await verifyWebAppToken(makeRequest(token))).toBeNull();
  });

  it("возвращает null при незаданном секрете (verify не падает)", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "USER",
    });
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(await verifyWebAppToken(makeRequest(token))).toBeNull();
  });
});

describe("loadWebAppStaff", () => {
  it("401 при битом токене", async () => {
    const result = await loadWebAppStaff(makeRequest("garbage"));
    expect(result).toEqual({ ok: false, status: 401 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("403 когда в БД role=USER, даже если в токене SUPERADMIN (понижение)", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "SUPERADMIN",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      role: "USER",
      mergedIntoUserId: null,
    } as never);

    const result = await loadWebAppStaff(makeRequest(token));
    expect(result).toEqual({ ok: false, status: 403 });
    expect(mockGetUserAdminSections).not.toHaveBeenCalled();
  });

  it("403 когда пользователь удалён/не найден", async () => {
    const token = await signWebAppToken({
      sub: "gone",
      telegramId: "123",
      role: "MANAGER",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await loadWebAppStaff(makeRequest(token))).toEqual({
      ok: false,
      status: 403,
    });
  });

  it("403 для soft-merged пользователя", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "MANAGER",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      role: "MANAGER",
      mergedIntoUserId: "primary-user",
    } as never);
    expect(await loadWebAppStaff(makeRequest(token))).toEqual({
      ok: false,
      status: 403,
    });
  });

  it("ok для MANAGER: роль и секции берутся из БД", async () => {
    const token = await signWebAppToken({
      sub: "u1",
      telegramId: "123",
      role: "USER", // токен намеренно врёт в другую сторону
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      role: "MANAGER",
      mergedIntoUserId: null,
    } as never);
    mockGetUserAdminSections.mockResolvedValue(["gazebos", "cafe"]);

    const result = await loadWebAppStaff(makeRequest(token));
    expect(result).toEqual({
      ok: true,
      staff: { id: "u1", role: "MANAGER", sections: ["gazebos", "cafe"] },
    });
  });
});
