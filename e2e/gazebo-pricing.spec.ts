import { test, expect } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`gazebo pricing has no retired offer and keeps booking available (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const response = await page.goto("/gazebos");
    expect(response?.ok()).toBe(true);
    // Includes server HTML, metadata and RSC payload, not just visible text.
    expect(await response!.text()).not.toMatch(/пицц|pizza|🍕|аренда от [46] часов/i);

    const pricing = page.locator("section").filter({ has: page.getByRole("heading", { name: "Прайс на аренду", exact: true }) });
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing.getByText("Караоке", { exact: true })).toBeVisible();
    await expect(pricing.getByText("750 ₽/час", { exact: true })).toBeVisible();
    await expect(pricing.getByRole("heading", { level: 3 })).toHaveText(["Дополнительные услуги"]);
    await expect(page.getByText(/пицц|в подарок|аренда от [46] часов/i)).toHaveCount(0);

    await page.getByTestId("booking-cta-hero").click();
    await expect(page).toHaveURL(/#booking$/);
    await expect(page.getByTestId("booking-flow")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Показать доступность", exact: true })).toBeVisible();
    // Do not submit the form or create a booking.
  });
}
