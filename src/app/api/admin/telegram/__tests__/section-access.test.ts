import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: vi.fn() },
  adminPermission: { findMany: vi.fn() },
  module: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
} }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn(), log: { error: vi.fn() } }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { GET, PUT } from "../route";
import { GET as routingGET, PUT as routingPUT } from "../../notifications/routing/route";

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ["TELEGRAM_ADMIN_CHAT_ID", "TELEGRAM_OWNER_CHAT_ID", "TELEGRAM_BOT_TOKEN", "NEXT_PUBLIC_TELEGRAM_BOT_NAME"]) vi.stubEnv(key, "");
  vi.mocked(prisma.module.findUnique).mockResolvedValue({ id: "test-system", config: {} } as never);
  vi.mocked(prisma.module.findMany).mockResolvedValue([]);
  vi.mocked(prisma.module.update).mockResolvedValue({ id: "test-system", config: {} } as never);
});
afterEach(() => vi.unstubAllEnvs());

const cases: { sessionRole: Role; storedRole: Role | null; grants: string[]; allowed: boolean }[] = [
  { sessionRole: "SUPERADMIN", storedRole: "SUPERADMIN", grants: [], allowed: true },
  { sessionRole: "ADMIN", storedRole: "SUPERADMIN", grants: [], allowed: true },
  { sessionRole: "SUPERADMIN", storedRole: "ADMIN", grants: [], allowed: false },
  { sessionRole: "SUPERADMIN", storedRole: "MANAGER", grants: [], allowed: false },
  { sessionRole: "SUPERADMIN", storedRole: "USER", grants: ["telegram"], allowed: false },
  { sessionRole: "SUPERADMIN", storedRole: null, grants: [], allowed: false },
  { sessionRole: "ADMIN", storedRole: "ADMIN", grants: ["notifications"], allowed: false },
  // Existing explicit legacy grants still follow the shared page policy.
  { sessionRole: "ADMIN", storedRole: "ADMIN", grants: ["telegram"], allowed: true },
  { sessionRole: "MANAGER", storedRole: "MANAGER", grants: ["telegram"], allowed: true },
];

describe("legacy telegram section in real settings and notification routing handlers", () => {
  it.each(cases)("session=$sessionRole, stored=$storedRole, grants=$grants", async ({ sessionRole, storedRole, grants, allowed }) => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "staff", role: sessionRole } } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(storedRole ? { role: storedRole } as never : null);
    vi.mocked(prisma.adminPermission.findMany).mockResolvedValue(grants.map((section) => ({ section })) as never);
    const put = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
      method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    });
    for (const response of [
      await GET(),
      await PUT(put("/api/admin/telegram", { adminChatTitle: "Test" })),
      await routingGET(),
      await routingPUT(put("/api/admin/notifications/routing", { key: "system", enabled: false })),
    ]) expect(response.status).toBe(allowed ? 200 : 403);

    expect(prisma.module.update).toHaveBeenCalledTimes(allowed ? 2 : 0);
    expect(logAudit).toHaveBeenCalledTimes(allowed ? 2 : 0);
    if (!allowed) {
      expect(prisma.module.findUnique).not.toHaveBeenCalled();
      expect(prisma.module.findMany).not.toHaveBeenCalled();
      expect(prisma.module.create).not.toHaveBeenCalled();
    }
  });
});
