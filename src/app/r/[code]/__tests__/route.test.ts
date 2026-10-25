import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

const mockResolve = vi.fn();
const mockRecord = vi.fn();
vi.mock("@/modules/notifications/tracking/link-service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/notifications/tracking/link-service")>(
    "@/modules/notifications/tracking/link-service",
  );
  return {
    getAppOrigin: () => "https://delovoy-park.ru",
    isAutomatedRequest: actual.isAutomatedRequest,
    resolveLinkForRedirect: (...a: unknown[]) => mockResolve(...a),
    recordLinkClick: (...a: unknown[]) => mockRecord(...a),
  };
});

import { GET, HEAD } from "../route";

const CODE = "AAAAAAAAAAAAAAAAAAAAAA";
const HOME = "https://delovoy-park.ru/";
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function req(path: string, init: { method?: string; ua?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://delovoy-park.ru${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.ua === undefined ? { "user-agent": BROWSER } : init.ua ? { "user-agent": init.ua } : {}), ...init.headers },
  });
}
const params = (code = CODE) => ({ params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockResolve.mockResolvedValue({ target: "https://delovoy-park.ru/admin/gazebos", linkId: "l1", rootId: "root" });
  mockRecord.mockResolvedValue(undefined);
});

describe("GET /r/[code] (US-D3)", () => {
  it("302 to the stored target with no-store headers and records the click (AC-D3.1)", async () => {
    const res = await GET(req(`/r/${CODE}`), params());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://delovoy-park.ru/admin/gazebos");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mockRecord).toHaveBeenCalledWith("l1", "root");
  });

  it("query parameters never influence the destination (AC-D3.3)", async () => {
    const res = await GET(req(`/r/${CODE}?url=https://evil.example&to=//evil.example`), params());
    expect(res.headers.get("location")).toBe("https://delovoy-park.ru/admin/gazebos");
    expect(mockResolve).toHaveBeenCalledWith(CODE);
  });

  it("unknown, broken or expired code → home, indistinguishable (AC-D3.4)", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await GET(req("/r/whatever"), params("whatever"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(HOME);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("lookup error → home, never 5xx", async () => {
    mockResolve.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req(`/r/${CODE}`), params());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(HOME);
  });

  it("failed click write still redirects to the target (AC-D3.2)", async () => {
    mockRecord.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req(`/r/${CODE}`), params());
    expect(res.headers.get("location")).toBe("https://delovoy-park.ru/admin/gazebos");
  });

  it("previews, bots, empty UA and prefetch redirect without counting (AC-D3.6)", async () => {
    await GET(req(`/r/${CODE}`, { ua: "TelegramBot (like TwitterBot)" }), params());
    await GET(req(`/r/${CODE}`, { ua: "" }), params());
    await GET(req(`/r/${CODE}`, { headers: { purpose: "prefetch" } }), params());
    const head = await HEAD(req(`/r/${CODE}`, { method: "HEAD" }), params());
    expect(head.status).toBe(302);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("over the rate limit → still the target, never a JSON 429; only the click record is lost (AC-D3.11)", async () => {
    mockRateLimit.mockResolvedValue(new Response("{}", { status: 429 }));
    const res = await GET(req(`/r/${CODE}`), params());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://delovoy-park.ru/admin/gazebos");
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a limiter failure doesn't block the redirect or the click record", async () => {
    mockRateLimit.mockRejectedValue(new Error("redis down"));
    const res = await GET(req(`/r/${CODE}`), params());
    expect(res.headers.get("location")).toBe("https://delovoy-park.ru/admin/gazebos");
    expect(mockRecord).toHaveBeenCalledWith("l1", "root");
  });
});
