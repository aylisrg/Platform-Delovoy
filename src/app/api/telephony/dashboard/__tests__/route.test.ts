import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/telephony/dashboard-service", () => ({ getTelephonyDashboard: vi.fn() }));
import { auth } from "@/lib/auth";
import { getTelephonyDashboard } from "@/modules/telephony/dashboard-service";
import { GET } from "../route";

const request = (query = "") => new NextRequest(`https://example.test/api/telephony/dashboard${query}`);
const setRole = (role: string) => vi.mocked(auth).mockResolvedValue({ user: { id: "user", role } } as never);

beforeEach(() => vi.resetAllMocks());

describe("GET /api/telephony/dashboard", () => {
  it("requires authentication and denies all non-owner roles before validation or data reads", async () => {
    expect((await GET(request())).status).toBe(401);
    for (const role of ["USER", "MANAGER", "ADMIN"]) {
      setRole(role);
      expect((await GET(request("?period=bad"))).status).toBe(403);
    }
    expect(getTelephonyDashboard).not.toHaveBeenCalled();
  });

  it("rejects invalid query parameters without querying the journal", async () => {
    setRole("SUPERADMIN");
    expect((await GET(request("?page=-1"))).status).toBe(422);
    expect(getTelephonyDashboard).not.toHaveBeenCalled();
  });

  it("returns the owner dashboard without shared caching", async () => {
    setRole("SUPERADMIN");
    vi.mocked(getTelephonyDashboard).mockResolvedValue({ summary: { total: 8 } } as never);
    const response = await GET(request("?period=7d&filter=missed&page=2"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ success: true, data: { summary: { total: 8 } } });
    expect(getTelephonyDashboard).toHaveBeenCalledWith({ period: "7d", filter: "missed", page: 2 });
  });

  it("returns a safe error instead of provider or database details", async () => {
    setRole("SUPERADMIN");
    vi.mocked(getTelephonyDashboard).mockRejectedValue(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });
});
