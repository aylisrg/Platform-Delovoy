import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

/**
 * Next.js applies every matching `headers()` rule; for the same key the later
 * rule wins. The tracking redirect `/r/<code>` must leave with `no-referrer`
 * (ADR 2026-10-25-team-access-notifications §Q4) — the route sets it, but the
 * global security headers used to override it (QA BUG-1).
 */
describe("next.config headers — /r tracking redirect", () => {
  it("a /r rule with Referrer-Policy: no-referrer comes after the global security headers", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const globalIdx = rules.findIndex((r) => r.source === "/:path*");
    const trackingIdx = rules.findIndex((r) => r.source === "/r/:code*");

    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(trackingIdx).toBeGreaterThan(globalIdx);
    expect(rules[globalIdx]?.headers).toContainEqual({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
    expect(rules[trackingIdx]?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});
