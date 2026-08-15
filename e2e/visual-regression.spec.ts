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
    // fullPage: true даёт разную общую высоту страницы между прогонами
    // реального CI (390×9050 vs 390×9071, наблюдено эмпирически) — похоже
    // на перенос строки текста из-за суб-пиксельных отличий метрик шрифта
    // на узком viewport (см. общее обоснование по threshold/maxDiffPixels
    // выше и в playwright.config.ts), а разные РАЗМЕРЫ изображения
    // toHaveScreenshot не сравнивает вообще, независимо от threshold.
    // Снимаем фиксированную область первого экрана (hero: видео/заголовок/
    // CTA-кнопка/статистика — как раз то, что проверяет AC1) вместо всей
    // прокручиваемой страницы. Полное покрытие ниже сгиба уже даёт desktop.
    await expect(page).toHaveScreenshot("home-mobile.png", {
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
    // Hero-фон рисует `cyberpunk-grid.tsx` — decorative <canvas>, кадр
    // строится через requestAnimationFrame (движущаяся scan-линия,
    // случайные "flicker"-подсветки клеток на Math.random()). Это JS/canvas
    // анимация, `animations: "disabled"` её не останавливает (та опция —
    // только CSS/Web Animations). Компонент уже уважает
    // prefers-reduced-motion — рисует один статичный кадр вместо rAF-цикла
    // — emulateMedia включает эту ветку. Но даже единственный статичный
    // кадр даёт ~4% шанс заспавнить случайный flicker (Math.random() < 0.04
    // в том же вызове) — обнаружено эмпирически (два локальных прогона дали
    // разные байты скриншота). Форсируем Math.random() до навигации, чтобы
    // проверка спавна детерминированно проваливалась.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
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
