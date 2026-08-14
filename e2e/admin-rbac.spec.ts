import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

/**
 * Admin RBAC denial (issue #572 flow #5).
 *
 * NOTE: testing "USER hits /admin/dashboard → denied" directly is not
 * possible right now — that path is broken (see issue #591, filed while
 * building this suite: /admin/* page routes render fully for ANY caller,
 * including anonymous, because src/proxy.ts wraps auth() with a custom
 * middleware function and next-auth v5 silently discards a plain `false`
 * return from authorized() in that mode; only branches that return a real
 * Response still block). Encoding that broken behavior as "expected/green"
 * here would be actively wrong. These two flows below are the RBAC
 * boundaries that ARE currently enforced correctly (both go through a real
 * Response, verified empirically against a live build) — once #591 is
 * fixed, add a third case here for the plain USER-on-page-route path.
 */
test.describe("Admin RBAC", () => {
  test("MANAGER без доступа к разделу → редирект на /admin/forbidden", async ({ page }) => {
    await loginAs(page, "manager@local", "manager");

    // manager@local (scripts/seeds/dev-overlay.ts) is assigned to gazebos +
    // ps-park only — cafe is a section they have no ModuleAssignment for.
    await page.goto("/admin/cafe");

    await expect(page).toHaveURL(/\/admin\/forbidden/);
    await expect(page.getByText("Доступ запрещён")).toBeVisible();
  });

  test("USER без прав → /api/admin/* отвечает 403", async ({ page }) => {
    await loginAs(page, "user@local", "user");

    const response = await page.request.get("/api/admin/badge-counts");
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
