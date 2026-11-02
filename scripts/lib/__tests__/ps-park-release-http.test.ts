import { describe, expect, it, vi } from "vitest";
import { verifyPSParkReleaseLive } from "../ps-park-release-http";

function responses(overrides: Record<string, Response> = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (overrides[path]) return overrides[path];
    if (path === "/api/health") return Response.json({ status: "healthy", checks: { database: { status: "healthy" }, redis: { status: "healthy" } } });
    if (path === "/ps-park") return new Response('<section data-online-booking="enabled" data-online-offer="v2"></section>');
    if (path === "/ps-park/oferta/v2") return new Response("Published approved offer");
    throw new Error("UNEXPECTED_URL");
  });
}

describe("Play Park release live verification", () => {
  it("checks public health, rendered checkout and offer without authenticated API access", async () => {
    const fetcher = responses();
    await verifyPSParkReleaseLive(true, true, fetcher);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/health", "/ps-park", "/ps-park/oferta/v2",
    ]);
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://delovoy-park.ru");
      expect(options).toMatchObject({ method: "GET", redirect: "error", headers: { "User-Agent": "delovoy-release-check-bot" } });
      expect(options?.body).toBeUndefined();
    }
  });
  it("rejects unhealthy status and unavailable legal page", async () => {
    await expect(verifyPSParkReleaseLive(true, true, responses({ "/api/health": new Response("", { status: 503 }) }))).rejects.toThrow("RELEASE_HTTP_CHECK_FAILED");
    await expect(verifyPSParkReleaseLive(true, true, responses({ "/ps-park/oferta/v2": new Response("", { status: 404 }) }))).rejects.toThrow("RELEASE_HTTP_CHECK_FAILED");
  });
  it("rejects a degraded database or Redis even if health returns HTTP 200", async () => {
    for (const component of ["database", "redis"] as const) {
      const checks = { database: { status: "healthy" }, redis: { status: "healthy" } };
      checks[component].status = "unhealthy";
      await expect(verifyPSParkReleaseLive(true, true, responses({ "/api/health": Response.json({ status: "degraded", checks }) }))).rejects.toThrow("LIVE_DEPENDENCIES_UNHEALTHY");
    }
  });
  it("rejects a disabled form or wrong offer on first activation", async () => {
    await expect(verifyPSParkReleaseLive(true, true, responses({ "/ps-park": new Response('data-online-booking="disabled"') }))).rejects.toThrow("LIVE_CHECKOUT_STATE_MISMATCH");
    await expect(verifyPSParkReleaseLive(true, true, responses({ "/ps-park": new Response('data-online-booking="enabled" data-online-offer="v1"') }))).rejects.toThrow("LIVE_OFFER_MISMATCH");
  });
  it("accepts a later manual OFF without demanding the old offer", async () => {
    const fetcher = responses({ "/ps-park": new Response('data-online-booking="disabled"') });
    await verifyPSParkReleaseLive(false, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("preflight only reads public health before any mutation", async () => {
    const fetcher = responses();
    await verifyPSParkReleaseLive(undefined, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://delovoy-park.ru/api/health");
  });
});
