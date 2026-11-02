import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type ProviderStatus = "pending" | "succeeded" | "canceled";
export type ProviderMode = "normal" | "early-success" | "early-pending-lost-response";
interface CreateRequest {
  amount: { value: string; currency: string };
  confirmation: { return_url: string };
  metadata: Record<string, unknown>;
}
export interface ProviderRecord {
  id: string;
  status: ProviderStatus;
  request: CreateRequest;
  requestJSON: string;
  mode: ProviderMode;
  postAttempts: number;
  getAttempts: number;
}

async function body(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of request) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts).toString("utf8");
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** An in-memory provider only. Webhooks hit the real Next route and real Prisma DB. */
export async function startPSParkProvider(options: { token: string; webhookSecret: string }) {
  const records = new Map<string, ProviderRecord>();
  const keys = new Map<string, string>();
  let origin = "";
  let appOrigin = "";
  let nextMode: ProviderMode = "normal";

  const payload = (record: ProviderRecord, status = record.status) => ({
    id: record.id, status, paid: status === "succeeded", test: true,
    amount: record.request.amount, metadata: record.request.metadata,
    created_at: "2026-01-01T00:00:00.000Z",
    confirmation: { type: "redirect", confirmation_url: `${origin}/checkout/${record.id}` },
    ...(status === "canceled" ? { cancellation_details: { party: "user", reason: "canceled_by_user" } } : {}),
  });

  async function notify(record: ProviderRecord, event = "payment.succeeded", secret = options.webhookSecret) {
    if (!appOrigin) throw new Error("Test application origin not configured");
    return fetch(`${appOrigin}/api/payments/yookassa/webhook/${secret}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "notification", event, object: { id: record.id, metadata: record.request.metadata } }),
      redirect: "error",
    });
  }

  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path.startsWith("/v3/")) {
        if (request.headers["x-e2e-provider-token"] !== options.token ||
            request.headers.authorization !== `Basic ${Buffer.from("e2e-synthetic-shop:e2e-synthetic-key").toString("base64")}`) {
          json(response, 403, { error: "Synthetic provider authentication required" }); return;
        }
        if (request.method === "POST" && path === "/v3/payments") {
          const key = request.headers["idempotence-key"];
          if (typeof key !== "string") { json(response, 400, { error: "Missing idempotency key" }); return; }
          const requestJSON = await body(request);
          let record = records.get(keys.get(key) ?? "");
          if (record && record.requestJSON !== requestJSON) { json(response, 409, { error: "Changed idempotent request" }); return; }
          if (!record) {
            const data = JSON.parse(requestJSON) as CreateRequest;
            if (new URL(data.confirmation.return_url).origin !== appOrigin) {
              json(response, 400, { error: "Return URL must target the isolated application" }); return;
            }
            record = { id: randomUUID(), status: "pending", request: data, requestJSON, mode: nextMode, postAttempts: 0, getAttempts: 0 };
            nextMode = "normal";
            records.set(record.id, record); keys.set(key, record.id);
          }
          record.postAttempts++;
          if (record.postAttempts === 1 && record.mode !== "normal") {
            if (record.mode === "early-success") record.status = "succeeded";
            const webhook = await notify(record);
            if (!webhook.ok) throw new Error(`Early webhook failed: ${webhook.status}`);
          }
          if (record.mode === "early-pending-lost-response") { response.destroy(); return; }
          // A stale creation reply must not regress an already accepted webhook.
          json(response, 200, payload(record, record.mode === "early-success" ? "pending" : record.status)); return;
        }
        const record = records.get(path.replace(/^\/v3\/payments\//, ""));
        if (request.method === "GET" && record) { record.getAttempts++; json(response, 200, payload(record)); return; }
        json(response, 404, { error: "Unsupported fixture operation (including refunds)" }); return;
      }
      const record = records.get(path.replace(/^\/checkout\//, ""));
      if (!record) { json(response, 404, { error: "Unknown fixture payment" }); return; }
      if (request.method === "POST") {
        const action = new URLSearchParams(await body(request)).get("action");
        record.status = action === "approve" ? "succeeded" : "canceled";
        const webhook = await notify(record, record.status === "succeeded" ? "payment.succeeded" : "payment.canceled");
        if (!webhook.ok) throw new Error(`Checkout webhook failed: ${webhook.status}`);
        response.writeHead(303, { location: record.request.confirmation.return_url }); response.end(); return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><h1>Local test provider: no real payment</h1><form method="post"><button name="action" value="approve">Approve test payment</button><button name="action" value="cancel">Cancel test payment</button></form>');
    })().catch((error: unknown) => {
      json(response, 500, { error: error instanceof Error ? error.message : "Fixture error" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, records, notify,
    setAppOrigin(value: string) {
      const url = new URL(value);
      if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Loopback application required");
      appOrigin = url.origin;
    },
    setNextMode(mode: ProviderMode) { nextMode = mode; },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
