import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mockOverview = vi.fn();
vi.mock("@/modules/users/team", () => ({ getTeamOverview: (...a: unknown[]) => mockOverview(...a) }));

import { auth } from "@/lib/auth";
import { GET } from "../route";

const as = (role: string | null, sections: string[] = []) =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "me", role, adminSections: sections } } : null) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockOverview.mockResolvedValue({ rows: [{ id: "u1" }], pendingMergeRequests: 3 });
});

describe("GET /api/users/team (US-B2)", () => {
  it("401 without a session", async () => {
    as(null);
    expect((await GET(new Request("http://x/api/users/team"))).status).toBe(401);
  });

  it.each([["ADMIN", ["users"]], ["MANAGER", ["users"]], ["USER", []]])("403 for %s even with the «Пользователи» section", async (role, sections) => {
    as(role, sections);
    expect((await GET(new Request("http://x/api/users/team"))).status).toBe(403);
    expect(mockOverview).not.toHaveBeenCalled();
  });

  it("200 passes parsed filters and returns rows + pending merge requests", async () => {
    as("SUPERADMIN");
    const res = await GET(new Request("http://x/api/users/team?problems=true&bot=blocked&sort=lastLogin"));
    expect(res.status).toBe(200);
    expect(mockOverview).toHaveBeenCalledWith({ problems: true, bot: "blocked", sort: "lastLogin" });
    expect(await res.json()).toMatchObject({ data: { rows: [{ id: "u1" }], pendingMergeRequests: 3 }, meta: { total: 1 } });
  });

  it("422 on an unknown filter value", async () => {
    as("SUPERADMIN");
    expect((await GET(new Request("http://x/api/users/team?bot=sleeping"))).status).toBe(422);
  });
});
