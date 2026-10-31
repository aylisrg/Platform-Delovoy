import { test, expect, type Page } from "@playwright/test";
import { availability } from "./fixtures/gazebos/data";

const errors = new WeakMap<Page, string[]>();
const mutations = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  mutations.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (/\/api\/(gazebos\/book|payments)/.test(request.url())) mutations.get(page)!.push(request.url());
  });
  // All test data stays in this browser/local fixture. Never contact production.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") await route.fallback();
    else await route.abort();
  });
  await page.route("**/media/gazebos/**", async (route) => {
    const label = new URL(route.request().url()).pathname.match(/gazebo-(\d)\/photo-(\d+)/);
    await route.fulfill({ contentType: "image/svg+xml", body:
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#e8e8ed"/><text x="80" y="160" fill="#333" font-size="64">TEST FIXTURE ${label?.[1]} / ${label?.[2]} — NO PHOTO</text></svg>` });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { success: true, data: [] };
    if (path === "/api/gazebos/availability") json = availability;
    if (path === "/api/legal/current") json = { success: true, data: { slug: "fixture-v1" } };
    await route.fulfill({ json });
  });
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Browser runtime errors").toEqual([]);
  expect(mutations.get(page), "No booking or payment mutation is permitted").toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`responsive components have no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/gazebos");
    await expect(page.getByRole("heading", { name: "Барбекю Парк", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "page width").toBeLessThanOrEqual(width);
    const visibleHeaderLinks = await page.locator("header a").evaluateAll((links) => links
      .map((link) => link.getBoundingClientRect()).filter((box) => box.width > 0)
      .every((box) => box.left >= 0 && box.right <= window.innerWidth));
    expect(visibleHeaderLinks, "fixed header links must also fit the viewport").toBe(true);
    const cards = page.getByRole("article");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (width < 768) {
      expect(second!.y).toBeGreaterThan(first!.y + first!.height);
      const cta = await cards.first().getByRole("link", { name: "Выбрать №1" }).boundingBox();
      expect(cta!.height).toBeGreaterThanOrEqual(44);
      expect(cta!.width).toBeGreaterThan(first!.width - 44);
    } else {
      expect(second!.y).toBe(first!.y);
      expect(second!.x).toBeGreaterThan(first!.x);
    }
    if (width < 1280) {
      const menu = page.getByRole("button", { name: "Меню", exact: true });
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await page.locator("header").getByRole("link", { name: "Забронировать", exact: true }).click();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(page).toHaveURL(/#booking$/);
    }
  });
}

for (const width of [390, 1440]) {
  test(`native dialog, focus trap, backdrop, rapid close, reopen, Back/Forward and booking at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/gazebos");
    for (const number of [1, 2, 3, 4, 5]) {
      await page.getByRole("link", { name: `Перейти к Беседка №${number}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#gazebo-${number}$`));
      const trigger = page.getByRole("button", { name: `Беседка №${number}: открыть фотографии`, exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: `Беседка №${number}`, exact: true });
      const close = dialog.getByRole("button", { name: "Закрыть фотографии" });
      await expect(dialog).toBeVisible();
      await expect(close).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: "Следующее фото" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.keyboard.press("End");
      await expect(dialog.getByText("Фото 3 из 3")).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByText("Фото 1 из 3")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.goBack();
      await expect(dialog).not.toBeVisible();
      await page.goForward();
      await expect(dialog).toBeVisible();
      // Same event-loop turn: a rapid double close must consume only one history entry.
      await close.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
      await expect(dialog).not.toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#gazebo-${number}$`));
      await trigger.click();
      await dialog.click({ position: { x: 1, y: 1 } });
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    await page.getByRole("link", { name: "Выбрать №3", exact: true }).click();
    await expect(page).toHaveURL(/#booking$/);
    const flow = page.getByTestId("booking-flow");
    await expect(flow).toBeInViewport();
    await flow.getByRole("button", { name: "Показать доступность" }).click();
    const selected = page.getByTestId("resource-fixture-r3");
    await expect(selected).toHaveAttribute("data-preferred", "true");
    for (let hour = 11; hour < 15; hour++) await selected.getByRole("button", { name: `${hour}:00–${hour + 1}:00`, exact: true }).click();
    await flow.getByRole("button", { name: "Продолжить →" }).click();
    await expect(page.getByTestId("offer-accept-submit")).toHaveAttribute("aria-disabled", "true");
    await flow.getByRole("button", { name: "Назад", exact: true }).click();
    await expect(selected).toHaveAttribute("data-preferred", "true");
    if (width < 768) await expect(page.getByTestId("booking-cta-sticky-bar")).not.toBeVisible();
  });
}

test.describe("touch interaction fixture", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("native touch swipe, vertical gesture guard and disabled booking", async ({ page }) => {
    // This check deliberately exercises failed-image rendering, not real photos.
    await page.route("**/media/gazebos/**", (route) => route.abort());
    await page.goto("/gazebos?disabled=1");
    await expect(page.getByTestId("booking-cta-card")).toHaveCount(0);
    await expect(page.getByTestId("booking-cta-sticky")).toHaveCount(0);
    await page.getByRole("button", { name: "Беседка №1: открыть фотографии", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Беседка №1", exact: true });
    await expect(dialog.getByText("Фото временно недоступно")).toBeVisible();
    const area = await dialog.getByText("Фото временно недоступно").boundingBox();
    const x = area!.x + area!.width * 0.8;
    const y = area!.y + area!.height * 0.5;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 5, y: y + 100 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(dialog.getByText("Фото 2 из 3")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 180, y: y + 5 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(dialog.getByText("Фото 3 из 3")).toBeVisible();
    await cdp.detach();
    await dialog.getByRole("button", { name: "Закрыть фотографии" }).tap();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });
});
