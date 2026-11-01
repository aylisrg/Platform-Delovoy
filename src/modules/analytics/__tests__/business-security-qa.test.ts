import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), user: vi.fn(), report: vi.fn(), pref: vi.fn(), save: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: mock.token }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: mock.user } } }));
vi.mock("../business-service", () => ({ getBusinessReport: mock.report, businessCsv: () => "private report" }));
vi.mock("../business-reports", () => ({ getBusinessPreference: mock.pref, setBusinessPreference: mock.save, sendBusinessTest: mock.send, BusinessReportError: class extends Error {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => null }));
import { GET as webReport } from "@/app/api/analytics/business/route";
import { GET as webExport } from "@/app/api/analytics/business/export/route";
import { GET as webPreference, PUT as webSave } from "@/app/api/analytics/business/subscription/route";
import { POST as webTest } from "@/app/api/analytics/business/test/route";
import { GET as miniReport } from "@/app/api/webapp/business-analytics/route";
import { GET as miniPreference, PUT as miniSave } from "@/app/api/webapp/business-analytics/subscription/route";
import { POST as miniTest } from "@/app/api/webapp/business-analytics/test/route";

const routes = [
  ["web report", "GET", webReport], ["web export", "GET", webExport],
  ["web preference", "GET", webPreference], ["web preference write", "PUT", webSave], ["web test", "POST", webTest],
  ["mini report", "GET", miniReport], ["mini preference", "GET", miniPreference], ["mini preference write", "PUT", miniSave], ["mini test", "POST", miniTest],
] as const;
const request = (method: string) => new NextRequest("https://example.com/api", { method, ...(method === "GET" ? {} : { body: JSON.stringify(method === "PUT" ? { enabled: true } : { requestId: "87d359fa-ef28-45cf-9c94-a84e908e1909" }) }) });

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ user: { id: "actor", role: "SUPERADMIN" } });
  mock.token.mockResolvedValue({ id: "actor", role: "SUPERADMIN", telegramId: "1234" });
  mock.user.mockResolvedValue({ id: "actor", role: "SUPERADMIN", mergedIntoUserId: null, adminPermissions: [] });
  mock.report.mockResolvedValue({ totals: { net: 731.23 } });
  mock.pref.mockResolvedValue({ enabled: false }); mock.save.mockResolvedValue({ enabled: true }); mock.send.mockResolvedValue({ sent: true });
});

// AC: ordinary users cannot access any business number or initiate a report;
// use the real DB role gate and the exported route handlers together.
describe.each(routes)("AC-security route %s", (_name, method, handler) => {
  it.each([
    { role: "USER", adminPermissions: [] },
    { role: "USER", adminPermissions: [{ section: "analytics" }] },
    { role: "MANAGER", adminPermissions: [{ section: "analytics" }] },
    { role: "ADMIN", adminPermissions: [] },
    { role: "SUPERADMIN", adminPermissions: [], mergedIntoUserId: "primary" },
  ])("rejects current DB state $role despite stale owner claims", async state => {
    mock.user.mockResolvedValue({ id: "actor", mergedIntoUserId: null, ...state });
    const response = await handler(request(method));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    expect(body).not.toContain("731.23"); expect(body).not.toContain("totals");
    for (const call of [mock.report, mock.pref, mock.save, mock.send]) expect(call).not.toHaveBeenCalled();
  });
  it("rejects anonymous without reading role or financial data", async () => {
    mock.auth.mockResolvedValue(null); mock.token.mockResolvedValue(null);
    expect((await handler(request(method))).status).toBe(401);
    expect(mock.user).not.toHaveBeenCalled(); expect(mock.report).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "SUPERADMIN"])("permits current %s with valid scope", async role => {
    mock.user.mockResolvedValue({ id: "actor", role, mergedIntoUserId: null, adminPermissions: role === "ADMIN" ? [{ section: "analytics" }] : [] });
    const response = await handler(request(method));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
});

it("AC-security rechecks revocation between direct report requests", async () => {
  expect((await webReport(request("GET"))).status).toBe(200);
  mock.user.mockResolvedValue({ id: "actor", role: "USER", mergedIntoUserId: null, adminPermissions: [] });
  expect((await webReport(request("GET"))).status).toBe(403);
  expect(mock.report).toHaveBeenCalledTimes(1);
});
it("AC-security error payload hides database details", async () => {
  mock.user.mockRejectedValue(new Error("postgres://sensitive-secret@private-host/database"));
  const response = await miniReport(request("GET"));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("sensitive");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
