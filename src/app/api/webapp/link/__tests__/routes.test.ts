import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/webapp-auth", () => ({
  verifyWebAppToken: vi.fn(),
}));

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

// jose uses real implementation — SignJWT works in Node.js 20 with HS256

import { verifyWebAppToken } from "@/lib/webapp-auth";
import { requestLink, confirmLink, skipLink, processDeepLink, LinkError } from "@/modules/telegram-link/service";
import { POST as requestRoute } from "../request/route";
import { POST as confirmRoute } from "../confirm/route";
import { POST as skipRoute } from "../skip/route";
import { POST as deepLinkRoute } from "../deep-link/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/webapp/link/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const mockUser = { id: "user-1", telegramId: "tg-123", role: "USER" };

beforeEach(() => {
  vi.clearAllMocks();
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

  it("returns 422 on invalid body", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);

    const res = await requestRoute(makeRequest({ type: "fax", value: "" }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("happy path: returns sent=true", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(requestLink).mockResolvedValue({
      sent: true,
      maskedValue: "u***@mail.com",
      expiresIn: 600,
    });

    const res = await requestRoute(makeRequest({ type: "email", value: "u@mail.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.sent).toBe(true);
  });

  it("propagates LinkError from service", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(requestLink).mockRejectedValue(
      new LinkError("ACCOUNT_NOT_FOUND", "Аккаунт не найден", 404)
    );

    const res = await requestRoute(makeRequest({ type: "email", value: "nobody@mail.com" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("ACCOUNT_NOT_FOUND");
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

  it("happy path: returns linked=true with new JWT", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(confirmLink).mockResolvedValue({
      linked: true,
      user: { id: "user-1", name: "Ivan", role: "USER", telegramId: "tg-123" },
      token: "",
    });

    const res = await confirmRoute(makeRequest({ code: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.linked).toBe(true);
    // jose runs real HS256 — token is a valid JWT string
    expect(typeof json.data.token).toBe("string");
    expect(json.data.token.split(".")).toHaveLength(3);
  });

  it("propagates LINK_BLOCKED error", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
    vi.mocked(confirmLink).mockRejectedValue(
      new LinkError("LINK_BLOCKED", "Заблокировано", 429)
    );

    const res = await confirmRoute(makeRequest({ code: "000000" }));
    expect(res.status).toBe(429);
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
  const validToken = process.env.TELEGRAM_BOT_TOKEN ?? "test-bot-token";

  it("returns 401 without x-bot-token", async () => {
    const res = await deepLinkRoute(
      makeRequest({ token: "a".repeat(48), telegramId: "tg-999" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 422 on short token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const res = await deepLinkRoute(
      makeRequest(
        { token: "short", telegramId: "tg-999" },
        { "x-bot-token": "test-token" }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("happy path: returns linked=true", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    vi.mocked(processDeepLink).mockResolvedValue({
      linked: true,
      userName: "Ivan",
    });

    const res = await deepLinkRoute(
      makeRequest(
        { token: "a".repeat(48), telegramId: "tg-999" },
        { "x-bot-token": "test-token" }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.linked).toBe(true);
    expect(json.data.userName).toBe("Ivan");
  });
});
