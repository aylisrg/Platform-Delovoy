import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), viewer: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/modules/analytics/business-access", () => ({ getBusinessViewer: mocks.viewer }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/admin/business-analytics", () => ({ BusinessAnalytics: () => null }));
import Page from "../page";
beforeEach(() => vi.clearAllMocks());
describe("Business analytics server page", () => {
  it("sends anonymous visitors to login before consulting business access", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("redirect:/auth/signin?callbackUrl=");
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it("preserves the validated exact week through login", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({ period: "7d", weekEnding: "2020-11-01" }) })).rejects.toThrow("redirect:");
    const location = new URL(mocks.redirect.mock.calls[0][0], "https://delovoy-park.ru");
    expect(location.searchParams.get("callbackUrl")).toBe("/admin/analytics/business?period=7d&weekEnding=2020-11-01");
  });
  it.each([{ weekEnding: "//evil.example" }, { period: "90d", weekEnding: "2020-11-01" }, { period: ["7d", "30d"] }])("does not reflect invalid report query values into login", async (query) => {
    mocks.auth.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve(query) })).rejects.toThrow("redirect:");
    const location = new URL(mocks.redirect.mock.calls[0][0], "https://delovoy-park.ru");
    expect(location.searchParams.get("callbackUrl")).toBe("/admin/analytics/business");
  });
  it("denies a stale privileged session when the current DB gate rejects access", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "staff", role: "SUPERADMIN" } });
    mocks.viewer.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("redirect:/admin/forbidden");
    expect(mocks.viewer).toHaveBeenCalledWith("staff");
  });
  it("renders the report shell only after a fresh access grant", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "staff", role: "ADMIN" } });
    mocks.viewer.mockResolvedValue({ id: "staff", role: "ADMIN" });
    expect(await Page()).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
