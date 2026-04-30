import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mintBotLoginUrl, MINT_TIMEOUT_MS } from "../bot-login";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_SECRET = process.env.BOT_INTERNAL_SECRET;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mintBotLoginUrl", () => {
  beforeEach(() => {
    process.env.BOT_INTERNAL_SECRET = "test-secret";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_SECRET === undefined) delete process.env.BOT_INTERNAL_SECRET;
    else process.env.BOT_INTERNAL_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it("returns the callback URL on 200 happy path", async () => {
    const expectedCallback = "https://example.test/auth/tg-callback?token=tok_abc";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          token: "tok_abc",
          expiresAt: "2026-04-30T12:05:00.000Z",
          expiresInSec: 300,
          callbackUrl: expectedCallback,
        },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBe(expectedCallback);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toMatch(/\/api\/internal\/auth\/bot-login-token$/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ telegramId: "12345" }));
  });

  it("returns null on 404 USER_NOT_FOUND without warning", async () => {
    const warn = vi.spyOn(console, "warn");
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(404, {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "x" },
        })
      ) as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBeNull();
    // 404 is expected for not-yet-linked users, no warn for that case.
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null on 429 rate limit and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(429, {
          success: false,
          error: { code: "RATE_LIMITED", message: "x" },
        })
      ) as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null on network error (fetch rejects)", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBeNull();
  });

  it("returns null when BOT_INTERNAL_SECRET is missing — no fetch", async () => {
    delete process.env.BOT_INTERNAL_SECRET;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when response body misses callbackUrl", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: { token: "x" } })
      ) as unknown as typeof fetch;

    const url = await mintBotLoginUrl("12345");
    expect(url).toBeNull();
  });

  it("returns null when fetch is aborted (timeout simulated)", async () => {
    // Simulate AbortError to mimic the AbortController timing out.
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              (err as Error & { name: string }).name = "AbortError";
              reject(err);
            });
          }
        })
    ) as unknown as typeof fetch;

    vi.useFakeTimers();
    const promise = mintBotLoginUrl("12345");
    vi.advanceTimersByTime(MINT_TIMEOUT_MS + 10);
    const url = await promise;
    vi.useRealTimers();
    expect(url).toBeNull();
  });
});
