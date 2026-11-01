import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { audience, chooseTransport, deliveryId, recipientAddress, runAnnouncement, type AudienceUser } from "../ops-telephony-announcement";

const now = new Date("2026-10-24T12:00:00Z");

describe("Telegram route preflight", () => {
  const identity = { ok: true, result: { id: 1, username: "DelovoyPark_bot" } };
  it("falls back using getMe before sending, then never retries sendMessage", async () => {
    const configured = vi.fn().mockRejectedValue(new Error("proxy unavailable"));
    const direct = vi.fn().mockResolvedValue(identity);
    const transport = await chooseTransport(configured, direct, true);
    expect(transport.name).toBe("direct");
    expect(configured.mock.calls).toEqual([["getMe", {}]]);
    expect(direct.mock.calls).toEqual([["getMe", {}]]);
    direct.mockRejectedValue(new Error("send timed out"));
    await expect(transport.call("sendMessage", { chat_id: "123" })).rejects.toThrow("send timed out");
    expect(direct).toHaveBeenCalledTimes(2);
    expect(configured).toHaveBeenCalledTimes(1);
  });
  it("uses a working configured route and caches its identity", async () => {
    const configured = vi.fn().mockResolvedValue(identity);
    const direct = vi.fn();
    const transport = await chooseTransport(configured, direct, true);
    await transport.call("getMe", {});
    expect(transport.name).toBe("configured");
    expect(configured).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });
  it("fails before writes or sends if every read-only probe fails", async () => {
    const unavailable = vi.fn().mockResolvedValue({ ok: false });
    await expect(chooseTransport(unavailable, unavailable, true)).rejects.toThrow("TELEGRAM_UNREACHABLE");
    expect(unavailable.mock.calls).toEqual([["getMe", {}], ["getMe", {}]]);
  });
  it("does not mask an unexpected bot by changing routes", async () => {
    const configured = vi.fn().mockResolvedValue({ ok: true, result: { id: 1, username: "Other_bot" } });
    const direct = vi.fn();
    await expect(chooseTransport(configured, direct, true)).rejects.toThrow("UNEXPECTED_BOT");
    expect(direct).not.toHaveBeenCalled();
  });
});
function user(overrides: Partial<AudienceUser> = {}): AudienceUser {
  return { id: "admin", role: "ADMIN", mergedIntoUserId: null, telegramId: "12345", notificationChannels: [], notificationGlobalPref: null, notificationEventPrefs: [], ...overrides };
}
function harness(users = [user()]) {
  const findMany = vi.fn().mockResolvedValue(users);
  const findUnique = vi.fn().mockResolvedValue(users[0]);
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const logs = vi.fn().mockResolvedValue([]);
  const audit = vi.fn().mockResolvedValue({});
  const db = { user: { findMany, findUnique }, notificationLog: { findMany: logs, create, update }, auditLog: { create: audit }, $transaction: vi.fn() };
  db.$transaction.mockImplementation((operation: unknown) => typeof operation === "function" ? operation(db) : Promise.all(operation as Promise<unknown>[]));
  const call = vi.fn().mockImplementation(async (method: string, payload: Record<string, unknown>) => method === "getMe"
    ? { ok: true, result: { id: 1, username: "DelovoyPark_bot" } }
    : { ok: true, result: { message_id: 42, chat: { id: Number(payload.chat_id), type: "private" } } });
  const run = (options: { mode: "preview" | "send"; expectedCount?: number; expectedDigest?: string }) => runAnnouncement(db as unknown as PrismaClient, call, { ...options, runId: "1" }, now);
  return { db, findMany, findUnique, create, update, logs, audit, call, run };
}

