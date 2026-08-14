import type { Page } from "@playwright/test";

/**
 * Sign in through the real Credentials-provider UI flow. Only works against
 * accounts created by `scripts/seeds/dev-overlay.ts` (DEV_OVERLAY=1) —
 * user@local/user, manager@local/manager, admin@local/admin.
 *
 * The sign-in page defaults to a Telegram-primary layout until the async
 * `/api/auth/providers-status` check resolves (no TELEGRAM_BOT_TOKEN in
 * CI/E2E, so it flips to email-primary) — Playwright's auto-retrying
 * locator handles that transition without an explicit wait.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");
  await page.getByRole("button", { name: "Войти по Email" }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  // Post-login redirect target depends on role and RBAC (e.g. a MANAGER not
  // assigned to any admin section lands on /admin/forbidden, not
  // /admin/dashboard) — don't assume a destination, just wait for the
  // hard navigation (window.location.href) away from the sign-in page.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
    timeout: 15_000,
  });
}
