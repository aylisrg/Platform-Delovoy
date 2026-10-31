import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), viewer: vi.fn(), report: vi.fn(), csv: vi.fn(), pref: vi.fn(), set: vi.fn(), test: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: mocks.token }));
vi.mock("../business-access", () => ({ getBusinessViewer: mocks.viewer }));
vi.mock("../business-service", () => ({ getBusinessReport: mocks.report, businessCsv: mocks.csv }));
vi.mock("../business-reports", () => ({ getBusinessPreference: mocks.pref, setBusinessPreference: mocks.set, sendBusinessTest: mocks.test, BusinessReportError: class extends Error {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
import { businessHttp, type BusinessAction } from "../business-http";
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "actor", role: "SUPERADMIN" } }); mocks.token.mockResolvedValue({ id: "actor", role: "SUPERADMIN" }); mocks.viewer.mockResolvedValue({ id: "actor", role: "SUPERADMIN" }); mocks.limit.mockResolvedValue(null); mocks.report.mockResolvedValue({ totals: { net: 10 } }); mocks.csv.mockReturnValue("private,csv"); mocks.pref.mockResolvedValue({ enabled: false }); mocks.test.mockResolvedValue({ sent: true });
});
const actions: BusinessAction[] = ["report", "export", "preference", "test"];
describe.each([false, true])("financial routes miniapp=%s", mini => {
  it.each(actions)("denies anonymous on %s", async action => {
    mocks.auth.mockResolvedValue(null); mocks.token.mockResolvedValue(null);
    const res = await businessHttp(new NextRequest("https://example.com/api?period=7d"), action, mini);
    expect(res.status).toBe(401); expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.test).not.toHaveBeenCalled(); expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
  it.each(actions)("denies revoked role before %s and data query", async action => {
    mocks.viewer.mockResolvedValue(null);
    const res = await businessHttp(new NextRequest("https://example.com/api"), action, mini);
    expect(res.status).toBe(403); expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.test).not.toHaveBeenCalled(); expect(mocks.pref).not.toHaveBeenCalled();
  });
  it("returns private aggregate only after guard", async () => {
    const res = await businessHttp(new NextRequest("https://example.com/api?period=7d"), "report", mini);
    expect(res.status).toBe(200); expect((await res.json()).data.totals.net).toBe(10); expect(res.headers.get("Vary")).toBe("Cookie, Authorization");
  });
  it("rejects recipient injection and uses actor from verified identity", async () => {
    const requestId = "87d359fa-ef28-45cf-9c94-a84e908e1909";
    let res = await businessHttp(new NextRequest("https://example.com/api", { method: "POST", body: JSON.stringify({ requestId, userId: "victim" }) }), "test", mini);
    expect(res.status).toBe(422); expect(mocks.test).not.toHaveBeenCalled();
    res = await businessHttp(new NextRequest("https://example.com/api", { method: "POST", body: JSON.stringify({ requestId }) }), "test", mini);
    expect(res.status).toBe(200); expect(mocks.test).toHaveBeenCalledWith("actor", requestId);
  });
  it("rejects invalid filters and keeps export private", async () => {
    let res = await businessHttp(new NextRequest("https://example.com/api?module=rental"), "export", mini);
    expect(res.status).toBe(422);
    res = await businessHttp(new NextRequest("https://example.com/api?period=7d"), "export", mini);
    expect(res.status).toBe(200); expect(res.headers.get("Content-Disposition")).toContain("attachment"); expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
