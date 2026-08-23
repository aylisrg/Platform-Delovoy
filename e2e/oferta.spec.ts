import { test, expect } from "@playwright/test";

/**
 * Страницы юридических документов (ТЗ §4, чек-лист приёмки §10).
 *
 * Проверяем то, что ломается молча: полноту текста, работу якорей на пунктах,
 * отсутствие свёрнутых блоков и noindex у архивных редакций.
 */

test.describe("Публичная оферта", () => {
  test("открывается целиком, вместе с приложениями", async ({ page }) => {
    await page.goto("/oferta");

    await expect(page.getByRole("heading", { name: "ПУБЛИЧНАЯ ОФЕРТА", level: 1 })).toBeVisible();

    // Все три приложения на месте — их отсутствие означало бы обрезанный текст.
    await expect(page.getByRole("heading", { name: /Приложение № 1/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Приложение № 2/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Приложение № 3/ })).toBeVisible();

    // Плашка редакции — дата, от которой считается применимость условий.
    // Ищем именно экранную плашку: тот же текст есть в печатном колонтитуле,
    // а он на экране скрыт.
    await expect(
      page.locator(".legal-doc strong").filter({ hasText: /^Редакция № \d+$/ })
    ).toBeVisible();
  });

  test("не прячет текст под аккордеоны и не продаёт", async ({ page }) => {
    await page.goto("/oferta");

    // Свёрнутый текст = аргумент в суде, что ознакомиться было нельзя.
    await expect(page.locator("details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /показать полностью/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Забронировать/ })).toHaveCount(0);
  });

  test("якорь на пункте прокручивает к нужному месту", async ({ page }) => {
    await page.goto("/oferta#p-7-4-2");

    const clause = page.locator("#p-7-4-2");
    await expect(clause).toBeVisible();
    await expect(clause).toContainText("стоимость Дополнительных услуг");
  });

  test("Правила посещения доступны по якорю из формы бронирования", async ({ page }) => {
    await page.goto("/oferta#pravila");

    const rules = page.locator("#pravila");
    await expect(rules).toBeVisible();
    await expect(rules).toContainText("ПРАВИЛА ПОСЕЩЕНИЯ");
  });

  test("прайс-лист приложения № 2 отрисован таблицей", async ({ page }) => {
    await page.goto("/oferta");

    await expect(page.getByRole("cell", { name: "Беседка № 1" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "до 20 чел." })).toBeVisible();
  });

  test("оглавление ведёт к разделу", async ({ page }) => {
    await page.goto("/oferta");

    const toc = page.getByRole("navigation", { name: "Содержание документа" });
    const link = toc.getByRole("link", { name: /Изменение, перенос и отмена/ });
    // На узком вьюпорте оглавление скрыто за кнопкой — тогда проверять нечего.
    if (await link.isVisible()) {
      await link.click();
      await expect(page.locator("#p-7")).toBeInViewport();
    }
  });

  test("архивная редакция открывается по прямой ссылке и помечена noindex", async ({ page }) => {
    const res = await page.goto("/oferta/v/v1");
    expect(res?.status()).toBe(200);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
    await expect(page.getByRole("heading", { name: "ПУБЛИЧНАЯ ОФЕРТА", level: 1 })).toBeVisible();
  });

  test("действующая редакция индексируется", async ({ page }) => {
    await page.goto("/oferta");
    const robots = page.locator('meta[name="robots"]');
    if ((await robots.count()) > 0) {
      await expect(robots).not.toHaveAttribute("content", /noindex/);
    }
  });

  test("архив редакций доступен", async ({ page }) => {
    await page.goto("/oferta/archive");
    await expect(page.getByRole("heading", { name: /Редакции публичной оферты/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Редакция № 1/ })).toBeVisible();
  });
});

test.describe("Политика обработки персональных данных", () => {
  test("открывается и содержит правовые основания обработки", async ({ page }) => {
    await page.goto("/privacy");

    await expect(page.getByRole("heading", { name: "ПОЛИТИКА", level: 1 })).toBeVisible();
    await expect(page.locator("#p-5")).toContainText("Цели обработки");
    await expect(page.getByText(/152-ФЗ/).first()).toBeVisible();
  });
});

test.describe("Футер", () => {
  test("на публичных страницах есть ссылки на документы и реквизиты ИП", async ({ page }) => {
    for (const path of ["/", "/gazebos", "/cafe"]) {
      await page.goto(path);
      const footer = page.locator("footer").last();
      await expect(footer.getByRole("link", { name: "Публичная оферта" })).toBeVisible();
      await expect(
        footer.getByRole("link", { name: "Политика обработки персональных данных" })
      ).toBeVisible();
      await expect(footer).toContainText("ОГРНИП 305770002665641");
    }
  });
});
