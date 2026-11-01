import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  // These are local release checks: never contact analytics or payment providers.
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
    throw new Error("Gazebo release tests require an isolated local Next server");
  }
  await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    return target.origin === new URL(baseURL).origin ? route.continue() : route.abort();
  });
});

// Local UI checks: no booking submission or payment; analytics use the isolated DB.
for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 812 }]) {
  test.describe(`Gazebo gallery at ${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });

    test("number links, real photos, keyboard, focus, Back/Forward and booking destination", async ({ page }) => {
      await page.goto("/gazebos");
      await page.evaluate(() => document.fonts.ready);
      const cards = page.locator('article[id^="gazebo-"]');
      await expect(cards).toHaveCount(5);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      for (const item of await page.locator("header a:visible, header button:visible").all()) {
        const box = await item.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await page.screenshot({ path: `test-results/gazebos-viewport-${viewport.width}.png` });

      for (const number of [1, 2, 3, 4, 5]) {
        const card = page.locator(`#gazebo-${number}`);
        await page.getByRole("link", { name: `Перейти к Беседка №${number}`, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#gazebo-${number}$`));
        // Eagerly inspect all visible card images; a placeholder/error message is a failure.
        await expect(card.getByRole("img")).toHaveCount(4);
        for (const photo of await card.getByRole("img").all()) {
          await expect(photo).toHaveJSProperty("complete", true);
          await expect(photo).not.toHaveJSProperty("naturalWidth", 0);
        }
        const trigger = card.getByRole("button", { name: `Беседка №${number}: открыть фотографии`, exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: `Беседка №${number}`, exact: true });
        await expect(dialog).toBeVisible();
        const close = dialog.getByRole("button", { name: "Закрыть фотографии" });
        await expect(close).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(dialog.getByRole("button", { name: "Следующее фото" })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await page.keyboard.press("End");
        await expect(dialog.getByText("Фото 3 из 3")).toBeVisible();
        await expect(dialog.getByRole("img")).toHaveJSProperty("complete", true);
        await expect(dialog.getByRole("img")).not.toHaveJSProperty("naturalWidth", 0);
        if (number === 3 && [1440, 390].includes(viewport.width)) {
          await page.screenshot({ path: `test-results/gazebos-portrait-${viewport.width}.png` });
        }
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
        await close.click();
        await expect(dialog).not.toBeVisible();
        const allPhotos = card.getByRole("button", { name: `Беседка №${number}: все фотографии`, exact: true });
        await allPhotos.click();
        await expect(dialog).toBeVisible();
        await close.click();
        await expect(dialog).not.toBeVisible();
        await expect(allPhotos).toBeFocused();
        await card.getByRole("button", { name: `Беседка №${number}: открыть фото 1 из 3`, exact: true }).click();
        await expect(dialog.getByText("Фото 1 из 3")).toBeVisible();
        await close.click();
        await expect(dialog).not.toBeVisible();
      }

      const firstCard = page.locator("#gazebo-1");
      await firstCard.getByRole("link", { name: "Выбрать №1", exact: true }).click();
      await expect(page).toHaveURL(/#booking$/);
      await expect(page.getByTestId("booking-flow")).toBeInViewport();
      await expect(page.locator("#booking-date")).toBeVisible();
      await page.screenshot({ path: `test-results/gazebos-real-${viewport.width}.png`, fullPage: true });
    });
  });
}

test.describe("Gazebo touch gallery", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("horizontal swipe changes the photo; modal close restores the page", async ({ page }) => {
    await page.goto("/gazebos");
    await page.getByRole("button", { name: "Беседка №1: открыть фото 1 из 3", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Беседка №1", exact: true });
    const photo = dialog.getByRole("img");
    const box = await photo.boundingBox();
    const x = box!.x + box!.width * 0.8;
    const y = box!.y + box!.height * 0.5;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 180, y: y + 5 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect(dialog.getByText("Фото 2 из 3")).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть фотографии" }).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });
});
