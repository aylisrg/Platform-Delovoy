import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the config NextAuth is called with to exercise the real callbacks.
type JwtArgs = { token: Record<string, unknown>; user?: Record<string, unknown>; trigger?: string };
type Captured = {
  callbacks: { jwt: (args: JwtArgs) => Promise<Record<string, unknown> | null> };
  events: { signIn: (msg: Record<string, unknown>) => Promise<void> };
};
const captured = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (c: unknown) => c }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/modules/auth/magic-link-authorize", () => ({ authorizeMagicLinkNonce: vi.fn() }));
vi.mock("@/modules/auth/telegram-token-jwt", () => ({ verifyTelegramTokenJwt: vi.fn() }));
vi.mock("@/modules/auth/telegram-deep-link", () => ({ reserveJti: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAuthEvent: vi.fn() }));
vi.mock("@/lib/auth-providers/vk-id", () => ({ VkIdProvider: () => ({}) }));
vi.mock("@/modules/auth/vk-id-authorize", () => ({ handleVkIdSignIn: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
const mockSections = vi.fn();
vi.mock("@/lib/permissions", () => ({
  getUserAdminSections: (...a: unknown[]) => mockSections(...a),
  ADMIN_SECTION_SLUGS: [],
}));
const mockState = vi.fn();
vi.mock("@/lib/session-revocation", () => ({
  getAuthState: (...a: unknown[]) => mockState(...a),
}));

import { prisma } from "@/lib/db";
import "@/lib/auth";

function cfg(): Captured {
  return captured.config as Captured;
}

const baseToken = { id: "u1", role: "MANAGER", adminSections: ["cafe"], sv: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockSections.mockResolvedValue(["cafe"]);
});

describe("jwt callback — session revocation (ADR 2026-10-25 §Q1)", () => {
  it("login stamps sv, role and sections from the DB", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", sessionVersion: 5 } as never);
    mockSections.mockResolvedValue(["gazebos", "ps-park", "inventory"]);
    const res = await cfg().callbacks.jwt({ token: { id: "u1" }, user: { id: "u1", role: "ADMIN" } });
    expect(res).toMatchObject({ role: "ADMIN", sv: 5, adminSections: ["gazebos", "ps-park", "inventory"] });
    expect(mockState).not.toHaveBeenCalled();
  });

  it("matching version leaves the token untouched", async () => {
    mockState.mockResolvedValue({ sessionVersion: 2, role: "MANAGER", merged: false });
    const res = await cfg().callbacks.jwt({ token: { ...baseToken } });
    expect(res).toEqual(baseToken);
    expect(mockSections).not.toHaveBeenCalled();
  });

  it("token issued before the column (no sv) is valid while the version is 0", async () => {
    mockState.mockResolvedValue({ sessionVersion: 0, role: "MANAGER", merged: false });
    const { sv: _sv, ...legacy } = baseToken;
    const res = await cfg().callbacks.jwt({ token: { ...legacy } });
    expect(res).toEqual(legacy);
  });

  it("bumped version re-reads role and sections: excluded user loses staff access", async () => {
    mockState.mockResolvedValue({ sessionVersion: 3, role: "USER", merged: false });
    mockSections.mockResolvedValue([]);
    const res = await cfg().callbacks.jwt({ token: { ...baseToken } });
    expect(res).toMatchObject({ role: "USER", adminSections: [], sv: 3 });
  });

  it("merged or deleted account → null (Auth.js clears the session cookie)", async () => {
    mockState.mockResolvedValue({ sessionVersion: 2, role: "USER", merged: true });
    expect(await cfg().callbacks.jwt({ token: { ...baseToken } })).toBeNull();
    mockState.mockResolvedValue(null);
    expect(await cfg().callbacks.jwt({ token: { ...baseToken } })).toBeNull();
  });

  it("infrastructure outage fails open", async () => {
    mockState.mockResolvedValue("unavailable");
    expect(await cfg().callbacks.jwt({ token: { ...baseToken } })).toEqual(baseToken);
  });

  it("section reload failure after a bump drops staff claims instead of keeping stale ones", async () => {
    mockState.mockResolvedValue({ sessionVersion: 9, role: "MANAGER", merged: false });
    mockSections.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await cfg().callbacks.jwt({ token: { ...baseToken } });
    expect(res).toMatchObject({ role: "USER", adminSections: [] });
  });
});

describe("events.signIn — lastLoginAt (ADR 2026-10-25 §Q11)", () => {
  it("records the login time for every provider, including telegram-token", async () => {
    await cfg().events.signIn({ user: { id: "u1" }, account: { provider: "telegram-token" } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastLoginAt: expect.any(Date) },
    });
  });
});
