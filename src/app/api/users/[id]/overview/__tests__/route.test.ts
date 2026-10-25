import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mockOverview = vi.fn();
vi.mock("@/modules/users/team", () => ({ getUserOverview: (...a: unknown[]) => mockOverview(...a) }));

import { auth } from "@/lib/auth";
import { DomainError } from "@/modules/users/errors";
import { GET } from "../route";

const params = (id = "u1") => ({ params: Promise.resolve({ id }) });
const as = (role: string | null) =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "me", role, adminSections: ["users"] } } : null) as never);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/users/[id]/overview (US-B1)", () => {
  it("401 / 403", async () => {
    as(null);
    expect((await GET(new Request("http://x"), params())).status).toBe(401);
    as("ADMIN");
    expect((await GET(new Request("http://x"), params())).status).toBe(403);
  });

  it("200 with the actor id passed for self-guards", async () => {
    as("SUPERADMIN");
    mockOverview.mockResolvedValue({ kind: "merged", primaryUserId: "p1" });
    const res = await GET(new Request("http://x"), params("u1"));
    expect(res.status).toBe(200);
    expect(mockOverview).toHaveBeenCalledWith("u1", "me");
    expect((await res.json()).data).toEqual({ kind: "merged", primaryUserId: "p1" });
  });

  it("404 for a missing user", async () => {
    as("SUPERADMIN");
    mockOverview.mockRejectedValue(new DomainError("USER_NOT_FOUND", "Пользователь не найден", 404));
    const res = await GET(new Request("http://x"), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
  });
});
