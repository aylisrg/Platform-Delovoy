import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: vi.fn() }, adminPermission: { findMany: vi.fn() },
} }));
vi.mock("@/modules/cafe/service", () => ({ getMenuAdmin: vi.fn(), createMenuItem: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMenuAdmin, createMenuItem } from "@/modules/cafe/service";
import { logAudit } from "@/lib/logger";
import { GET, POST } from "../route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMenuAdmin).mockResolvedValue([]);
  vi.mocked(createMenuItem).mockResolvedValue({ id: "test-item", name: "Test", category: "DRINKS", price: 100 } as never);
});

describe("real cafe handlers enforce fresh section access before reads/writes", () => {
  for (const role of ["USER", "MANAGER", "ADMIN", "SUPERADMIN", null] as const) {
    it.each([false, true])(`${role ?? "anonymous"}, cafe grant=%s`, async (granted) => {
      vi.mocked(auth).mockResolvedValue(role ? { user: { id: "staff", role, adminSections: ["cafe"] } } as never : null as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(role ? { role: role as Role } as never : null);
      vi.mocked(prisma.adminPermission.findMany).mockResolvedValue(granted ? [{ section: "cafe" }] as never : []);
      const allowed = role === "SUPERADMIN" || (role !== null && role !== "USER" && granted);
      const read = await GET();
      const write = await POST(new NextRequest("http://localhost/api/cafe/menu", {
        method: "POST", body: JSON.stringify({ name: "Test", category: "DRINKS", price: 100 }),
        headers: { "Content-Type": "application/json" },
      }));
      expect(read.status).toBe(allowed ? 200 : role ? 403 : 401);
      expect(write.status).toBe(allowed ? 201 : role ? 403 : 401);
      expect(getMenuAdmin).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(createMenuItem).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(logAudit).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });
  }

  it("permission lookup failure returns 500 without business work", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "staff", role: "ADMIN" } } as never);
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("DB unavailable"));
    expect((await GET()).status).toBe(500);
    expect((await POST(new NextRequest("http://localhost/api/cafe/menu", { method: "POST" }))).status).toBe(500);
    expect(getMenuAdmin).not.toHaveBeenCalled();
    expect(createMenuItem).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
