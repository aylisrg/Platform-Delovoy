import { test, expect, type Page } from "@playwright/test";
import { populatedBusinessReport, syntheticBusinessPreference } from "./fixtures/business-visual";

/** Synthetic transport fixtures only. No app sessions, recipients or sends are created. */
async function fixture(page: Page, role: "USER" | "ADMIN" | "MANAGER" | "SUPERADMIN", analytics = false, sdkDelay = 0) {
  const state = { enabled: false, booking: true, release: true, writes: [] as string[], businessRequests: 0, staffRequests: 0, forbidden: false };
  await page.route("**/api/auth/session", route => route.fulfill({ json: null }));
  await page.route("https://telegram.org/**", route => route.abort());
  await page.addInitScript((delay) => {
    const install = () => {
    const backHandlers = new Set<() => void>();
    Object.defineProperty(window, "Telegram", { configurable: true, value: { WebApp: {
      initData: "synthetic-ui-fixture", ready() {}, expand() {}, colorScheme: "light", themeParams: {},
      BackButton: { show() {}, hide() {}, onClick(cb: () => void) { backHandlers.add(cb); }, offClick(cb: () => void) { backHandlers.delete(cb); } },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    } } });
    window.addEventListener("fixture-telegram-back", () => backHandlers.forEach(cb => cb()));
    };
    if (delay) setTimeout(install, delay); else install();
  }, sdkDelay);
  await page.route("**/api/webapp/**", async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const reply = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === "/api/webapp/auth") return reply({ token: "synthetic-not-a-session", user: { id: "synthetic", name: "Тестовый пользователь", role, image: null, telegramId: null }, capabilities: { isStaff: role !== "USER", staffSections: analytics ? ["analytics"] : [], notificationCategories: role === "USER" ? [] : ["system"], canNotificationCenter: role !== "USER" } });
    if (path === "/api/webapp/feed") return reply({ items: [], nextCursor: null, unreadCount: 0 });
    if (path === "/api/webapp/preferences") {
      if (req.method() === "PUT") { state.booking = req.postDataJSON().enableBooking ?? state.booking; state.writes.push(path); }
      return reply({ preferences: { enableBooking: state.booking, enableOrder: true, enableReminder: true, preferredChannel: "AUTO" }, availableChannels: [{ channel: "TELEGRAM", connected: true }] });
    }
    if (path === "/api/webapp/notification-center") {
      state.staffRequests++;
      if (req.method() === "PUT") { state.release = req.postDataJSON().enabled; state.writes.push(path); }
      return reply({ role, channel: { kind: "TELEGRAM", status: "active", provisionedNow: false }, categories: [{ key: "system", label: "Системные", description: "Обновления и релизы платформы", icon: "news", delivery: "personal", events: [{ eventType: "system.release", label: "Релизы платформы", description: "Что нового появилось в приложении", enabled: state.release, source: "explicit", caption: "Лично в Telegram", blockers: [] }] }], protected: [], hint: null, emptyState: null, transparencyNote: "Синтетический пример настроек" });
    }
    if (path.startsWith("/api/webapp/business-analytics")) {
      state.businessRequests++;
      if (state.forbidden || role === "USER" || role === "MANAGER" || (role === "ADMIN" && !analytics)) return route.fulfill({ status: 403, json: { success: false, error: { code: "FORBIDDEN", message: "Доступ отозван" } } });
      if (path.endsWith("/subscription")) {
        if (req.method() === "PUT") { state.enabled = req.postDataJSON().enabled; state.writes.push(path); }
        return reply({ ...syntheticBusinessPreference, enabled: state.enabled, telegramReady: true, lastDelivery: null });
      }
      if (path === "/api/webapp/business-analytics" && req.method() === "GET") return reply(populatedBusinessReport);
    }
    // Never allow this UI suite to send messages or mutate an actual backend.
    return route.fulfill({ status: 500, json: { success: false, error: { message: `Unexpected fixture endpoint: ${path}` } } });
  });
  return state;
}

