import { test, expect } from "@playwright/test";

// HTTP regression through the real Next.js proxy. Invalid credentials only:
// the test must never start scheduled business work, even in a seeded CI DB.
for (const slug of [
  "inventory", "novofon-calls-sync", "rental-payment-reminders",
  "overdue-session-reminders", "process-recurring", "notifications",
  "process-outgoing", "payments-reconcile",
]) {
  test(`cron/${slug} reaches its Bearer guard without a session`, async ({ request }) => {
    const response = await request.get(`/api/cron/${slug}`);
    expect([401, 503]).toContain(response.status());
    const body = await response.json();
    expect(body.success).toBe(false);
    // Distinguishes the route's credential check from the proxy's old
    // "Необходимо войти в аккаунт" denial (also a 401).
    expect(["Invalid cron token", "CRON_SECRET is not configured"]).toContain(body.error.message);
  });
}
