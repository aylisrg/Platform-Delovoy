import { test, expect } from "@playwright/test";

test.describe("Главная страница", () => {
  test("отвечает 200 и рендерит ключевые блоки", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("доверяют");
    await expect(page.getByRole("link", { name: "Барбекю Парк" })).toHaveAttribute("href", "/gazebos");
    await expect(page.getByRole("link", { name: "Плей Парк" })).toHaveAttribute("href", "/ps-park");
    await expect(page.getByRole("link", { name: "Кафе" })).toHaveAttribute("href", "/cafe");
    await expect(page.locator("footer")).toBeVisible();
  });
});

test.describe("Health check", () => {
  test("GET /api/health отвечает 200 success", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.checks.database.status).toBe("healthy");
    expect(body.checks.redis.status).toBe("healthy");
  });
});
