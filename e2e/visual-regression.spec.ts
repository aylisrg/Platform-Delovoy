import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

/**
 * Скриншот-регрессии ключевых страниц (issue #579). CSS/layout-поломки
 * невидимы unit-тестам, tsc и LLM-ревью диффа — они не видят рендер.
 *
 * `animations: "disabled"` останавливает CSS/Web-анимации перед снимком —
 * штатная опция Playwright (issue упоминал "mask/stylePath": stylePath не
 * существует в API этой версии `@playwright/test`, `mask` — существует и
 * используется ниже для действительно динамичных блоков: сетки доступности
 * тайм-слотов на /ps-park и /gazebos зависят от того, какие брони уже
 * создали другие e2e-спеки этого же серийного прогона (booking flows), и
 * фото меню на /cafe могут поменяться при следующем редактировании меню).
 */
test.describe("Скриншот-регрессии ключевых страниц", () => {
  test("главная — desktop", async ({ page }) => {
    await page.goto("/");
    // Десктопный hero — автоплей-видео (`hero-section-with-video.tsx`),
    // конкретный кадр в момент снимка недетерминирован между прогонами.
    // `mask` тут не подходит: у видео-слоя `absolute inset-0` на всю
    // секцию, а заголовок/CTA/статистика лежат поверх него в том же
    // прямоугольнике (просто выше по z-index) — маска по bounding box
    // скрыла бы вместе с видео и весь текстовый контент, который как раз
    // и должен остаться проверяемым (см. AC1: намеренная поломка цвета
    // кнопки обязана валить тест). Вместо маски — детерминированно
    // останавливаем и скрываем сам <video> перед снимком: фон остаётся
    // сплошным (`bg-[#f5f5f7]`), контент поверх — как есть.
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('[data-testid="hero-video"] video');
      if (video) {
        video.pause();
        video.style.display = "none";
      }
    });
    await expect(page).toHaveScreenshot("home-desktop.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("главная — mobile 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveScreenshot("home-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("/cafe — desktop", async ({ page }) => {
    await page.goto("/cafe");
    await expect(page).toHaveScreenshot("cafe-desktop.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });

  test("/cafe — mobile 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cafe");
    await expect(page).toHaveScreenshot("cafe-mobile.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });

  test("/ps-park — desktop", async ({ page }) => {
    await page.goto("/ps-park");
    await expect(page).toHaveScreenshot("ps-park-desktop.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.getByTestId("availability-grid")],
    });
  });

  test("/gazebos — desktop", async ({ page }) => {
    await page.goto("/gazebos");
    await expect(page).toHaveScreenshot("gazebos-desktop.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.getByTestId("booking-flow")],
    });
  });

  test("/rental — desktop", async ({ page }) => {
    await page.goto("/rental");
    await expect(page).toHaveScreenshot("rental-desktop.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.getByTestId("occupancy-banner")],
    });
  });

  test("страница входа — desktop", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page).toHaveScreenshot("signin-desktop.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("/admin/dashboard — desktop", async ({ page }) => {
    await loginAs(page, "admin@local", "admin");
    await page.goto("/admin/dashboard");
    await expect(page).toHaveScreenshot("admin-dashboard-desktop.png", {
      fullPage: true,
      animations: "disabled",
      mask: [page.getByTestId("dashboard-stats")],
    });
  });
});
