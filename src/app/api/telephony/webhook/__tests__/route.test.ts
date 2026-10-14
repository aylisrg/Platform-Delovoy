import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

vi.mock("@/lib/db", () => ({
  prisma: {
    callLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAudit: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { POST } from "../route";

const db = prisma as unknown as {
  callLog: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  booking: { findFirst: ReturnType<typeof vi.fn> };
};

const SECRET = "test-webhook-secret";
// Anonymized: fictitious numbers from the reserved 7-000 range, no real customers.
const V2_INCOMING = {
  notification_name: "incoming_call",
  call_session_id: 1234567890,
  notification_time: "2026-10-13 12:00:00.000",
  virtual_phone_number: "70000000001",
  direction: "in",
  called_phone_number: "70000000001",
  calling_phone_number: "70000000099",
  contact_phone_number: "70000000099",
  call_source: "va",
};
const V2_FINISHED = {
  notification_name: "finished_call",
  call_session_id: 1234567891,
  direction: "in",
  calling_phone_number: "70000000098",
  contact_phone_number: "70000000098",
  employee_phone_number: "70000000002",
  talk_time_duration: 42,
  total_time_duration: 55,
  wait_time_duration: 13,
  record_file_links: [],
};

function req(body: unknown, opts: { token?: string; sig?: string } = {}) {
  const url = `http://localhost/api/telephony/webhook${opts.token ? `?token=${opts.token}` : ""}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sig) headers["X-Novofon-Signature"] = opts.sig;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOVOFON_WEBHOOK_TOKEN = SECRET;
  delete process.env.NOVOFON_WEBHOOK_SECRET;
  delete process.env.NOVOFON_WEBHOOK_IPS;
  db.callLog.findFirst.mockResolvedValue(null);
  db.callLog.create.mockResolvedValue({ id: "cl1" });
  db.booking.findFirst.mockResolvedValue(null);
});

describe("POST /api/telephony/webhook (Novofon 2.0)", () => {
  it("accepts incoming_call notification with ?token= and writes CallLog", async () => {
    const res = await POST(req(V2_INCOMING, { token: SECRET }));
    expect(res.status).toBe(200);
    expect(db.callLog.create).toHaveBeenCalledTimes(1);
    const data = db.callLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      direction: "INBOUND",
      status: "RINGING",
      clientPhone: "70000000099",
      externalCallId: "1234567890",
    });
  });

  it("finished_call with talk time writes COMPLETED with duration", async () => {
    const res = await POST(req(V2_FINISHED, { token: SECRET }));
    expect(res.status).toBe(200);
    const data = db.callLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "COMPLETED", duration: 42, externalCallId: "1234567891" });
  });

  it("finished_call updates existing CallLog by call_session_id", async () => {
    db.callLog.findFirst.mockResolvedValue({ id: "cl9", status: "RINGING", duration: null, recordingUrl: null });
    const res = await POST(req(V2_FINISHED, { token: SECRET }));
    expect(res.status).toBe(200);
    expect(db.callLog.findFirst).toHaveBeenCalledWith({ where: { externalCallId: "1234567891" } });
    expect(db.callLog.update.mock.calls[0][0].data).toMatchObject({ status: "COMPLETED", duration: 42 });
  });

  it("rejects wrong token with 401 and writes nothing", async () => {
    const res = await POST(req(V2_INCOMING, { token: "wrong-token" }));
    expect(res.status).toBe(401);
    expect(db.callLog.create).not.toHaveBeenCalled();
  });

  it("rejects missing auth with 401", async () => {
    const res = await POST(req(V2_INCOMING));
    expect(res.status).toBe(401);
    expect(db.callLog.create).not.toHaveBeenCalled();
  });

  it("rejects wrong HMAC signature with 401", async () => {
    const res = await POST(req(V2_INCOMING, { sig: "sha256=" + "0".repeat(64) }));
    expect(res.status).toBe(401);
  });

  it("still accepts legacy HMAC-signed payload", async () => {
    const legacy = { event: "call.ringing", call_id: "legacy-1", direction: "inbound", caller: "70000000097" };
    const sig = createHmac("sha256", SECRET).update(JSON.stringify(legacy)).digest("hex");
    const res = await POST(req(legacy, { sig }));
    expect(res.status).toBe(200);
    expect(db.callLog.create).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when secret not configured", async () => {
    delete process.env.NOVOFON_WEBHOOK_TOKEN;
    const res = await POST(req(V2_INCOMING, { token: SECRET }));
    expect(res.status).toBe(503);
  });

  it("falls back to NOVOFON_WEBHOOK_SECRET when NOVOFON_WEBHOOK_TOKEN is unset", async () => {
    delete process.env.NOVOFON_WEBHOOK_TOKEN;
    process.env.NOVOFON_WEBHOOK_SECRET = SECRET;
    const ok = await POST(req(V2_INCOMING, { token: SECRET }));
    expect(ok.status).toBe(200);
    const bad = await POST(req(V2_INCOMING, { token: "wrong-token" }));
    expect(bad.status).toBe(401);
  });

  it("prefers NOVOFON_WEBHOOK_TOKEN over NOVOFON_WEBHOOK_SECRET", async () => {
    process.env.NOVOFON_WEBHOOK_SECRET = "other-secret";
    expect((await POST(req(V2_INCOMING, { token: SECRET }))).status).toBe(200);
    expect((await POST(req(V2_INCOMING, { token: "other-secret" }))).status).toBe(401);
  });

  it("returns 503 when neither token nor secret is configured", async () => {
    delete process.env.NOVOFON_WEBHOOK_TOKEN;
    delete process.env.NOVOFON_WEBHOOK_SECRET;
    expect((await POST(req(V2_INCOMING, { token: SECRET }))).status).toBe(503);
  });

  it("rejects IP not in NOVOFON_WEBHOOK_IPS with 403", async () => {
    process.env.NOVOFON_WEBHOOK_IPS = "192.0.2.10";
    const r = req(V2_INCOMING, { token: SECRET });
    r.headers.set("x-real-ip", "198.51.100.7");
    const res = await POST(r);
    expect(res.status).toBe(403);
    expect(db.callLog.create).not.toHaveBeenCalled();
  });

  it("without X-Real-IP rejects spoofed allowlisted first XFF hop with 403", async () => {
    process.env.NOVOFON_WEBHOOK_IPS = "192.0.2.10";
    const r = req(V2_INCOMING, { token: SECRET });
    r.headers.set("x-forwarded-for", "192.0.2.10, 203.0.113.9");
    const res = await POST(r);
    expect(res.status).toBe(403);
    expect(db.callLog.create).not.toHaveBeenCalled();
  });

  it("without X-Real-IP accepts allowlisted last XFF hop", async () => {
    process.env.NOVOFON_WEBHOOK_IPS = "192.0.2.10";
    const r = req(V2_INCOMING, { token: SECRET });
    r.headers.set("x-forwarded-for", "203.0.113.9, 192.0.2.10");
    const res = await POST(r);
    expect(res.status).toBe(200);
  });

  it("returns 400 for unknown payload", async () => {
    const res = await POST(req({ foo: 1 }, { token: SECRET }));
    expect(res.status).toBe(400);
  });
});
