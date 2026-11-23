import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { prisma } from "./helpers/db";

test("ADMIN section grants gate page, API reads and writes; revocation takes effect", async ({ page, baseURL }) => {
  // Use the existing dev-overlay account only in a disposable local E2E DB.
  // Never edit grants or roles against a remote app/database.
  const local = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  expect(process.env.DEV_OVERLAY).toBe("1");
  expect(local(baseURL!)).toBe(true);
  expect(local(process.env.DATABASE_URL!)).toBe(true);
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@local" } });
  const key = { userId_section: { userId: manager.id, section: "cafe" } };
  expect(manager.role).toBe("MANAGER");
  expect(await prisma.adminPermission.findUnique({ where: key })).toBeNull();

  try {
    await prisma.user.update({ where: { id: manager.id }, data: { role: "ADMIN" } });
    await loginAs(page, "manager@local", "manager");
    await page.goto("/admin/cafe");
    await expect(page).toHaveURL(/\/admin\/forbidden/);

    expect((await page.request.get("/api/cafe/menu")).status()).toBe(403);
    // Deliberately invalid input: tests never create a menu item, even if
    // authorization regresses. 422 would demonstrate the old bypass.
    expect((await page.request.post("/api/cafe/menu", { data: {} })).status()).toBe(403);

    await prisma.adminPermission.create({ data: { userId: manager.id, section: "cafe" } });
    // Same session, no token refresh: API reads the current stored grants.
    expect((await page.request.get("/api/cafe/menu")).status()).toBe(200);
    expect((await page.request.post("/api/cafe/menu", { data: {} })).status()).toBe(422);

    await prisma.adminPermission.delete({ where: key });
    expect((await page.request.get("/api/cafe/menu")).status()).toBe(403);
    expect((await page.request.post("/api/cafe/menu", { data: {} })).status()).toBe(403);
  } finally {
    await prisma.adminPermission.deleteMany({ where: { userId: manager.id, section: "cafe" } });
    await prisma.user.update({ where: { id: manager.id }, data: { role: manager.role } });
  }
});
