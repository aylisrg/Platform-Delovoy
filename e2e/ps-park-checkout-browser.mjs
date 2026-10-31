/**
 * Local browser integration QA, without a database or real payment provider.
 * Run: node e2e/ps-park-checkout-browser.mjs
 * Uses the installed Chromium; never downloads browsers or calls external APIs.
 * Does not replace the full Next.js + PostgreSQL E2E release check.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const adapter = fileURLToPath(new URL("fixtures/next-browser-qa.tsx", import.meta.url));
const server = await createServer({
  root, configFile: false,
  resolve: { alias: [
    { find: "next/link", replacement: adapter },
    { find: "next/navigation", replacement: adapter },
    { find: "@", replacement: `${root}src` },
  ] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 4317, strictPort: true },
  plugins: [{ name: "local-checkout-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!/^\/(ps-park|payments\/qa-payment|qa-provider|qa-manager)(\?|$)/.test(req.url ?? "")) return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Local checkout QA</title><div id="root"></div><script type="module" src="/e2e/fixtures/ps-park-checkout.tsx"></script></html>');
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
let passed = 0;
let failed = 0;

async function run(name, scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const state = { status: "PENDING", reservationStatus: "PENDING", requests: [], moves: [], errors: [], failFirst: false };
  page.on("pageerror", (error) => state.errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/api/ps-park/bookings/qa-booking") return route.fulfill({ json: {
      success: true, data: { date: "2030-01-10", startTime: "2030-01-10T07:00:00.000Z", endTime: "2030-01-10T09:00:00.000Z" },
    } });
    if (url.pathname === "/api/ps-park/bookings/qa-booking/reschedule") {
      state.moves.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, data: {} } });
    }
    if (url.pathname === "/api/ps-park/book") {
      state.requests.push(route.request().postDataJSON());
      if (state.failFirst && state.requests.length === 1) return route.abort("failed");
      // Keep the first submit pending long enough to exercise the ref guard.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill({ json: { success: true, data: { id: "qa-booking", payment: { id: "qa-payment", confirmationUrl: "/qa-provider" } } } });
    }
    if (url.pathname === "/api/payments/qa-payment") return route.fulfill({ json: {
      success: true, data: { id: "qa-payment", status: state.status, reservationStatus: state.reservationStatus,
        moduleSlug: "ps-park", order: null, confirmationUrl: state.status === "PENDING" ? "/qa-provider" : null },
    } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { success: true, data: [] } });
    return route.continue();
  });
  try {
    await scenario(page, state);
    assert.deepEqual(state.errors, [], "browser runtime errors");
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

async function fill(page) {
  await page.goto("http://127.0.0.1:4317/ps-park");
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await page.getByLabel("Имя", { exact: true }).fill("QA гость");
  await page.getByLabel("Телефон", { exact: true }).fill("+79991234567");
  await page.getByLabel("Email для чека").fill("qa@example.test");
  await page.getByRole("checkbox").check();
}

try {
  await run("manager reschedules with preserved duration and one submit", async (page, state) => {
    await page.goto("http://127.0.0.1:4317/qa-manager");
    await page.getByRole("button", { name: "Перенести", exact: true }).click();
    await expect(page.getByText(/Оплаченные 120 мин/)).toBeVisible();
    await page.getByLabel("Новая дата", { exact: true }).fill("2030-01-12");
    await page.getByLabel("Новое время", { exact: true }).fill("12:00");
    await page.locator("form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await expect(page.getByRole("button", { name: "Подтвердить перенос" })).toHaveCount(0);
    assert.deepEqual(state.moves, [{ date: "2030-01-12", startTime: "12:00", expectedStartTime: "2030-01-10T07:00:00.000Z" }]);
  });
  await run("guest success and return to Play Park", async (page, state) => {
    await fill(page);
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Тестовая форма провайдера" })).toBeVisible();
    state.status = "SUCCEEDED"; state.reservationStatus = "CONFIRMED";
    await page.getByRole("link", { name: "Вернуться на сайт" }).click();
    await expect(page.getByRole("heading", { name: "Оплата прошла успешно!" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+7 (985) 244-46-24", exact: true })).toHaveAttribute("href", "tel:+79852444624");
    await expect(page.locator('a[href="tel:+74996774888"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Вернуться в Плей Парк" }).click();
    await expect(page).toHaveURL(/\/ps-park$/);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].amount, undefined);
  });
  await run("cancellation returns to Play Park and permits a new attempt", async (page, state) => {
    await fill(page);
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Тестовая форма провайдера" })).toBeVisible();
    state.status = "CANCELED"; state.reservationStatus = "CANCELLED";
    await page.getByRole("link", { name: "Вернуться на сайт" }).click();
    await expect(page.getByRole("heading", { name: "Оплата не прошла" })).toBeVisible();
    await expect(page.getByRole("link", { name: "К бронированию" })).toHaveAttribute("href", "/ps-park");
    await page.getByRole("link", { name: "К бронированию" }).click();
    await expect(page).toHaveURL(/\/ps-park$/);
    await fill(page);
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page).toHaveURL(/\/qa-provider$/);
    assert.equal(state.requests.length, 2);
    assert.notEqual(state.requests[0].requestId, state.requests[1].requestId);
  });
  await run("parallel submits produce one request", async (page, state) => {
    await fill(page);
    await page.locator("form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await expect(page).toHaveURL(/\/qa-provider$/);
    assert.equal(state.requests.length, 1);
  });
  await run("network retry preserves requestId", async (page, state) => {
    state.failFirst = true;
    await fill(page);
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page.getByText("Не удалось отправить бронирование")).toBeVisible();
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page).toHaveURL(/\/qa-provider$/);
    assert.equal(state.requests.length, 2);
    assert.equal(state.requests[0].requestId, state.requests[1].requestId);
  });
  await run("provider return alone never confirms a pending payment", async (page) => {
    await fill(page);
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    await expect(page).toHaveURL(/\/qa-provider$/);
    await page.getByRole("link", { name: "Вернуться на сайт" }).click();
    await expect(page.getByRole("heading", { name: "Ожидаем подтверждение оплаты…" })).toBeVisible();
    await expect(page.getByText("Оплата прошла успешно!")).toHaveCount(0);
    await page.getByRole("link", { name: "Открыть страницу оплаты" }).click();
    await expect(page).toHaveURL(/\/qa-provider$/);
  });
  await run("missing offer keeps checkout closed", async (page, state) => {
    await page.goto("http://127.0.0.1:4317/ps-park?disabled");
    await page.getByRole("button", { name: "10:00", exact: true }).click();
    await expect(page.getByText("Онлайн-бронирование временно недоступно.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Оплатить", exact: true })).toBeDisabled();
    assert.equal(state.requests.length, 0);
  });
} finally { await browser.close(); await server.close(); }
console.log(`Browser integration: ${passed} passed, ${failed} failed (API fixtures; no database/provider).`);
process.exitCode = failed ? 1 : 0;
