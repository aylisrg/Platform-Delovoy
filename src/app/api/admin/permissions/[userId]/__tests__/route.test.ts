import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET/PUT /api/admin/permissions/[userId] — ADR 2026-10-25-team-access-notifications
 * §6.2/§10, PRD US-A4. Route + real `section-grants` service over a mocked DB.
 */

const { tx, mockPrisma, mockBump, mockPublish, mockAuth } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    adminPermission: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    mockPrisma: {
      $transaction: vi.fn(),
      user: { findUnique: vi.fn() },
      adminPermission: { findMany: vi.fn() },
    },
    mockBump: vi.fn(),
    mockPublish: vi.fn(),
    mockAuth: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/session-revocation", () => ({
  bumpSessionVersion: (...args: unknown[]) => mockBump(...args),
  publishAuthState: (...args: unknown[]) => mockPublish(...args),
}));

import { GET, PUT } from "../route";

const params = (userId = "u-1") => ({ params: Promise.resolve({ userId }) });
const get = () => GET(new Request("http://localhost/api/admin/permissions/u-1"), params());
const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/admin/permissions/u-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params(),
  );

type Role = "SUPERADMIN" | "ADMIN" | "MANAGER" | "USER";

function target(role: Role, grants: string[], merged: string | null = null) {
  mockPrisma.user.findUnique.mockResolvedValue({ id: "u-1", name: "Иван", role, mergedIntoUserId: merged });
  mockPrisma.adminPermission.findMany.mockResolvedValue(grants.map((section) => ({ section })));
  tx.$queryRaw.mockResolvedValue([{ id: "u-1", role, mergedIntoUserId: merged }]);
  tx.adminPermission.findMany.mockResolvedValue(grants.map((section) => ({ section })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "sa-1", role: "SUPERADMIN" } });
  mockPrisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
  tx.adminPermission.deleteMany.mockResolvedValue({ count: 0 });
  tx.adminPermission.createMany.mockResolvedValue({ count: 0 });
  tx.auditLog.create.mockResolvedValue({});
  mockBump.mockResolvedValue(2);
  mockPublish.mockResolvedValue(undefined);
});

describe("RBAC", () => {
  it("401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await put({ sections: [] })).status).toBe(401);
  });

  it.each([
    ["ADMIN with «Пользователи»", { id: "a", role: "ADMIN", adminSections: ["users"] }],
    ["MANAGER", { id: "m", role: "MANAGER", adminSections: ["users"] }],
    ["USER", { id: "u", role: "USER", adminSections: [] }],
  ])("403 for %s", async (_label, user) => {
    mockAuth.mockResolvedValue({ user });
    expect((await get()).status).toBe(403);
    expect((await put({ sections: [] })).status).toBe(403);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("AC-A4.1: SUPERADMIN — role sections read-only, strict НеДеловой manageable, auto-grant note", async () => {
    target("SUPERADMIN", ["nedelovoy", "cafe"]);

    const res = await get();
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.userRole).toBe("SUPERADMIN");
    expect(data.roleSections.map((s: { slug: string }) => s.slug)).toContain("telephony");
    expect(data.grantableSections).toEqual([]);
    expect(data.strictSections).toEqual([{ slug: "nedelovoy", label: "НеДеловой", icon: "🏗" }]);
    // Only grants inside grantable ∪ strict are reported as managed.
    expect(data.granted).toEqual(["nedelovoy"]);
    expect(data.notes).toEqual({ superadminStrictAutoGrant: true });
  });

  it("AC-A4.5: ADMIN — gazebos/ps-park/inventory by role, the rest grantable except «Звонки»", async () => {
    target("ADMIN", ["cafe"]);
    const { data } = await (await get()).json();

    expect(data.roleSections.map((s: { slug: string }) => s.slug)).toEqual(["gazebos", "ps-park", "inventory"]);
    const grantable = data.grantableSections.map((s: { slug: string }) => s.slug);
    expect(grantable).toContain("cafe");
    expect(grantable).not.toContain("telephony");
    expect(grantable).not.toContain("gazebos");
    expect(data.granted).toEqual(["cafe"]);
    expect(data.notes.superadminStrictAutoGrant).toBe(false);
  });

  it("USER — all lists empty", async () => {
    target("USER", ["cafe"]);
    const { data } = await (await get()).json();
    expect(data.roleSections).toEqual([]);
    expect(data.grantableSections).toEqual([]);
    expect(data.strictSections).toEqual([]);
    expect(data.granted).toEqual([]);
  });

  it("404 for an unknown user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
  });
});

