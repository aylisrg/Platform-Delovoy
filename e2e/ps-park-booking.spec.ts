import { test, expect } from "@playwright/test";
import { prisma } from "./helpers/db";

// The legal seed does not publish a Play Park offer or enable checkout.
// This full Next.js/DB E2E checks that the default stays fail-closed.
// Paid browser paths with API fixtures: node e2e/ps-park-checkout-browser.mjs.
test("Плей Парк: без активации гостю не создаётся неоплаченная заявка", async ({ page }) => {
  const parkModule = await prisma.module.findUnique({ where: { slug: "ps-park" } });
  expect((parkModule?.config as Record<string, unknown> | null)?.onlineBookingEnabled).not.toBe(true);
  const before = await prisma.booking.count({ where: { moduleSlug: "ps-park" } });
  await page.goto("/ps-park");
  const booking = page.locator("#booking");
  const dateInput = booking.locator('input[type="date"]:visible');
  // The park's current date uses Moscow time. UTC tomorrow can already be
  // selected after 21:00 UTC, so derive a different date from the actual form.
  const nextDate = new Date(`${await dateInput.inputValue()}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const bookingDate = nextDate.toISOString().slice(0, 10);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/ps-park/availability?date=${bookingDate}`)),
    dateInput.fill(bookingDate),
  ]);
  await booking.getByRole("button", { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
  await expect(booking.getByText("Онлайн-бронирование временно недоступно.")).toBeVisible();
  await expect(booking.getByRole("button", { name: "Оплатить", exact: true })).toBeDisabled();
  await expect(page.getByText("Заявка отправлена! Ожидайте подтверждения от менеджера.")).toHaveCount(0);
  const resource = await prisma.resource.findFirst({ where: { moduleSlug: "ps-park", isActive: true } });
  expect(resource).not.toBeNull();
  const response = await page.request.post("/api/ps-park/book", { data: {
    resourceId: resource!.id, requestId: crypto.randomUUID(), date: bookingDate,
    startTime: "10:00", endTime: "11:00", guestName: "QA гость", guestPhone: "+79991234567",
    email: "qa@example.test", acceptOffer: true, offerVersionSlug: "qa-not-published",
  } });
  expect(response.status()).toBe(400);
  expect(["ONLINE_BOOKING_UNAVAILABLE", "PAYMENTS_NOT_CONFIGURED"]).toContain((await response.json()).error.code);
  expect(await prisma.booking.count({ where: { moduleSlug: "ps-park" } })).toBe(before);
});
