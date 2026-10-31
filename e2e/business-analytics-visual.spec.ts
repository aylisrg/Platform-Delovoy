import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { loginAs } from "./helpers/auth";
import { populatedBusinessReport, syntheticBusinessPreference } from "./fixtures/business-visual";

const artifactDirectory = "playwright-report/business-populated-visual";

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = `${artifactDirectory}/${name}.png`;
  const print = name.includes("print");
  await page.locator("main").evaluate(element => { element.scrollTop = 0; });
  if (!print) {
    // Keep an unmodified viewport capture, then expand only scroll-shell height
    // for the full report; otherwise fullPage captures just the nested viewport.
    await page.screenshot({ path: `${artifactDirectory}/${name}-viewport.png`, animations: "disabled" });
    await page.locator(".business-analytics").evaluate(element => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) parent.setAttribute("data-qa-capture-shell", "");
    });
  }
  const expanded = print ? null : await page.addStyleTag({ content: "[data-qa-capture-shell] { height: auto !important; max-height: none !important; overflow: visible !important; }" });
  try { await page.screenshot({ path, fullPage: true, animations: "disabled" }); }
  finally {
    await expanded?.evaluate(element => element.parentNode?.removeChild(element));
    await page.locator("[data-qa-capture-shell]").evaluateAll(elements => elements.forEach(element => element.removeAttribute("data-qa-capture-shell")));
  }
  await testInfo.attach(name, { path, contentType: "image/png" });
}

// These captures validate the real rendered component with controlled API data.
// They are not evidence of production accounting or a live Telegram delivery.
test.describe("Business analytics populated visual QA", () => {
  for (const advertising of ["available", "unavailable"] as const) {
    test(`full report, mobile and print with advertising ${advertising}`, async ({ page }, testInfo) => {
      await loginAs(page, "admin@local", "admin");
      const report = structuredClone(populatedBusinessReport);
      if (advertising === "unavailable") {
        report.marketing.adSpend = null;
        report.marketing.clicks = null;
        report.quality.warnings.push("Яндекс.Директ не ответил: расход и клики недоступны; визиты Метрики доступны.");
      }
      await page.route("**/api/analytics/business**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        // Never forward an accidental mutation or message delivery from this UI test.
        if (request.method() !== "GET") return route.abort("blockedbyclient");
        if (path !== "/api/analytics/business" && path !== "/api/analytics/business/subscription") return route.abort("blockedbyclient");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: path.endsWith("/subscription") ? syntheticBusinessPreference : report }) });
      });
      await mkdir(artifactDirectory, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/admin/analytics/business?period=7d&weekEnding=2026-10-25");
      await expect(page.getByText("Учтённые поступления", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(report.quality.warnings[0], { exact: true })).toBeVisible();
      // Explicit synthetic label in every capture; no production UI modification.
      await page.locator(".business-analytics").evaluate(element => {
        const label = document.createElement("p");
        label.textContent = "СИНТЕТИЧЕСКИЙ QA · ДАННЫЕ НЕ ИЗ PRODUCTION";
        label.style.cssText = "font-size:12px;font-weight:700;color:#92400e;margin-bottom:16px";
        element.prepend(label);
      });
      await expect(page.getByRole("switch", { name: "Недельный бизнес-отчёт" })).toHaveAttribute("aria-checked", "false");
      await expect(page.getByRole("button", { name: "Отправить мне тест" })).toBeDisabled();
      const marketing = page.getByRole("region", { name: "Сайт и реклама" });
      await expect(marketing.getByText("Нет данных", { exact: true })).toHaveCount(advertising === "unavailable" ? 2 : 0);
      await expect(marketing).toContainText(/12\s?840/);
      if (advertising === "available") await expect(marketing).toContainText(/21\s?450,75/);
      // Focus the refund-heavy day: verify keyboard access and negative net.
      await page.getByRole("button", { name: /^21\.10: поступления/ }).focus();
      await expect(page.getByRole("region", { name: "Движение денег по дням" }).locator('[aria-live="polite"]')).toContainText(/-3\s?500/);
      await page.getByText("Точные значения по дням", { exact: true }).click();
      await page.getByText("Как устроен отчёт", { exact: true }).click();
      await expect(page.getByRole("table", { name: "Движение денег по дням, рубли" })).toBeVisible();
      await capture(page, testInfo, `${advertising}-desktop-full`);

      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await capture(page, testInfo, `${advertising}-mobile-full`);
      await page.getByRole("region", { name: "Источники и качество данных" }).screenshot({ path: `${artifactDirectory}/${advertising}-mobile-quality.png`, animations: "disabled" });

      // Start print with the disclosure panels closed, as in the default UI.
      await page.getByText("Точные значения по дням", { exact: true }).click();
      await page.getByText("Как устроен отчёт", { exact: true }).click();
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.emulateMedia({ media: "print" });
      await expect(page.getByRole("button", { name: "Отправить мне тест" })).toBeHidden();
      await capture(page, testInfo, `${advertising}-print-full`);
      const pdfPath = `${artifactDirectory}/${advertising}-print-a4.pdf`;
      const pdf = await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" } });
      await testInfo.attach(`${advertising}-print-a4`, { path: pdfPath, contentType: "application/pdf" });
      await writeFile(`${artifactDirectory}/${advertising}-fixture.json`, JSON.stringify(report, null, 2));
      await writeFile(`${artifactDirectory}/README.txt`, "SYNTHETIC UI QA ONLY — no production business data.\nAuthenticated seeded CI account; report/preferences responses replaced in the browser. Mutations blocked.\nIncludes positive receipts, refunds, adjustments, a negative-net day, a zero day, nonzero funnel, quality warnings, available and unavailable advertising.\nDesktop 1440px; mobile 390px. Viewport captures preserve the normal scroll shell; full screen-media captures temporarily expand only ancestor heights/overflow to expose the full report.\nPrint media 794px plus paginated A4 PDF uses unmodified production styles. Disclosures expanded on screen; closed before print to verify print CSS.\nThese artifacts do not prove production accounting, role enforcement or Telegram delivery.\n");
      await expect(page.getByRole("table", { name: "Движение денег по дням, рубли" })).toBeVisible();
      expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
    });
  }
});
