import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Mini App linking routes — ADR 2026-10-25-team-access-notifications §6.2
 * (`/api/webapp/link/request|confirm|deep-link`), PRD US-E3/US-E4.
 */

vi.mock("@/lib/webapp-auth", () => ({
  verifyWebAppToken: vi.fn(),
  // confirm-роут минтит новый JWT через общий helper (фундамент ребилда);
  // форма "a.b.c" сохраняет проверку json.data.token.split(".").length === 3
  signWebAppToken: vi.fn().mockResolvedValue("mock.jwt.token"),
  WebAppAuthConfigError: class WebAppAuthConfigError extends Error {},
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));

vi.mock("@/modules/telegram-link/service", () => ({
  requestLink: vi.fn(),
  confirmLink: vi.fn(),
  skipLink: vi.fn(),
  processDeepLink: vi.fn(),
  LinkError: class LinkError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

import { verifyWebAppToken, signWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { requestLink, confirmLink, skipLink, processDeepLink, LinkError } from "@/modules/telegram-link/service";
import { POST as requestRoute } from "../request/route";
import { POST as confirmRoute } from "../confirm/route";
import { POST as skipRoute } from "../skip/route";
import { POST as deepLinkRoute } from "../deep-link/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/webapp/link/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const mockUser = { id: "user-1", telegramId: "123456789", role: "USER" };
const GENERIC = "Если такой аккаунт есть, мы отправили код на его email.";
const CONFLICT =
  "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimit).mockResolvedValue(null);
  vi.mocked(signWebAppToken).mockResolvedValue("mock.jwt.token");
});

describe("POST /api/webapp/link/request", () => {
  it("returns 401 without valid JWT", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await requestRoute(makeRequest({ type: "email", value: "u@mail.com" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 422 on invalid body or bad JSON", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);

    const res = await requestRoute(makeRequest({ type: "fax", value: "" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await requestRoute(makeRequest("{oops"))).status).toBe(422);
    expect(requestLink).not.toHaveBeenCalled();
  });

  it("AC-E3.3: happy path — the generic answer; per-user rate limit", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(requestLink).mockResolvedValue({ sent: true, maskedValue: "u***@mail.com", expiresIn: 600, message: GENERIC });

    const res = await requestRoute(makeRequest({ type: "email", value: "u@mail.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ sent: true, maskedValue: "u***@mail.com", expiresIn: 600, message: GENERIC });
    expect(requestLink).toHaveBeenCalledWith("123456789", { type: "email", value: "u@mail.com" });
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "user-1");
  });

  it.each([
    ["PHONE_LINK_UNAVAILABLE", 422],
    ["OTP_DELIVERY_UNAVAILABLE", 503],
    ["OTP_SEND_FAILED", 502],
    ["LINK_BLOCKED", 429],
  ])("AC-E3.5/E3.6: %s → %i", async (code, status) => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(requestLink).mockRejectedValue(new LinkError(code, "Не удалось отправить код", status));
    const res = await requestRoute(makeRequest({ type: "email", value: "u@mail.com" }));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });
});

describe("POST /api/webapp/link/confirm", () => {
  it("returns 401 without JWT", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await confirmRoute(makeRequest({ code: "123456" }));
    expect(res.status).toBe(401);
  });

  it("returns 422 on invalid code format", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);

    const res = await confirmRoute(makeRequest({ code: "abc" }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("happy path: token for the TARGET account with its current session version; no sv in the body", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(confirmLink).mockResolvedValue({
      linked: true,
      merged: true,
      user: { id: "user-email", name: "Ivan", role: "MANAGER", telegramId: "123456789", sessionVersion: 4 },
      token: "",
    });

    const res = await confirmRoute(makeRequest({ code: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      linked: true,
      merged: true,
      user: { id: "user-email", name: "Ivan", role: "MANAGER", telegramId: "123456789" },
      token: "mock.jwt.token",
    });
    expect(json.data.token.split(".")).toHaveLength(3);
    expect(signWebAppToken).toHaveBeenCalledWith({ sub: "user-email", telegramId: "123456789", role: "MANAGER", sv: 4 });
  });

  it("propagates LINK_BLOCKED error", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(confirmLink).mockRejectedValue(new LinkError("LINK_BLOCKED", "Заблокировано", 429));

    const res = await confirmRoute(makeRequest({ code: "000000" }));
    expect(res.status).toBe(429);
  });

  it("AC-E4.1: 409 TELEGRAM_IN_USE_MERGE_REQUESTED with the text, no token issued", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(confirmLink).mockRejectedValue(new LinkError("TELEGRAM_IN_USE_MERGE_REQUESTED", CONFLICT, 409));

    const res = await confirmRoute(makeRequest({ code: "123456" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "TELEGRAM_IN_USE_MERGE_REQUESTED", message: CONFLICT });
    expect(signWebAppToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/webapp/link/skip", () => {
  it("returns 401 without JWT", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);
    const res = await skipRoute(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("happy path: returns skipped=true", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(skipLink).mockResolvedValue(undefined);

    const res = await skipRoute(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.skipped).toBe(true);
  });
});

describe("POST /api/webapp/link/deep-link", () => {
  it("returns 401 without x-bot-token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const res = await deepLinkRoute(makeRequest({ token: "a".repeat(48), telegramId: "tg-999" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong token of the same or another length (constant-time compare)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    for (const header of ["test-tokex", "x"]) {
      const res = await deepLinkRoute(makeRequest({ token: "a".repeat(48), telegramId: "1" }, { "x-bot-token": header }));
      expect(res.status).toBe(401);
    }
    expect(processDeepLink).not.toHaveBeenCalled();
  });

  it("returns 401 when the server has no bot token configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await deepLinkRoute(makeRequest({ token: "a".repeat(48), telegramId: "1" }, { "x-bot-token": "" }));
    expect(res.status).toBe(401);
  });

  it("returns 422 on short token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const res = await deepLinkRoute(
      makeRequest({ token: "short", telegramId: "tg-999" }, { "x-bot-token": "test-token" })
    );
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("happy path: returns linked=true with merged flag", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    vi.mocked(processDeepLink).mockResolvedValue({ linked: true, userName: "Ivan", merged: false });

    const res = await deepLinkRoute(
      makeRequest({ token: "a".repeat(48), telegramId: "tg-999" }, { "x-bot-token": "test-token" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ linked: true, userName: "Ivan", merged: false });
  });

  it("AC-E4.1: 409 TELEGRAM_IN_USE_MERGE_REQUESTED passes through for the bot", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    vi.mocked(processDeepLink).mockRejectedValue(new LinkError("TELEGRAM_IN_USE_MERGE_REQUESTED", CONFLICT, 409));
    const res = await deepLinkRoute(
      makeRequest({ token: "a".repeat(48), telegramId: "1" }, { "x-bot-token": "test-token" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe(CONFLICT);
  });
});
