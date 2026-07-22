import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleRelay, type RelayEnv } from "../worker";

const SECRET = "s3cr3t-prefix";
const ORIGIN = "https://delovoy-tg-relay.example.workers.dev";

let fetchMock: ReturnType<typeof vi.fn>;

function req(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("telegram relay worker", () => {
  it("forwards a valid /<secret>/bot<token>/<method> POST to api.telegram.org", async () => {
    const body = JSON.stringify({ chat_id: "1", text: "hi" });
    const res = await handleRelay(
      req(`/${SECRET}/bot123:ABC/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      { RELAY_SECRET: SECRET }
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("preserves the query string on GET (e.g. getMe / getChat)", async () => {
    await handleRelay(req(`/${SECRET}/bot123:ABC/getChat?chat_id=42`), {
      RELAY_SECRET: SECRET,
    });
    const [target] = fetchMock.mock.calls[0] as [string];
    expect(target).toBe("https://api.telegram.org/bot123:ABC/getChat?chat_id=42");
  });

  it("supports file-download paths (/file/bot<token>/<path>)", async () => {
    await handleRelay(req(`/${SECRET}/file/bot123:ABC/photos/file_1.jpg`), {
      RELAY_SECRET: SECRET,
    });
    const [target] = fetchMock.mock.calls[0] as [string];
    expect(target).toBe("https://api.telegram.org/file/bot123:ABC/photos/file_1.jpg");
  });

  it("rejects a wrong secret with 404 and never touches upstream", async () => {
    const res = await handleRelay(req(`/wrong-secret/bot123:ABC/getMe`), {
      RELAY_SECRET: SECRET,
    });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-Bot-API path with 400", async () => {
    const res = await handleRelay(req(`/${SECRET}/evil/path`), { RELAY_SECRET: SECRET });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 when RELAY_SECRET is not configured", async () => {
    const res = await handleRelay(req(`/${SECRET}/bot123:ABC/getMe`), {} as RelayEnv);
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("ALLOWED_BOT_ID pin", () => {
    it("forwards when the bot id matches", async () => {
      const res = await handleRelay(req(`/${SECRET}/bot123:ABC/getMe`), {
        RELAY_SECRET: SECRET,
        ALLOWED_BOT_ID: "123",
      });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects a different bot id with 403", async () => {
      const res = await handleRelay(req(`/${SECRET}/bot999:XYZ/getMe`), {
        RELAY_SECRET: SECRET,
        ALLOWED_BOT_ID: "123",
      });
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("maps an upstream network failure to 502 without leaking the target URL", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT api.telegram.org"));
    const res = await handleRelay(
      req(`/${SECRET}/bot123:ABC/sendMessage`, { method: "POST", body: "{}" }),
      { RELAY_SECRET: SECRET }
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("bot123:ABC");
    expect(text).not.toContain("api.telegram.org");
  });
});
