import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { startPSParkProvider, type ProviderRecord } from "./helpers/ps-park-provider";
import { paidE2EEnvironment, reservePSParkPort, startPSParkTestServer } from "./helpers/ps-park-test-server";

// Real Next routes + native Prisma + PostgreSQL. Only the external provider is fake.
// Existing PR CI supplies the database, migrations, seed and standalone build.
test.describe("Play Park paid checkout against real PostgreSQL", () => {
  test.describe.configure({ mode: "serial", timeout: 60_000 });
  let db: PrismaClient;
  let provider: Awaited<ReturnType<typeof startPSParkProvider>>;
  let app: Awaited<ReturnType<typeof startPSParkTestServer>>;
  let savedConfig: Prisma.JsonValue;
  let configChanged = false;
  let seededOffer: { id: string; contentHash: string };
  const offerSlug = "v2";
  const resourceIds: string[] = [];
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    const connection = paidE2EEnvironment(process.env);
    db = new PrismaClient({ datasourceUrl: connection.databaseURL });
    // Exercise the ordinary seed and approved document, without editing legal rows.
    const offers = await db.offerVersion.findMany({ where: { documentKey: "ps-park-offer", isCurrent: true } });
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    const body = readFileSync("content/legal/ps-park-offer/v2.md", "utf8");
    const contentHash = createHash("sha256").update(body.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
    expect(offer.slug).toBe(offerSlug);
    expect(offer.number).toBe(2);
    expect(offer.body).toBe(body);
    expect(offer.contentHash).toBe(contentHash);
    for (const date of [offer.publishedAt, offer.effectiveAt]) {
      expect(date.getTime()).toBeGreaterThan(0);
      expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    }
    seededOffer = { id: offer.id, contentHash };
    const parkModule = await db.module.findUniqueOrThrow({ where: { slug: "ps-park" } });
    savedConfig = parkModule.config;
    const config = parkModule.config && typeof parkModule.config === "object" && !Array.isArray(parkModule.config) ? parkModule.config : {};
    await db.module.update({ where: { slug: "ps-park" }, data: { config: { ...config, onlineBookingEnabled: true, minBookingHours: 1, openHour: 8, closeHour: 23, telegramChannelEnabled: false } } });
    configChanged = true;
    const token = randomUUID();
    const webhookSecret = randomUUID();
    provider = await startPSParkProvider({ token, webhookSecret });
    const port = await reservePSParkPort();
    provider.setAppOrigin(`http://127.0.0.1:${port}`);
    app = await startPSParkTestServer({ port, providerOrigin: provider.origin, providerToken: token, webhookSecret });
  });

  test.beforeEach(async ({ page }) => {
    // Browser follows only our isolated application/provider. No external analytics or payments.
    await page.route("**/*", route => [app.origin, provider.origin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  });

  test.afterAll(async () => {
    // Failed/partial setup must still restore shared Module.config.
    const stopped = await Promise.allSettled([app?.close(), provider?.close()]);
    if (!db) return;
    try {
      const bookings = await db.booking.findMany({ where: { resourceId: { in: resourceIds } }, select: { id: true } });
      const ids = bookings.map(booking => booking.id);
      const payments = await db.payment.findMany({ where: { moduleSlug: "ps-park", subjectId: { in: ids } }, select: { id: true } });
      const paymentIds = payments.map(payment => payment.id);
      await db.paymentRefund.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await db.financialTransaction.deleteMany({ where: { bookingId: { in: ids } } });
      await db.productEvent.deleteMany({ where: { entityId: { in: [...ids, ...paymentIds] } } });
      await db.outgoingNotification.deleteMany({ where: { entityId: { in: [...ids, ...paymentIds] } } });
      await db.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...paymentIds] } } });
      await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await db.booking.deleteMany({ where: { id: { in: ids } } });
      await db.resource.deleteMany({ where: { id: { in: resourceIds } } });
    } finally {
      try {
        if (configChanged) await db.module.update({ where: { slug: "ps-park" }, data: { config: savedConfig === null ? Prisma.DbNull : savedConfig } });
      } finally { await db.$disconnect(); }
    }
    for (const result of stopped) if (result.status === "rejected") throw result.reason;
  });

  async function input() {
    const id = `paid-e2e-${randomUUID()}`;
    resourceIds.push(id);
    await db.resource.create({ data: { id, name: id, moduleSlug: "ps-park", pricePerHour: 500, capacity: 4, isActive: true } });
    return { requestId: randomUUID(), resourceId: id, date: future, startTime: "16:00", endTime: "18:00", guestName: "Paid E2E Guest", guestPhone: "+79990001122", email: "paid-e2e@example.test", acceptOffer: true, offerVersionSlug: offerSlug };
  }
  async function book(request: APIRequestContext, data: Awaited<ReturnType<typeof input>>) {
    const response = await request.post(`${app.origin}/api/ps-park/book`, { data });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).data as { id: string; payment: { id: string; confirmationUrl: string } };
  }
  async function record(paymentId: string): Promise<ProviderRecord> {
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const result = provider.records.get(payment.providerPaymentId ?? "");
    expect(result).toBeDefined();
    return result!;
  }
  async function assertPaid(bookingId: string, paymentId: string, bookingStatus = "CONFIRMED") {
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(booking.status).toBe(bookingStatus);
    expect(booking.offerVersionId).toBe(seededOffer.id);
    expect(booking.offerContentHash).toBe(seededOffer.contentHash);
    expect(booking.acceptedOfferAt).not.toBeNull();
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.isTest).toBe(true);
    expect(Number(payment.amount)).toBe(1000);
    expect(Number((booking.metadata as Record<string, unknown>).onlinePaidAmount)).toBe(1000);
    const ledger = await db.financialTransaction.findMany({ where: { bookingId, type: "ONLINE_PAYMENT" } });
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].totalAmount)).toBe(1000);
  }

  test("AC-paid: public form → provider → webhook → confirmed; duplicate success credits once", async ({ page }) => {
    const data = await input();
    // No API interception: browser and server both execute production code.
    await page.goto(`${app.origin}/ps-park`);
    await expect(page.locator("section#booking")).toHaveAttribute("data-online-booking", "enabled");
    await expect(page.locator("section#booking")).toHaveAttribute("data-online-offer", "v2");
    await Promise.all([
      page.waitForResponse(response => response.url().includes(`/api/ps-park/availability?date=${future}`)),
      page.locator('#booking input[type="date"]').fill(future),
    ]);
    const resource = page.getByRole("heading", { name: data.resourceId, exact: true }).locator("../..");
    await resource.getByRole("button", { name: "16:00", exact: true }).click();
    await resource.getByRole("button", { name: "17:00", exact: true }).click();
    await page.getByLabel("Имя", { exact: true }).fill(data.guestName);
    await page.getByLabel("Телефон", { exact: true }).fill(data.guestPhone);
    await page.getByLabel("Email для чека", { exact: true }).fill(data.email);
    await page.getByRole("checkbox").check();
    const created = page.waitForResponse(response => response.url().endsWith("/api/ps-park/book") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Оплатить", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    // The production form redirects immediately. Chromium may evict the POST
    // response body on navigation, so identify this isolated booking in the DB.
    const bookings = await db.booking.findMany({ where: { resourceId: data.resourceId } });
    expect(bookings).toHaveLength(1);
    const booking = bookings[0];
    const payments = await db.payment.findMany({ where: { moduleSlug: "ps-park", subjectType: "BOOKING", subjectId: booking.id } });
    expect(payments).toHaveLength(1);
    const paymentId = payments[0].id;
    await page.getByRole("button", { name: "Approve test payment" }).click();
    await expect(page.getByRole("heading", { name: "Оплата прошла успешно!" })).toBeVisible();
    const payment = await record(paymentId);
    const replies = await Promise.all([provider.notify(payment), provider.notify(payment)]);
    expect(replies.map(reply => reply.status)).toEqual([200, 200]);
    // A delayed cancel notification cannot undo an authoritative provider success.
    expect((await provider.notify(payment, "payment.canceled")).status).toBe(200);
    await assertPaid(booking.id, paymentId);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Оплата прошла успешно!" })).toBeVisible();
    await assertPaid(booking.id, paymentId);
  });

  test("AC-cancel: canceled payment releases slot; retry and parallel requests create one replacement payment", async ({ request, page }) => {
    const data = await input();
    const first = await book(request, data);
    await page.goto(first.payment.confirmationUrl);
    await page.getByRole("button", { name: "Cancel test payment" }).click();
    await expect(page.getByRole("heading", { name: "Оплата не прошла" })).toBeVisible();
    const canceled = await record(first.payment.id);
    expect((await provider.notify(canceled, "payment.canceled")).status).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CANCELLED");
    expect(await db.financialTransaction.count({ where: { bookingId: first.id, type: "ONLINE_PAYMENT" } })).toBe(0);
    const retry = { ...data, requestId: randomUUID() };
    const results = await Promise.all([book(request, retry), book(request, retry)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.payment.count({ where: { subjectId: results[0].id } })).toBe(1);
    await page.goto(results[0].payment.confirmationUrl);
    await page.getByRole("button", { name: "Approve test payment" }).click();
    await assertPaid(results[0].id, results[0].payment.id);
  });

  test("AC-early: webhook before creation reply confirms once and stale pending reply cannot regress", async ({ request }) => {
    const data = await input();
    provider.setNextMode("early-success");
    const result = await book(request, data);
    expect(result.payment.confirmationUrl).toBe(`/payments/${result.payment.id}`);
    await assertPaid(result.id, result.payment.id);
    const payment = await record(result.payment.id);
    expect((await provider.notify(payment)).status).toBe(200);
    await assertPaid(result.id, result.payment.id);
  });

  test("AC-recovery: early webhook and all lost create replies recover URL by GET without a second charge", async ({ request, page }) => {
    const data = await input();
    provider.setNextMode("early-pending-lost-response");
    const initial = await request.post(`${app.origin}/api/ps-park/book`, { data });
    expect(initial.status()).toBe(400);
    expect((await initial.json()).error.code).toBe("PAYMENT_CREATE_PENDING");
    const booking = await db.booking.findFirstOrThrow({ where: { resourceId: data.resourceId } });
    const pending = await db.payment.findFirstOrThrow({ where: { subjectId: booking.id } });
    expect(booking.status).toBe("PENDING");
    expect(pending.providerPaymentId).not.toBeNull();
    expect(pending.confirmationUrl).toBeNull();
    const payment = await record(pending.id);
    expect(payment.postAttempts).toBe(3);
    // A notification's claimed status alone is not payment proof.
    expect(await db.financialTransaction.count({ where: { bookingId: booking.id } })).toBe(0);
    const getAttempts = payment.getAttempts;
    const recovered = await book(request, data);
    expect(recovered.payment.id).toBe(pending.id);
    expect(recovered.payment.confirmationUrl).toBe(`${provider.origin}/checkout/${payment.id}`);
    expect(payment.postAttempts).toBe(3);
    expect(payment.getAttempts).toBeGreaterThan(getAttempts);
    await page.goto(recovered.payment.confirmationUrl);
    await page.getByRole("button", { name: "Approve test payment" }).click();
    await assertPaid(booking.id, pending.id);
  });

  test("AC-late: late success credits canceled reservation once without reclaiming the occupied slot", async ({ request }) => {
    const data = await input();
    const first = await book(request, data);
    const payment = await record(first.payment.id);
    payment.status = "canceled";
    expect((await provider.notify(payment, "payment.canceled")).status).toBe(200);
    const replacement = await book(request, { ...data, requestId: randomUUID() });
    payment.status = "succeeded";
    expect((await provider.notify(payment)).status).toBe(200);
    expect((await provider.notify(payment)).status).toBe(200);
    await assertPaid(first.id, first.payment.id, "CANCELLED");
    expect((await db.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe("PENDING");
    const conflict = await request.post(`${app.origin}/api/ps-park/book`, { data: { ...data, requestId: randomUUID() } });
    expect(conflict.status()).toBe(400);
    expect((await conflict.json()).error.code).toBe("BOOKING_CONFLICT");
  });
});
