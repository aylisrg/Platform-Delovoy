import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

const financialPaths = ["/api/analytics/business", "/api/analytics/business/export", "/api/analytics/business/subscription"];
test.describe("Business analytics access", () => {
  test("anonymous cannot read financial API or export", async ({ request }) => {
    for (const path of financialPaths) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([401, 403]).toContain(res.status());
      expect(await res.text()).not.toContain('"totals"');
    }
  });
  for (const role of ["user", "manager"] as const) {
    test(`${role} cannot open page, export, settings or test delivery`, async ({ page }) => {
      await loginAs(page, `${role}@local`, role);
      await page.goto("/admin/analytics/business");
      await expect(page).toHaveURL(/\/admin\/forbidden/);
      for (const path of financialPaths) {
        const res = await page.request.get(path);
        expect(res.status()).toBe(403);
        expect(await res.text()).not.toContain('"totals"');
      }
      const testMessage = await page.request.post("/api/analytics/business/test", { data: { requestId: "87d359fa-ef28-45cf-9c94-a84e908e1909" } });
      expect(testMessage.status()).toBe(403);
    });
  }
  test("superadmin sees real aggregate contract and private export without subscribing", async ({ page }) => {
    await loginAs(page, "admin@local", "admin");
    const report = await page.request.get("/api/analytics/business?period=7d");
    expect(report.status()).toBe(200);
    expect(report.headers()["cache-control"]).toContain("no-store");
    const body = await report.json();
    expect(body.data.lines.map((line: { slug: string }) => line.slug)).toEqual(["gazebos", "ps-park", "cafe"]);
    expect(body.data.period.timezone).toBe("Europe/Moscow");
    const csv = await page.request.get("/api/analytics/business/export?period=7d");
    expect(csv.status()).toBe(200); expect(await csv.text()).toContain("офисы исключены");
    await page.goto("/admin/analytics/business");
    await expect(page.getByRole("heading", { name: "Бизнес-аналитика", exact: true })).toBeVisible();
    await expect(page.getByText("Учтённые поступления", { exact: true }).first()).toBeVisible();
  });
});