for (const role of ["SUPERADMIN", "ADMIN"] as const) {
  test(`${role}: main screen → weekly settings → report → back, persisted on/off`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page, role, true);
    await page.goto("/webapp");
    const entry = page.getByRole("link", { name: /Центр уведомлений/ });
    await expect(entry).toBeVisible();
    expect((await entry.boundingBox())!.y).toBeLessThan((await page.getByRole("navigation", { name: "Разделы", exact: true }).boundingBox())!.y);
    if (process.env.CI) await page.screenshot({ path: `playwright-report/miniapp-${role}-home.png`, fullPage: true, animations: "disabled" });
    await entry.click();
    const weekly = page.getByRole("switch", { name: "Недельный бизнес-отчёт" });
    await expect(weekly).toHaveAttribute("aria-checked", "false");
    expect(state.writes).toEqual([]);
    await weekly.click(); await expect(weekly).toHaveAttribute("aria-checked", "true");
    await page.reload(); await expect(weekly).toHaveAttribute("aria-checked", "true");
    await weekly.click(); await expect(weekly).toHaveAttribute("aria-checked", "false");
    await page.reload(); await expect(weekly).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Бронирования", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Релизы платформы" })).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.CI) await page.screenshot({ path: `playwright-report/miniapp-${role}-center.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Открыть бизнес-аналитику" }).click();
    await expect(page.getByRole("heading", { name: "Бизнес-аналитика", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "В центр уведомлений" }).click();
    await expect(page).toHaveURL(/\/webapp\/notifications$/);
    await expect(page.getByRole("heading", { name: "Центр уведомлений", exact: true })).toBeVisible();
    await expect(weekly).toHaveAttribute("aria-checked", "false");
    await page.evaluate(() => window.dispatchEvent(new Event("fixture-telegram-back")));
    await expect(page).toHaveURL(/\/webapp$/);
    expect(state.writes).toEqual(["/api/webapp/business-analytics/subscription", "/api/webapp/business-analytics/subscription"]);
  });
}

for (const role of ["USER", "MANAGER", "ADMIN"] as const) {
  test(`${role} without analytics: ordinary center stays useful, no business controls or requests`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const state = await fixture(page, role);
    await page.goto("/webapp");
    await expect(page.getByText("Бизнес-отчёты · настроить")).toHaveCount(0);
    await page.getByRole("link", { name: /Центр уведомлений/ }).click();
    const booking = page.getByRole("switch", { name: "Бронирования", exact: true });
    await expect(booking).toHaveAttribute("aria-checked", "true");
    await booking.click(); await expect(booking).toHaveAttribute("aria-checked", "false");
    await page.reload(); await expect(booking).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Недельный бизнес-отчёт" })).toHaveCount(0);
    expect(state.businessRequests).toBe(0);
    if (role === "USER") expect(state.staffRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.CI) await page.screenshot({ path: `playwright-report/miniapp-${role}-ordinary-center.png`, fullPage: true, animations: "disabled" });
    await page.goto("/webapp/business-analytics");
    await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
    expect(state.businessRequests).toBe(0);
  });
}

test("revoked access removes business controls while personal settings remain", async ({ page }) => {
  const state = await fixture(page, "SUPERADMIN");
  await page.goto("/webapp/notifications");
  const weekly = page.getByRole("switch", { name: "Недельный бизнес-отчёт" });
  await expect(weekly).toBeVisible(); state.forbidden = true;
  await weekly.click(); await expect(weekly).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Бронирования", exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("direct center entry waits for a delayed Telegram SDK before binding native back", async ({ page }) => {
  await fixture(page, "USER", false, 600);
  await page.goto("/webapp/notifications");
  await expect(page.getByRole("switch", { name: "Бронирования", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-telegram-back")));
  await expect(page).toHaveURL(/\/webapp$/);
});
