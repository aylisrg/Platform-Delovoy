import { test, expect } from "@playwright/test";

const PHOTO_COUNT = 10;

test.beforeEach(async ({ page, baseURL }) => {
  // Local UI check: no booking, payment or analytics traffic leaves the box.
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
    throw new Error("Play Park gallery tests require an isolated local Next server");
  }
  await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    return target.origin === new URL(baseURL).origin ? route.continue() : route.abort();
  });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`Play Park gallery at ${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });

    test("every photo loads; filmstrip, keys and Esc work; table cards use the new photos", async ({ page }) => {
      await page.goto("/ps-park");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

      const section = page.locator("#photos");
      await expect(section.getByRole("heading", { name: "Фото" })).toBeVisible();
      for (const img of await page.locator("#tables img").all()) {
        expect(decodeURIComponent((await img.getAttribute("src")) ?? "")).toContain("/media/ps-park/gallery/");
      }

      const trigger = section.getByRole("button", { name: "Плей Парк: открыть фотографии", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Плей Парк", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`Фото 2 из ${PHOTO_COUNT}`)).toBeVisible();

      const strip = dialog.getByRole("group", { name: "Все фотографии" });
      await expect(strip.getByRole("button")).toHaveCount(PHOTO_COUNT);
      for (let n = 1; n <= PHOTO_COUNT; n++) {
        await strip.getByRole("button").nth(n - 1).click();
        await expect(dialog.getByText(`Фото ${n} из ${PHOTO_COUNT}`)).toBeVisible();
        const photo = dialog.getByRole("img");
        await expect(photo).toHaveJSProperty("complete", true);
        await expect(photo).not.toHaveJSProperty("naturalWidth", 0);
      }
      await expect(dialog.getByRole("img")).toHaveAttribute("alt", "Плей Парк, вход");

      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByText(`Фото 1 из ${PHOTO_COUNT}`)).toBeVisible();
      await page.keyboard.press("End");
      await expect(dialog.getByText(`Фото ${PHOTO_COUNT} из ${PHOTO_COUNT}`)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    });
  });
}
