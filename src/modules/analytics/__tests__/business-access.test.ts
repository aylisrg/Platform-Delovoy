import { beforeEach, describe, expect, it, vi } from "vitest";
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
import { getBusinessViewer } from "../business-access";
beforeEach(() => vi.clearAllMocks());
describe("live business RBAC", () => {
  it.each(["USER", "MANAGER", "ADMIN"])("rejects %s without grants", async role => {
    findUnique.mockResolvedValue({ id: "u", role, mergedIntoUserId: null, adminPermissions: [] });
    expect(await getBusinessViewer("u")).toBeNull();
  });
  it.each(["USER", "MANAGER"])("rejects %s even with stale analytics grants", async role => {
    findUnique.mockResolvedValue({ id: "u", role, mergedIntoUserId: null, adminPermissions: [{ section: "analytics" }] });
    expect(await getBusinessViewer("u")).toBeNull();
  });
  it.each(["ADMIN", "SUPERADMIN"])("permits %s with current permission", async role => {
    findUnique.mockResolvedValue({ id: "u", role, mergedIntoUserId: null, adminPermissions: role === "ADMIN" ? [{ section: "analytics" }] : [] });
    expect(await getBusinessViewer("u")).toMatchObject({ id: "u" });
  });
  it("rejects removed/merged owner and rechecks every time", async () => {
    findUnique.mockResolvedValueOnce({ id: "u", role: "SUPERADMIN", mergedIntoUserId: "primary", adminPermissions: [] }).mockResolvedValueOnce(null);
    expect(await getBusinessViewer("u")).toBeNull(); expect(await getBusinessViewer("u")).toBeNull(); expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
