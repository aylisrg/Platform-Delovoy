import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before importing the module under test.
vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    critical: vi.fn().mockResolvedValue(undefined),
  },
}));

import { log } from "@/lib/logger";
import {
  buildOfflineConversionsCsv,
  extractYmUid,
} from "../metrika-server";

type FakeRequest = {
  cookies: { get: (name: string) => { value: string } | undefined };
};

const makeRequest = (cookieValue?: string): FakeRequest => ({
  cookies: {
    get: (name: string) =>
      name === "_ym_uid" && cookieValue !== undefined ? { value: cookieValue } : undefined,
  },
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // Default: token + counter present so tests opt-in to "no-op" by removing them.
  process.env.YANDEX_METRIKA_COUNTER_ID = "73068007";
  process.env.YANDEX_OAUTH_TOKEN = "test-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("extractYmUid", () => {
  it("returns ClientId when cookie is a digit string", () => {
    const req = makeRequest("1714400000123456789");
    expect(extractYmUid(req as unknown as Parameters<typeof extractYmUid>[0])).toBe(
      "1714400000123456789"
    );
  });

  it("returns null when cookie missing", () => {
    const req = makeRequest(undefined);
    expect(extractYmUid(req as unknown as Parameters<typeof extractYmUid>[0])).toBeNull();
  });

  it("returns null for non-numeric cookie value (defensive)", () => {
    const req = makeRequest("abc-not-a-clientid");
    expect(extractYmUid(req as unknown as Parameters<typeof extractYmUid>[0])).toBeNull();
  });
});

describe("buildOfflineConversionsCsv", () => {
  it("includes the required header and one row", () => {
    const csv = buildOfflineConversionsCsv([
      {
        clientId: "1714400000123456789",
        target: "office_inquiry_success",
        dateTimeSeconds: 1714400000,
        price: 0,
        currency: "RUB",
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("ClientId,Target,DateTime,Price,Currency");
    expect(lines[1]).toBe(
      "1714400000123456789,office_inquiry_success,1714400000,0,RUB"
    );
  });
});

describe("trackServerGoal", () => {
  // Re-import inside each test so module-level env reads use the patched value.
  // Vitest resets module registry per test file, but env reads happen at import time
  // inside trackServerGoal (`process.env.X` is read live), so we just import once.

  it("happy path: posts multipart with correct CSV body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { trackServerGoal } = await import("../metrika-server");
    const req = makeRequest("1714400000123456789");
    trackServerGoal({
      request: req as unknown as Parameters<typeof trackServerGoal>[0]["request"],
      target: "office_inquiry_success",
      dateTimeSeconds: 1714400000,
      price: 0,
      currency: "RUB",
    });

    // Wait for the fire-and-forget promise to settle.
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/management/v1/counter/73068007/offline_conversions/upload"
    );
    expect(String(url)).toContain("client_id_type=CLIENT_ID");
    expect((init as { method: string }).method).toBe("POST");

    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("OAuth test-token");

    // FormData body — pull out the file blob and confirm CSV content.
    const body = (init as { body: FormData }).body;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get("file") as Blob;
    expect(file).toBeInstanceOf(Blob);
    const text = await file.text();
    expect(text).toContain("ClientId,Target,DateTime,Price,Currency");
    expect(text).toContain(
      "1714400000123456789,office_inquiry_success,1714400000,0,RUB"
    );
  });

  it("no _ym_uid cookie → does not fetch, logs INFO", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trackServerGoal } = await import("../metrika-server");
    const req = makeRequest(undefined);
    trackServerGoal({
      request: req as unknown as Parameters<typeof trackServerGoal>[0]["request"],
      target: "office_inquiry_success",
    });

    await new Promise((r) => setImmediate(r));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "metrika",
      expect.stringContaining("no _ym_uid"),
      expect.objectContaining({ target: "office_inquiry_success" })
    );
  });

  it("missing OAUTH token → does not fetch (test/dev env)", async () => {
    delete process.env.YANDEX_OAUTH_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trackServerGoal } = await import("../metrika-server");
    const req = makeRequest("1714400000123456789");
    trackServerGoal({
      request: req as unknown as Parameters<typeof trackServerGoal>[0]["request"],
      target: "office_inquiry_success",
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing COUNTER_ID → does not fetch", async () => {
    delete process.env.YANDEX_METRIKA_COUNTER_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trackServerGoal } = await import("../metrika-server");
    const req = makeRequest("1714400000123456789");
    trackServerGoal({
      request: req as unknown as Parameters<typeof trackServerGoal>[0]["request"],
      target: "office_inquiry_success",
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Metrika returns 500 → does not throw, logs WARNING", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { trackServerGoal } = await import("../metrika-server");
    const req = makeRequest("1714400000123456789");

    expect(() =>
      trackServerGoal({
        request: req as unknown as Parameters<typeof trackServerGoal>[0]["request"],
        target: "office_inquiry_success",
      })
    ).not.toThrow();

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      "metrika",
      expect.stringContaining("server goal upload failed"),
      expect.objectContaining({ target: "office_inquiry_success" })
    );
  });
});