describe("fixed telephony announcement audience", () => {
  it("limits audience to unmerged ADMIN/SUPERADMIN and deduplicates private chats", () => {
    const result = audience([
      user(), user({ id: "owner", role: "SUPERADMIN", telegramId: "67890" }),
      user({ id: "duplicate" }), user({ id: "client", role: "USER" }),
      user({ id: "manager", role: "MANAGER" }), user({ id: "merged", mergedIntoUserId: "x" }),
      user({ id: "group", telegramId: "-100123" }), user({ id: "none", telegramId: null }),
    ], now);
    expect(result.map(item => item.userId)).toEqual(["admin", "owner"]);
  });
  it("uses verified active channels but never bypasses an explicit inactive channel", () => {
    const channel = { address: "67890", isActive: true, verifiedAt: now } as AudienceUser["notificationChannels"][number];
    expect(recipientAddress(user({ notificationChannels: [channel] }), now)).toBe("67890");
    expect(recipientAddress(user({ notificationChannels: [{ ...channel, isActive: false }] }), now)).toBeNull();
    expect(recipientAddress(user({ notificationChannels: [{ ...channel, verifiedAt: null }] }), now)).toBeNull();
  });
  it("honors release opt-out, DND and quiet hours", () => {
    const pref = { enabled: false } as AudienceUser["notificationEventPrefs"][number];
    expect(recipientAddress(user({ notificationEventPrefs: [pref] }), now)).toBeNull();
    const global = { dndUntil: new Date("2027-01-01"), timezone: "Europe/Moscow" } as NonNullable<AudienceUser["notificationGlobalPref"]>;
    expect(recipientAddress(user({ notificationGlobalPref: global }), now)).toBeNull();
    expect(recipientAddress(user({ notificationGlobalPref: { ...global, dndUntil: null, quietHoursFrom: "14:00", quietHoursTo: "16:00" } }), now)).toBeNull();
  });
});

describe("one-off delivery", () => {
  it("preview reads only and returns no recipient identifiers", async () => {
    const h = harness();
    const result = await h.run({ mode: "preview" });
    expect(result.pending).toBe(1);
    expect(JSON.stringify(result)).not.toContain("12345");
    expect(h.call).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: { in: ["ADMIN", "SUPERADMIN"] }, mergedIntoUserId: null } }));
  });
  it("fails closed when the preview audience has changed", async () => {
    const h = harness();
    await expect(h.run({ mode: "send", expectedCount: 2, expectedDigest: "wrong" })).rejects.toThrow("AUDIENCE_CHANGED");
    expect(h.call).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
  it("claims before sending once and persists confirmed delivery and audit", async () => {
    const h = harness();
    const p = await h.run({ mode: "preview" });
    const result = await h.run({ mode: "send", expectedCount: p.pending, expectedDigest: p.digest });
    expect(result.sent).toBe(1);
    expect(h.call.mock.calls.map(args => args[0])).toEqual(["getMe", "sendMessage"]);
    expect(h.create.mock.invocationCallOrder[0]).toBeLessThan(h.call.mock.invocationCallOrder[1]);
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", error: null }) }));
    expect(h.audit).toHaveBeenCalledTimes(2);
  });
  it("rechecks role after preview before claiming", async () => {
    const h = harness();
    const p = await h.run({ mode: "preview" });
    h.findUnique.mockResolvedValue(user({ role: "USER" }));
    const result = await h.run({ mode: "send", expectedCount: p.pending, expectedDigest: p.digest });
    expect(result.skipped).toBe(1);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.call).toHaveBeenCalledTimes(1);
  });
  it("never resends sent, pending or failed claims", async () => {
    for (const status of ["SENT", "PENDING", "FAILED"]) {
      const h = harness();
      h.logs.mockResolvedValue([{ id: deliveryId("12345"), status }]);
      const p = await h.run({ mode: "preview" });
      expect(p.pending).toBe(0);
      await h.run({ mode: "send", expectedCount: 0, expectedDigest: p.digest });
      expect(h.call).toHaveBeenCalledTimes(1);
      expect(h.create).not.toHaveBeenCalled();
    }
  });
  it("concurrent claim conflict does not send", async () => {
    const h = harness();
    const p = await h.run({ mode: "preview" });
    h.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }));
    const result = await h.run({ mode: "send", expectedCount: p.pending, expectedDigest: p.digest });
    expect(result.skipped).toBe(1);
    expect(h.call).toHaveBeenCalledTimes(1);
  });
  it("ambiguous timeout is recorded without retry", async () => {
    const h = harness();
    const p = await h.run({ mode: "preview" });
    h.call.mockImplementation(async (method: string) => {
      if (method === "getMe") return { ok: true, result: { id: 1, username: "DelovoyPark_bot" } };
      throw new Error("timeout");
    });
    const result = await h.run({ mode: "send", expectedCount: p.pending, expectedDigest: p.digest });
    expect(result.failed).toBe(1);
    expect(h.call).toHaveBeenCalledTimes(2);
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "DELIVERY_UNCONFIRMED" }) }));
  });
  it("rejects a different bot before any claim or delivery", async () => {
    const h = harness();
    const p = await h.run({ mode: "preview" });
    h.call.mockResolvedValue({ ok: true, result: { id: 1, username: "Other_bot" } });
    await expect(h.run({ mode: "send", expectedCount: p.pending, expectedDigest: p.digest })).rejects.toThrow("UNEXPECTED_BOT");
    expect(h.create).not.toHaveBeenCalled();
  });
});
