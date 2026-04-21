import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/modules/backups/service", () => ({
  listBackups: vi.fn(),
}));

import { GET } from "../route";
import { auth } from "@/lib/auth";
import { listBackups } from "@/modules/backups/service";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockList = listBackups as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

function req(qs: string = "") {
  return new Request(`http://localhost/api/admin/backups${qs}`);
}

describe("GET /api/admin/backups", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-SUPERADMIN", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "ADMIN", name: "Admin" },
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("returns 422 on invalid query", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    const res = await GET(req("?type=HOURLY"));
    expect(res.status).toBe(422);
  });

  it("returns paginated list for SUPERADMIN", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockList.mockResolvedValue({
      items: [{ id: "bk_1" }],
      total: 1,
    });

    const res = await GET(req("?type=DAILY&limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: "bk_1" }]);
    expect(body.meta.total).toBe(1);

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DAILY", limit: 10, offset: 0 })
    );
  });
});