describe("PUT", () => {
  it("AC-A4.2: SUPERADMIN — strict grant saved without 400, role sections silently dropped", async () => {
    target("SUPERADMIN", []);

    const res = await put({ sections: ["dashboard", "cafe", "telephony", "nedelovoy"] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { userId: "u-1", granted: ["nedelovoy"] } });
    expect(tx.adminPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u-1", section: "nedelovoy" }],
      skipDuplicates: true,
    });
    expect(tx.adminPermission.deleteMany).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("AC-A4.1: revoking НеДеловой from a SUPERADMIN removes only that grant and bumps sessions", async () => {
    target("SUPERADMIN", ["nedelovoy", "cafe"]);

    await put({ sections: [] });

    // «cafe» (stale explicit row outside grantable ∪ strict) is left untouched.
    expect(tx.adminPermission.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-1", section: { in: ["nedelovoy"] } },
    });
    expect(mockBump).toHaveBeenCalledWith(tx, "u-1");
    expect(mockPublish).toHaveBeenCalledWith("u-1");
  });

  it("AC-A4.5/AC-A4.6: ADMIN — grant and revoke, audit with before/after/added/removed", async () => {
    target("ADMIN", ["cafe", "tasks"]);

    const res = await put({ sections: ["cafe", "analytics", "gazebos"] });

    expect(res.status).toBe(200);
    expect(tx.adminPermission.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-1", section: { in: ["tasks"] } },
    });
    expect(tx.adminPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u-1", section: "analytics" }],
      skipDuplicates: true,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "sa-1",
        action: "permissions.update",
        entity: "AdminPermission",
        entityId: "u-1",
        metadata: {
          targetRole: "ADMIN",
          before: ["cafe", "tasks"],
          after: ["cafe", "analytics"],
          added: ["analytics"],
          removed: ["tasks"],
        },
      },
    });
    expect(mockBump).toHaveBeenCalledWith(tx, "u-1");
    expect(mockPublish).toHaveBeenCalledWith("u-1");
  });

  it("MANAGER — adding only does not revoke sessions", async () => {
    target("MANAGER", ["dashboard"]);
    await put({ sections: ["dashboard", "cafe"] });
    expect(mockBump).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({ added: ["cafe"], removed: [] });
  });

  it("AC-A4.3: «Звонки» for a non-superadmin → 422 SECTION_NOT_GRANTABLE, nothing written", async () => {
    target("MANAGER", ["dashboard"]);

    const res = await put({ sections: ["dashboard", "telephony"] });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "SECTION_NOT_GRANTABLE", message: "Раздел «Звонки» доступен только суперадмину" },
    });
    expect(tx.adminPermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.adminPermission.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("unknown section → 422 SECTION_NOT_GRANTABLE «Неизвестный раздел»", async () => {
    target("MANAGER", []);
    const res = await put({ sections: ["root"] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Неизвестный раздел");
  });

  it("USER or merged account → 422 NOT_IN_TEAM", async () => {
    target("USER", []);
    const res = await put({ sections: ["cafe"] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("NOT_IN_TEAM");

    target("MANAGER", [], "u-2");
    expect((await put({ sections: ["cafe"] })).status).toBe(422);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("the target row is locked FOR UPDATE inside the transaction", async () => {
    target("MANAGER", []);
    await put({ sections: [] });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toEqual(["u-1"]);
  });

  it("422 on invalid body and malformed JSON; 404 for an unknown user", async () => {
    expect((await put({ sections: "cafe" })).status).toBe(422);
    expect((await put("{bad")).status).toBe(422);

    tx.$queryRaw.mockResolvedValue([]);
    expect((await put({ sections: [] })).status).toBe(404);
  });
});
