/**
 * Dev overlay seed — creates guaranteed dev test accounts on top of any DB state.
 *
 * Run after db:pull-prod to get predictable login credentials in dev/staging.
 * Safe to run multiple times (idempotent via upsert by email).
 *
 * Accounts created:
 *   admin@local    / password: admin    — SUPERADMIN
 *   manager@local  / password: manager  — MANAGER (ModuleAssignment + AdminPermission
 *                                          on dashboard/gazebos/ps-park — issue #615)
 *   user@local     / password: user     — USER
 *
 * Only runs when DEV_OVERLAY=1 env var is set (protection against accidental prod run).
 * Called from scripts/seed.ts when DEV_OVERLAY=1.
 *
 * НЕ перезаписывает существующих пользователей с теми же email (upsert update minimal).
 */
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

const SALT_ROUNDS = 10;

export async function seedDevOverlay(prisma: PrismaClient): Promise<void> {
  if (process.env.DEV_OVERLAY !== "1") {
    console.log("[dev-overlay] Skipped — DEV_OVERLAY is not set to '1'");
    return;
  }

  const env = process.env.NODE_ENV ?? "development";
  if (env === "production") {
    console.warn("[dev-overlay] Refusing to run in NODE_ENV=production");
    return;
  }

  console.log("[dev-overlay] Creating dev test accounts...");

  const adminHash = await bcrypt.hash("admin", SALT_ROUNDS);
  const managerHash = await bcrypt.hash("manager", SALT_ROUNDS);
  const userHash = await bcrypt.hash("user", SALT_ROUNDS);

  // SUPERADMIN
  const admin = await prisma.user.upsert({
    where: { email: "admin@local" },
    create: {
      email: "admin@local",
      name: "Dev Admin",
      role: "SUPERADMIN",
      passwordHash: adminHash,
    },
    update: {
      name: "Dev Admin",
      passwordHash: adminHash,
    },
  });
  console.log(`[dev-overlay]   admin@local (SUPERADMIN) id=${admin.id}`);

  // MANAGER — find or create, then assign to gazebos + ps-park modules
  const manager = await prisma.user.upsert({
    where: { email: "manager@local" },
    create: {
      email: "manager@local",
      name: "Dev Manager",
      role: "MANAGER",
      passwordHash: managerHash,
    },
    update: {
      name: "Dev Manager",
      passwordHash: managerHash,
    },
  });
  console.log(`[dev-overlay]   manager@local (MANAGER) id=${manager.id}`);

  // Assign manager to gazebos + ps-park if those modules exist
  const targetModuleSlugs = ["gazebos", "ps-park"];
  const modules = await prisma.module.findMany({
    where: { slug: { in: targetModuleSlugs } },
    select: { id: true, slug: true },
  });

  for (const mod of modules) {
    const existing = await prisma.moduleAssignment.findFirst({
      where: { userId: manager.id, moduleId: mod.id },
    });
    if (!existing) {
      await prisma.moduleAssignment.create({
        data: { userId: manager.id, moduleId: mod.id },
      });
      console.log(`[dev-overlay]     → assigned to module: ${mod.slug}`);
    }
  }

  // ModuleAssignment alone isn't enough to reach the admin UI — hasAdminSectionAccess()
  // (src/lib/permissions.ts) requires an explicit AdminPermission per section, and the
  // auth.config.ts authorized() callback redirects to /admin/forbidden without one.
  // "dashboard" is included because /admin (the post-login landing page) redirects to
  // /admin/dashboard for every role (issue #615).
  const targetAdminSections = ["dashboard", ...targetModuleSlugs];
  for (const section of targetAdminSections) {
    await prisma.adminPermission.upsert({
      where: { userId_section: { userId: manager.id, section } },
      create: { userId: manager.id, section },
      update: {},
    });
  }
  console.log(`[dev-overlay]     → admin sections: ${targetAdminSections.join(", ")}`);

  // USER
  const user = await prisma.user.upsert({
    where: { email: "user@local" },
    create: {
      email: "user@local",
      name: "Dev User",
      role: "USER",
      passwordHash: userHash,
    },
    update: {
      name: "Dev User",
      passwordHash: userHash,
    },
  });
  console.log(`[dev-overlay]   user@local (USER) id=${user.id}`);

  console.log("[dev-overlay] Done.");
  console.log("");
  console.log("  Credentials:");
  console.log("    admin@local    / admin    (SUPERADMIN)");
  console.log("    manager@local  / manager  (MANAGER → gazebos, ps-park)");
  console.log("    user@local     / user     (USER)");
}
