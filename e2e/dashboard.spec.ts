import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

const email = process.env.E2E_DASHBOARD_EMAIL ?? "user@local";
const password = process.env.E2E_DASHBOARD_PASSWORD ?? "user";

test.describe("Customer dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/https:\/\/mc\.yandex\./, (route) => route.abort());
    await loginAs(page, email, password);
  });

  test("groups sections and keeps name/email forms inside narrow viewports", async ({
    page,
  }) => {
    await page.goto("/dashboard?section=profile");
    await expect(
      page
        .getByRole("navigation", { name: "Разделы личного кабинета" })
        .getByRole("link"),
    ).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: "Привязать Яндекс" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Изменить имя" }).click();
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("button", { name: "Сохранить имя" }),
      ).toBeInViewport();
    }
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Отвязать Email" }).click();
    const dialog = page.getByRole("dialog", { name: "Отвязать контакт?" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Оставить контакт" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Отвязать Email" }),
    ).toBeFocused();
  });

  test("does not show fabricated defaults after a preference loading failure", async ({
    page,
  }) => {
    await page.route("**/api/notifications/preferences", (route) =>
      route.fulfill({ status: 500, json: { success: false } }),
    );
    await page.goto("/dashboard?section=profile");
    await expect(
      page.getByRole("button", { name: "Повторить загрузку настроек" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Сохранить настройки" }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.unroute("**/api/notifications/preferences");
    await page
      .getByRole("button", { name: "Повторить загрузку настроек" })
      .click();
    await expect(
      page.getByRole("button", { name: "Сохранить настройки" }),
    ).toBeVisible();
  });

  test("shows save errors while preserving the edited preference", async ({
    page,
  }) => {
    await page.goto("/dashboard?section=profile");
    const checkbox = page.getByRole("checkbox").first();
    const original = await checkbox.isChecked();
    await checkbox.setChecked(!original);
    await page.route("**/api/notifications/preferences", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 500,
            json: {
              success: false,
              error: { message: "Тестовая ошибка сохранения" },
            },
          })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Сохранить настройки" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Тестовая ошибка сохранения",
    );
    expect(await checkbox.isChecked()).toBe(!original);
    await expect(
      page.getByText("Настройки сохранены", { exact: true }),
    ).toHaveCount(0);
  });

  test("confirms email without manual tokens and retains a failed link for retry", async ({
    page,
  }) => {
    let calls = 0;
    await page.route("**/api/profile/contacts/email/confirm", (route) => {
      calls++;
      return route.fulfill({
        status: 400,
        json: { success: false, error: { message: "Тестовая ссылка истекла" } },
      });
    });
    const token = "a".repeat(64);
    await page.goto(`/dashboard?attachEmail=${token}`);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Тестовая ссылка истекла",
    );
    expect(calls).toBe(1);
    expect(page.url()).not.toContain(token);
    await expect(
      page.getByRole("button", { name: "Повторить подтверждение" }),
    ).toBeVisible();
    await expect(page.locator(`input[value="${token}"]`)).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain(token);
  });

  test("keeps other bookings and telemetry aggregates private", async ({
    page,
  }) => {
    const detail = await page.request.get(
      "/api/profile/bookings/not-an-owned-booking",
    );
    expect(detail.status()).toBe(404);
    const action = await page.request.post(
      "/api/profile/bookings/not-an-owned-booking",
      { data: { action: "cancel", confirmRefund: true } },
    );
    expect(action.status()).toBe(404);
    const stats = await page.request.get(
      "/api/analytics/dashboard?dateFrom=2026-01-01&dateTo=2026-01-07",
    );
    expect(stats.status()).toBe(403);
    const fakeSuccess = await page.request.post("/api/profile/events", {
      data: { event: "contact_link_succeeded", channel: "email" },
    });
    expect(fakeSuccess.status()).toBe(422);
  });
});
