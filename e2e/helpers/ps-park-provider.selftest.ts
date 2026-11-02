// Local verification of the test harness only; this does not stand in for the paid DB E2E.
// Run: node --import tsx --test e2e/helpers/ps-park-provider.selftest.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { startPSParkProvider } from "./ps-park-provider";
import { paidE2EEnvironment } from "./ps-park-test-server";

const headers = {
  "content-type": "application/json", "x-e2e-provider-token": "synthetic-token",
  authorization: `Basic ${Buffer.from("e2e-synthetic-shop:e2e-synthetic-key").toString("base64")}`,
  "idempotence-key": "fixture-key",
};

test("harness refuses non-CI and nonlocal DB configuration before mutations", () => {
  const valid = {
    DEV_OVERLAY: "1", AUTH_SECRET: "e2e-ci-secret-not-for-prod-use",
    DATABASE_URL: "postgresql://delovoy:delovoy_secret@localhost:5432/delovoy_park",
    REDIS_URL: "redis://localhost:6379",
  };
  assert.ok(paidE2EEnvironment(valid));
  assert.throws(() => paidE2EEnvironment({ ...valid, AUTH_SECRET: "other" }));
  assert.throws(() => paidE2EEnvironment({ ...valid, DEV_OVERLAY: "0" }));
  assert.throws(() => paidE2EEnvironment({ ...valid, DATABASE_URL: "postgresql://delovoy:delovoy_secret@production.invalid:5432/delovoy_park" }));
  assert.throws(() => paidE2EEnvironment({ ...valid, DATABASE_URL: "postgresql://other:other@localhost:5432/delovoy_park" }));
});

test("preload redirects only YooKassa into loopback and rejects external requests without I/O", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const context = {
    URL, Request, Headers,
    process: { env: {
      PS_PARK_E2E_ONLY: "local-provider-fixture", PS_PARK_E2E_PROVIDER_ORIGIN: "http://127.0.0.1:9998",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:9999", PS_PARK_E2E_PROVIDER_TOKEN: "synthetic-token",
      YOOKASSA_SHOP_ID: "e2e-synthetic-shop", YOOKASSA_SECRET_KEY: "e2e-synthetic-key",
    } },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : String(input), init });
      return new Response("{}", { status: 200 });
    },
  };
  const source = readFileSync(resolve("e2e/helpers/ps-park-payment-preload.js"), "utf8");
  runInNewContext(source, context);
  await context.fetch("https://api.yookassa.ru/v3/payments", { method: "POST", body: "{}", headers: { authorization: "synthetic" } });
  assert.equal(calls[0].url, "http://127.0.0.1:9998/v3/payments");
  assert.equal(new Headers(calls[0].init?.headers).get("x-e2e-provider-token"), "synthetic-token");
  assert.equal(calls[0].init?.redirect, "error");
  for (const url of ["https://api.yookassa.ru/other", "https://example.invalid", "http://127.0.0.1:8888", "https://api.yookassa.ru.attacker.invalid/v3/payments"]) {
    await assert.rejects(context.fetch(url), /blocked external fetch/);
  }
  assert.equal(calls.length, 1);
  assert.throws(() => runInNewContext(source, { ...context, process: { env: {} } }), /synthetic configuration/);
});

async function harness() {
  const notifications: unknown[] = [];
  const app = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    notifications.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" }); response.end("{}");
  });
  await new Promise<void>(resolve => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const appOrigin = `http://127.0.0.1:${address.port}`;
  const provider = await startPSParkProvider({ token: "synthetic-token", webhookSecret: "synthetic-secret" });
  provider.setAppOrigin(appOrigin);
  const request = { amount: { value: "1000.00", currency: "RUB" }, confirmation: { return_url: `${appOrigin}/payments/local-id` }, metadata: { paymentId: "local-id" } };
  return {
    provider, notifications, request, appOrigin,
    create: (data = request) => fetch(`${provider.origin}/v3/payments`, { method: "POST", headers, body: JSON.stringify(data) }),
    async close() { await provider.close(); app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())); },
  };
}

test("provider enforces auth/return URL/idempotency and supports local browser success", async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.provider.origin}/v3/payments`, { method: "POST" })).status, 403);
    assert.equal((await h.create({ ...h.request, confirmation: { return_url: "https://external.invalid" } })).status, 400);
    const first = await (await h.create()).json() as { id: string; confirmation: { confirmation_url: string } };
    const again = await (await h.create()).json() as { id: string };
    assert.equal(first.id, again.id);
    assert.equal(h.provider.records.size, 1);
    assert.equal((await h.create({ ...h.request, amount: { value: "1.00", currency: "RUB" } })).status, 409);
    const paid = await fetch(first.confirmation.confirmation_url, { method: "POST", body: "action=approve", redirect: "manual" });
    assert.equal(paid.status, 303);
    assert.equal(paid.headers.get("location"), `${h.appOrigin}/payments/local-id`);
    assert.equal(h.provider.records.get(first.id)?.status, "succeeded");
    assert.equal(h.notifications.length, 1);
    assert.equal((await fetch(`${h.provider.origin}/v3/refunds`, { method: "POST", headers })).status, 404);
  } finally { await h.close(); }
});

test("provider issues early webhook, drops all idempotent create replies, retains recoverable GET", async () => {
  const h = await harness();
  try {
    h.provider.setNextMode("early-pending-lost-response");
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(h.create(), /fetch failed/);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.provider.records.size, 1);
    const record = [...h.provider.records.values()][0];
    assert.equal(record.postAttempts, 3);
    const response = await fetch(`${h.provider.origin}/v3/payments/${record.id}`, { headers });
    const recovered = await response.json() as { status: string; confirmation: { confirmation_url: string } };
    assert.equal(recovered.status, "pending");
    assert.equal(recovered.confirmation.confirmation_url, `${h.provider.origin}/checkout/${record.id}`);
    assert.equal(record.getAttempts, 1);
  } finally { await h.close(); }
});

test("provider early-success mode sends webhook before returning stale pending create response", async () => {
  const h = await harness();
  try {
    h.provider.setNextMode("early-success");
    const response = await (await h.create()).json() as { id: string; status: string };
    assert.equal(h.notifications.length, 1);
    assert.equal(response.status, "pending");
    assert.equal(h.provider.records.get(response.id)?.status, "succeeded");
  } finally { await h.close(); }
});
