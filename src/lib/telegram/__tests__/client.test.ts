import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockUndiciFetch = vi.fn();
const mockProxyAgent = vi.fn();
vi.mock("undici", () => ({
  fetch: mockUndiciFetch,
  ProxyAgent: mockProxyAgent,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { telegramApi, getTelegramApiRoot, DEFAULT_TELEGRAM_API_ROOT } from "../client";

function jsonResponse(body: object, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "tkn";
  delete process.env.TELEGRAM_API_ROOT;
  delete process.env.TELEGRAM_PROXY_URL;
});

afterEach(() => {
  delete process.env.TELEGRAM_API_ROOT;
  delete process.env.TELEGRAM_PROXY_URL;
});

describe("getTelegramApiRoot", () => {
  it("defaults to api.telegram.org", () => {
    expect(getTelegramApiRoot()).toBe(DEFAULT_TELEGRAM_API_ROOT);
  });

  it("uses TELEGRAM_API_ROOT and strips trailing slashes", () => {
    process.env.TELEGRAM_API_ROOT = "https://relay.example.com//";
    expect(getTelegramApiRoot()).toBe("https://relay.example.com");
  });

  it("ignores empty TELEGRAM_API_ROOT", () => {
    process.env.TELEGRAM_API_ROOT = "  ";
    expect(getTelegramApiRoot()).toBe(DEFAULT_TELEGRAM_API_ROOT);
  });
});

describe("telegramApi", () => {
  it("POSTs JSON to the default root with a timeout signal", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 5 } }));

    const res = await telegramApi<{ message_id: number }>("sendMessage", { chat_id: "1", text: "hi" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottkn/sendMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ chat_id: "1", text: "hi" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(res).toEqual({ ok: true, result: { message_id: 5 }, status: 200 });
  });

  it("targets TELEGRAM_API_ROOT when set", async () => {
    process.env.TELEGRAM_API_ROOT = "https://relay.example.com/";
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: true }));

    await telegramApi("getMe");

    expect(mockFetch.mock.calls[0][0]).toBe("https://relay.example.com/bottkn/getMe");
  });

  it("maps Telegram API errors with description, 400 is not retryable", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: false, description: "Bad Request: chat not found" }, 400));

    const res = await telegramApi("sendMessage", { chat_id: "x" });

    expect(res).toEqual({
      ok: false,
      description: "Bad Request: chat not found",
      status: 400,
      retryable: false,
      transportError: false,
    });
  });

  it.each([429, 500, 503])("marks HTTP %s retryable", async (status) => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: false, description: "err" }, status));

    const res = await telegramApi("sendMessage", {});

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryable).toBe(true);
  });

  it("tolerates responses without json() (legacy mock shape)", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const res = await telegramApi("sendMessage", {});

    expect(res.ok).toBe(true);
  });

  it("falls back to HTTP status when json() throws", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });

    const res = await telegramApi("sendMessage", {});

    expect(res).toEqual({
      ok: false,
      description: "HTTP 502",
      status: 502,
      retryable: true,
      transportError: false,
    });
  });

  it("returns a retryable transport error when fetch rejects", async () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause?: object }).cause = { code: "ETIMEDOUT" };
    mockFetch.mockRejectedValue(err);

    const res = await telegramApi("sendMessage", {});

    expect(res).toEqual({
      ok: false,
      description: "fetch failed (ETIMEDOUT)",
      retryable: true,
      transportError: true,
    });
  });

  it("describes timeouts readably", async () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    mockFetch.mockRejectedValue(err);

    const res = await telegramApi("sendMessage", {}, { timeoutMs: 5000 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.transportError).toBe(true);
      expect(res.description).toContain("Timeout after 5000ms");
      expect(res.description).not.toContain("tkn");
    }
  });

  it("sends FormData as-is without a JSON content type", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: true }));
    const form = new FormData();
    form.append("chat_id", "1");

    await telegramApi("sendPhoto", form);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers).toBeUndefined();
  });

  it("fails fast without a token and never calls fetch", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    const res = await telegramApi("sendMessage", {});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      description: "TELEGRAM_BOT_TOKEN not set",
      retryable: false,
      transportError: false,
    });
  });

  it("prefers an explicit botToken over the env token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: true }));

    await telegramApi("getMe", {}, { botToken: "other" });

    expect(mockFetch.mock.calls[0][0]).toBe("https://api.telegram.org/botother/getMe");
  });

  it("routes through undici ProxyAgent when TELEGRAM_PROXY_URL is set", async () => {
    process.env.TELEGRAM_PROXY_URL = "http://proxy.local:3128";
    mockUndiciFetch.mockResolvedValue(jsonResponse({ ok: true, result: true }));

    const res = await telegramApi("sendMessage", { chat_id: "1" });

    expect(res.ok).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockProxyAgent).toHaveBeenCalledWith("http://proxy.local:3128");
    const [url, init] = mockUndiciFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottkn/sendMessage");
    expect(init.dispatcher).toBeInstanceOf(mockProxyAgent);
  });

  it("does not touch undici without TELEGRAM_PROXY_URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: true }));

    await telegramApi("sendMessage", {});

    expect(mockUndiciFetch).not.toHaveBeenCalled();
    expect(mockProxyAgent).not.toHaveBeenCalled();
  });
});
