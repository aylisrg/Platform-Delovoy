import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/telephony/service", () => ({ listCalls: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  hasRole: (user: { role: string }, required: string) => {
    const roles = ["USER", "MANAGER", "ADMIN", "SUPERADMIN"];
    return roles.indexOf(user.role) >= roles.indexOf(required);
  },
  hasAdminSectionAccess: vi.fn(),
  STRICT_ACCESS_MODULES: new Set<string>(),
}));
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { listCalls } from "@/modules/telephony/service";
import { GET } from "../route";

const request = (query = "") => new NextRequest(`https://example.test/api/telephony/calls${query}`);
const setRole = (role: string) => vi.mocked(auth).mockResolvedValue({ user: { id: "user", role } } as never);

beforeEach(() => vi.resetAllMocks());

describe("GET /api/telephony/calls access regression", () => {
  it("never falls back to an unscoped journal on malformed query parameters", async () => {
    setRole("USER");
    expect((await GET(request("?page=bad"))).status).toBe(403);
    setRole("MANAGER");
    expect((await GET(request("?page=bad"))).status).toBe(422);
    expect((await GET(request())).status).toBe(403);
    expect(listCalls).not.toHaveBeenCalled();
  });

  it("requires section access for a manager before reading their module", async () => {
    setRole("MANAGER");
    vi.mocked(hasAdminSectionAccess).mockResolvedValue(false);
    expect((await GET(request("?moduleSlug=gazebos"))).status).toBe(403);
    expect(listCalls).not.toHaveBeenCalled();
    vi.mocked(hasAdminSectionAccess).mockResolvedValue(true);
    vi.mocked(listCalls).mockResolvedValue({ calls: [], total: 0, page: 1, perPage: 20 });
    const response = await GET(request("?moduleSlug=gazebos"));
    expect(response.status).toBe(200);
    expect(listCalls).toHaveBeenCalledWith(expect.objectContaining({ moduleSlug: "gazebos" }));
  });

  it("allows the owner's valid unscoped request and denies guests", async () => {
    expect((await GET(request())).status).toBe(401);
    setRole("SUPERADMIN");
    vi.mocked(listCalls).mockResolvedValue({ calls: [], total: 0, page: 1, perPage: 20 });
    expect((await GET(request())).status).toBe(200);
  });
});
