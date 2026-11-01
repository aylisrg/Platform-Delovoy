import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    adminPermission: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
import { prisma } from "@/lib/db";
import { requireAdminSection } from "../api-response";
import { ADMIN_SECTION_SLUGS, getUserAdminSections, hasAdminSectionAccess } from "../permissions";
import { authConfig } from "../auth.config";

const roles: Role[] = ["USER", "MANAGER", "ADMIN", "SUPERADMIN"];
const userId = "test-staff";

function storedAccess(role: Role | null, sections: string[]) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(role ? { role } as never : null);
  vi.mocked(prisma.adminPermission.findMany).mockResolvedValue(sections.map((section) => ({ section })) as never);
  vi.mocked(prisma.adminPermission.findUnique).mockImplementation((args) =>
    Promise.resolve(sections.includes(args.where.userId_section?.section ?? "") ? { id: "test-grant" } : null) as never,
  );
}

beforeEach(() => vi.resetAllMocks());

describe("section policy parity: pages and API (#1156)", () => {
  for (const role of roles) {
    for (const section of ADMIN_SECTION_SLUGS) {
      it.each([false, true])(`${role} / ${section} / explicit grant=%s`, async (granted) => {
        storedAccess(role, granted ? [section] : []);
        const session = { user: { id: userId, role, adminSections: await getUserAdminSections(userId) }, expires: "2099-01-01" };
        // Expected product policy, independent of computeAdminSections.
        const expected = role === "SUPERADMIN"
          ? section !== "nedelovoy" || granted
          : role !== "USER" && section !== "telephony" &&
            (granted || (role === "ADMIN" && ["gazebos", "ps-park", "inventory"].includes(section)));
        const denied = await requireAdminSection(session, section);
        expect(denied === null).toBe(expected);
        if (denied) expect(denied.status).toBe(403);

        const pageGate = await authConfig.callbacks!.authorized!({
          auth: session,
          request: new NextRequest(`http://localhost/admin/${section}`),
        });
        // SUPERADMIN bypasses the proxy; the strict park page additionally
        // calls hasAdminSectionAccess before querying any business data.
        const pageAllowed = pageGate === true &&
          (section !== "nedelovoy" || await hasAdminSectionAccess(userId, section));
        expect(pageAllowed).toBe(expected);
        expect(session.user.adminSections.includes(section)).toBe(expected);
      });
    }
  }
});

describe("fresh access at the API boundary", () => {
  it("returns 401 before querying grants for an absent session", async () => {
    expect((await requireAdminSection(null, "cafe"))?.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("observes revocation and regrant without refreshing the token", async () => {
    const staleSession = { user: { id: userId, role: "ADMIN", adminSections: ["cafe"] } };
    storedAccess("ADMIN", ["cafe"]);
    expect(await requireAdminSection(staleSession, "cafe")).toBeNull();
    storedAccess("ADMIN", []);
    expect((await requireAdminSection(staleSession, "cafe"))?.status).toBe(403);
    storedAccess("ADMIN", ["cafe"]);
    expect(await requireAdminSection(staleSession, "cafe")).toBeNull();
    expect(prisma.adminPermission.findMany).toHaveBeenCalledTimes(3);
  });

  it.each(["USER", "MANAGER", null] as const)("denies stale ADMIN role after demotion/removal to %s", async (role) => {
    storedAccess(role, []);
    expect((await requireAdminSection({ user: { id: userId, role: "ADMIN" } }, "inventory"))?.status).toBe(403);
  });

  it("does not preserve a stale SUPERADMIN bypass after demotion", async () => {
    storedAccess("ADMIN", []);
    expect((await requireAdminSection({ user: { id: userId, role: "SUPERADMIN" } }, "cafe"))?.status).toBe(403);
  });

  it("does not grant access when the permission store fails", async () => {
    storedAccess("ADMIN", []);
    vi.mocked(prisma.adminPermission.findMany).mockRejectedValue(new Error("DB unavailable"));
    await expect(requireAdminSection({ user: { id: userId, role: "ADMIN" } }, "cafe")).rejects.toThrow("DB unavailable");
  });
});
