import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mockMatrix = vi.fn();
vi.mock("@/modules/notifications/matrix", () => ({ getNotificationMatrix: (...a: unknown[]) => mockMatrix(...a) }));

import { auth } from "@/lib/auth";
import { GET } from "../route";

const as = (role: string | null) =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "me", role, adminSections: ["notifications"] } } : null) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockMatrix.mockResolvedValue({ events: [], rows: [], totals: {} });
});

describe("GET /api/admin/notifications/matrix (US-C4, AC-C4.4)", () => {
  it("401 / 403 for non-superadmins (the proxy lets ADMIN/MANAGER into /api/admin)", async () => {
    as(null);
    expect((await GET(new Request("http://x/api/admin/notifications/matrix"))).status).toBe(401);
    for (const role of ["ADMIN", "MANAGER"]) {
      as(role);
      expect((await GET(new Request("http://x/api/admin/notifications/matrix"))).status).toBe(403);
    }
  });

  it("200 with parsed filters", async () => {
    as("SUPERADMIN");
    const res = await GET(new Request("http://x/api/admin/notifications/matrix?category=cafe&role=MANAGER&problems=1"));
    expect(res.status).toBe(200);
    expect(mockMatrix).toHaveBeenCalledWith({ category: "cafe", role: "MANAGER", problems: true });
  });

  it("422 on a bad role", async () => {
    as("SUPERADMIN");
    expect((await GET(new Request("http://x/api/admin/notifications/matrix?role=USER"))).status).toBe(422);
  });
});
