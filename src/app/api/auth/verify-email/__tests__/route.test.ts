import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockVerifyMagicLink, mockGenerateSignInNonce, mockConsumeCallbackUrl } =
  vi.hoisted(() => ({
    mockVerifyMagicLink: vi.fn(),
    mockGenerateSignInNonce: vi.fn(),
    mockConsumeCallbackUrl: vi.fn(),
  }));

vi.mock("@/modules/auth/email-magic-link.service", () => ({
  verifyMagicLink: mockVerifyMagicLink,
  generateSignInNonce: mockGenerateSignInNonce,
  consumeMagicLinkCallbackUrl: mockConsumeCallbackUrl,
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  // По умолчанию адреса возврата нет — обычный вход по ссылке из письма.
  mockConsumeCallbackUrl.mockResolvedValue(null);
});

function urlWith(params: Record<string, string>): Request {
  const url = new URL("https://example.test/api/auth/verify-email");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe("GET /api/auth/verify-email", () => {
  it("happy path: token valid → redirect with nonce in ?magic= (NOT userId)", async () => {
    mockVerifyMagicLink.mockResolvedValue({
      userId: "user-cuid-001",
      isNewUser: false,
    });
    mockGenerateSignInNonce.mockResolvedValue(
      "abcdef0123456789".repeat(4) // 64 hex chars
    );

    const res = await GET(urlWith({ token: "valid-tok", email: "u@e.com" }));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.pathname).toBe("/auth/signin");
    const magic = url.searchParams.get("magic");
    expect(magic).toBeTruthy();
    // Critical: nonce must NOT equal userId (the whole point of the fix)
    expect(magic).not.toBe("user-cuid-001");
    // Nonce should be the 64-char hex from generateSignInNonce
    expect(magic).toMatch(/^[0-9a-f]{64}$/);
    expect(mockGenerateSignInNonce).toHaveBeenCalledWith("user-cuid-001");
  });

  it("invalid params (missing token) → ?error=invalid-link", async () => {
    const res = await GET(urlWith({ email: "u@e.com" }));
    const location = res.headers.get("location") || "";
    expect(location).toContain("/auth/signin?error=invalid-link");
    expect(mockVerifyMagicLink).not.toHaveBeenCalled();
  });

  it("TOKEN_INVALID from service → ?error=invalid-link", async () => {
    mockVerifyMagicLink.mockRejectedValue(new Error("TOKEN_INVALID"));
    const res = await GET(urlWith({ token: "bad", email: "u@e.com" }));
    const location = res.headers.get("location") || "";
    expect(location).toContain("/auth/signin?error=invalid-link");
    expect(mockGenerateSignInNonce).not.toHaveBeenCalled();
  });

  it("TOKEN_EXPIRED from service → ?error=link-expired", async () => {
    mockVerifyMagicLink.mockRejectedValue(new Error("TOKEN_EXPIRED"));
    const res = await GET(urlWith({ token: "old", email: "u@e.com" }));
    const location = res.headers.get("location") || "";
    expect(location).toContain("/auth/signin?error=link-expired");
  });

  it("REDIS_UNAVAILABLE from generateSignInNonce → ?error=link-expired (fail-closed)", async () => {
    mockVerifyMagicLink.mockResolvedValue({
      userId: "user-002",
      isNewUser: false,
    });
    mockGenerateSignInNonce.mockRejectedValue(
      new Error("REDIS_UNAVAILABLE")
    );
    const res = await GET(urlWith({ token: "valid", email: "u@e.com" }));
    const location = res.headers.get("location") || "";
    expect(location).toContain("/auth/signin?error=link-expired");
    // The bare userId must NOT leak into the URL on failure
    expect(location).not.toContain("user-002");
  });
});

/**
 * Возврат на запрошенную страницу после входа по ссылке из письма (PR #916).
 * До этого magic-link терял callbackUrl и всегда уводил на дашборд по роли —
 * то есть мимо страницы, ради которой пользователь и пошёл логиниться.
 */
describe("GET /api/auth/verify-email — адрес возврата", () => {
  beforeEach(() => {
    mockVerifyMagicLink.mockResolvedValue({ userId: "u1", isNewUser: false });
    mockGenerateSignInNonce.mockResolvedValue("a".repeat(64));
  });

  it("сохранённый внутренний путь доезжает до страницы входа", async () => {
    mockConsumeCallbackUrl.mockResolvedValue("/for-team");

    const res = await GET(urlWith({ token: "t", email: "u@e.com" }));
    const url = new URL(res.headers.get("location") || "");

    expect(url.pathname).toBe("/auth/signin");
    expect(url.searchParams.get("magic")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("callbackUrl")).toBe("/for-team");
    expect(mockConsumeCallbackUrl).toHaveBeenCalledWith("t");
  });

  it("без сохранённого адреса параметр не добавляется", async () => {
    mockConsumeCallbackUrl.mockResolvedValue(null);

    const res = await GET(urlWith({ token: "t", email: "u@e.com" }));
    const url = new URL(res.headers.get("location") || "");

    expect(url.searchParams.has("callbackUrl")).toBe(false);
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com/x"])(
    "чужой адрес %s отбрасывается, вход не ломается",
    async (evil) => {
      mockConsumeCallbackUrl.mockResolvedValue(evil);

      const res = await GET(urlWith({ token: "t", email: "u@e.com" }));
      const url = new URL(res.headers.get("location") || "");

      expect(url.host).toBe("example.test");
      expect(url.pathname).toBe("/auth/signin");
      expect(url.searchParams.has("callbackUrl")).toBe(false);
      // вход всё равно состоялся — nonce на месте
      expect(url.searchParams.get("magic")).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("недоступный Redis (null) не мешает войти", async () => {
    mockConsumeCallbackUrl.mockResolvedValue(null);

    const res = await GET(urlWith({ token: "t", email: "u@e.com" }));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });
});
