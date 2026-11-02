import type { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/yookassa/client", () => ({ isYooKassaConfigured: vi.fn(() => true) }));

import { hashDocumentBody } from "@/modules/booking/offer";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import {
  activatePSParkRelease,
  assertPSParkReleaseContext,
  rollbackPSParkRelease,
  PS_PARK_ACTIVATION_RELEASE_ID,
  PS_PARK_APPROVED_OFFER_HASH,
  type PSParkReleaseContext,
} from "../ps-park-release";

const SHA = "a".repeat(40);
const ACTIVATION_TIME = new Date("2026-11-02T12:00:00Z");
const BODY = readFileSync("content/legal/ps-park-offer/v2.md", "utf8");
const RELEASE_AUDIT_ID = `release:${PS_PARK_ACTIVATION_RELEASE_ID}`;
const CONTEXT: PSParkReleaseContext = {
  expectedSha: SHA, buildSha: SHA, nodeEnv: "production", appUrl: "https://delovoy-park.ru",
};
const db = {
  $transaction: vi.fn(), $executeRaw: vi.fn(),
  module: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  offerVersion: { findFirst: vi.fn() },
  auditLog: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
};
const client = db as unknown as PrismaClient;

function park(config: Prisma.JsonValue = { onlineBookingEnabled: false, openHour: 9, tariff: { hourly: 500 } }) {
  return { id: "test-ps-module", isActive: true, config, updatedAt: ACTIVATION_TIME };
}
function audit() {
  return {
    id: RELEASE_AUDIT_ID, userId: "system", action: "ps-park.online-booking.release",
    entity: "Module", entityId: "test-ps-module",
    createdAt: new Date("2026-11-02T12:00:00Z"),
    metadata: {
      actorType: "system-deployment", releaseId: PS_PARK_ACTIVATION_RELEASE_ID,
      offerHash: PS_PARK_APPROVED_OFFER_HASH, deploymentSha: "b".repeat(40),
      previousOnlineBookingEnabled: false,
      activationUpdatedAt: ACTIVATION_TIME.toISOString(),
    },
  };
}
function expectNoMutation() {
  expect(db.module.update).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPERADMIN_TELEGRAM_ID", "synthetic-bootstrap-telegram-id");
  vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "synthetic-webhook-secret");
  vi.stubEnv("YOOKASSA_RECEIPTS_ENABLED", "false");
  vi.mocked(isYooKassaConfigured).mockReturnValue(true);
  db.$transaction.mockImplementation((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(client));
  db.$executeRaw.mockResolvedValue(1);
  db.module.findUnique.mockResolvedValue(park());
  db.module.update.mockResolvedValue({ updatedAt: ACTIVATION_TIME });
  db.auditLog.findUnique.mockResolvedValue(null);
  db.auditLog.findFirst.mockResolvedValue(null);
  db.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; telegramId?: string } }) =>
    where.id === "system"
      ? { id: "system", role: "USER", mergedIntoUserId: null }
      : { id: "synthetic-owner", role: "SUPERADMIN", mergedIntoUserId: null });
  db.offerVersion.findFirst.mockResolvedValue({ body: BODY, contentHash: PS_PARK_APPROVED_OFFER_HASH });
});
afterEach(() => vi.unstubAllEnvs());

describe("Play Park one-time deployment activation", () => {
  it("pins the approved offer and enables atomically with the system actor and preserved settings", async () => {
    expect(hashDocumentBody(BODY)).toBe(PS_PARK_APPROVED_OFFER_HASH);
    expect(await activatePSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: true, alreadyApplied: false });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.module.update).toHaveBeenCalledWith({ where: { slug: "ps-park" }, data: { config: {
      onlineBookingEnabled: true, openHour: 9, tariff: { hourly: 500 },
      onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
    } } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: {
      id: RELEASE_AUDIT_ID, userId: "system", action: "ps-park.online-booking.release",
      entity: "Module", entityId: "test-ps-module", metadata: { ...audit().metadata, deploymentSha: SHA },
    } });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain("synthetic-owner");
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { telegramId: "synthetic-bootstrap-telegram-id" },
      select: { id: true, role: true, mergedIntoUserId: true },
    });
  });

  it("locks the PS module before reading settings or release markers", async () => {
    await activatePSParkRelease(client, CONTEXT);
    expect(db.$executeRaw.mock.calls[0][0].join("")).toBe("SELECT 1 FROM \"Module\" WHERE slug = 'ps-park' FOR UPDATE");
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.module.findUnique.mock.invocationCallOrder[0]);
    expect(db.module.findUnique.mock.invocationCallOrder[0]).toBeLessThan(db.auditLog.findUnique.mock.invocationCallOrder[0]);
    expect(db.auditLog.findUnique.mock.invocationCallOrder[0]).toBeLessThan(db.module.update.mock.invocationCallOrder[0]);
  });

  it.each([
    { nodeEnv: undefined }, { nodeEnv: "test" }, { appUrl: undefined },
    { appUrl: "https://example.test" }, { appUrl: "http://delovoy-park.ru" },
    { appUrl: "https://delovoy-park.ru.evil.test" }, { appUrl: "https://delovoy-park.ru/path" },
    { appUrl: "https://user:password@delovoy-park.ru" },
  ])("rejects non-production context before any database access: %j", async (override) => {
    await expect(activatePSParkRelease(client, { ...CONTEXT, ...override })).rejects.toThrow("PRODUCTION_CONTEXT_REQUIRED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { buildSha: undefined }, { buildSha: "b".repeat(40) }, { expectedSha: "unknown" },
    { expectedSha: "a".repeat(39), buildSha: "a".repeat(39) },
    { expectedSha: "g".repeat(40), buildSha: "g".repeat(40) },
  ])("requires the exact full deployment SHA: %j", async (override) => {
    await expect(activatePSParkRelease(client, { ...CONTEXT, ...override })).rejects.toThrow("DEPLOYMENT_SHA_MISMATCH");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts the canonical origin with a trailing slash", async () => {
    await expect(activatePSParkRelease(client, { ...CONTEXT, appUrl: "https://delovoy-park.ru/" }))
      .resolves.toMatchObject({ changed: true });
  });

  it("exposes the context guard for CLI checks without database access", () => {
    expect(() => assertPSParkReleaseContext(CONTEXT)).not.toThrow();
    expect(() => assertPSParkReleaseContext({ ...CONTEXT, nodeEnv: "test" })).toThrow("PRODUCTION_CONTEXT_REQUIRED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a missing module or malformed configuration without mutation", async () => {
    db.module.findUnique.mockResolvedValueOnce(null);
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PS_PARK_NOT_FOUND");
    db.module.findUnique.mockResolvedValueOnce(park(["unexpected-array"]));
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PS_PARK_CONFIG_INVALID");
    expectNoMutation();
  });

  it.each([null, { role: "SUPERADMIN", mergedIntoUserId: null }, { role: "USER", mergedIntoUserId: "another-user" }])(
    "requires the existing unmerged system USER: %j", async (system) => {
      db.user.findUnique.mockResolvedValueOnce(system);
      await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("SYSTEM_ACTOR_REQUIRED");
      expectNoMutation();
    },
  );

  it.each([null, { id: "owner", role: "USER", mergedIntoUserId: null },
    { id: "owner", role: "SUPERADMIN", mergedIntoUserId: "another-user" },
    { id: "system", role: "SUPERADMIN", mergedIntoUserId: null },
  ])("requires the existing active bootstrap owner: %j", async (owner) => {
    db.user.findUnique.mockResolvedValueOnce({ role: "USER", mergedIntoUserId: null }).mockResolvedValueOnce(owner);
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("BOOTSTRAP_OWNER_REQUIRED");
    expectNoMutation();
  });

  it("checks module activity, provider configuration and webhook secret before changing anything", async () => {
    db.module.findUnique.mockResolvedValueOnce({ ...park(), isActive: false });
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PAYMENTS_NOT_CONFIGURED");
    vi.mocked(isYooKassaConfigured).mockReturnValueOnce(false);
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PAYMENTS_NOT_CONFIGURED");
    vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "");
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PAYMENTS_NOT_CONFIGURED");
    expectNoMutation();
  });

  it("validates the existing receipt VAT configuration when receipts are enabled", async () => {
    vi.stubEnv("YOOKASSA_RECEIPTS_ENABLED", "true");
    vi.stubEnv("YOOKASSA_VAT_CODE", "999");
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow();
    expectNoMutation();
  });

  it.each([null, { body: BODY, contentHash: "unapproved" },
    { body: "different document", contentHash: PS_PARK_APPROVED_OFFER_HASH },
  ])("requires the approved published document and intact body: %j", async (offer) => {
    db.offerVersion.findFirst.mockResolvedValue(offer);
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PUBLISHED_OFFER_MISMATCH");
    expect(db.offerVersion.findFirst).toHaveBeenCalledWith({ where: {
      documentKey: "ps-park-offer", isCurrent: true,
      publishedAt: { lte: expect.any(Date) }, effectiveAt: { lte: expect.any(Date) },
    } });
    expectNoMutation();
  });

  it.each([false, true])("keeps the current flag %s when only the config marker survives", async (enabled) => {
    db.module.findUnique.mockResolvedValue({ ...park({
      onlineBookingEnabled: enabled, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
    }), isActive: false });
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    db.offerVersion.findFirst.mockResolvedValue(null);
    expect(await activatePSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: enabled, changed: false, alreadyApplied: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.offerVersion.findFirst).not.toHaveBeenCalled();
    expect(isYooKassaConfigured).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("preserves manual OFF after a full config replacement using the audit marker from a previous build", async () => {
    db.auditLog.findUnique.mockResolvedValue(audit());
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    expect(await activatePSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: false, changed: false, alreadyApplied: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.offerVersion.findFirst).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("consumes the release once when online booking was already enabled", async () => {
    db.module.findUnique.mockResolvedValue(park({ onlineBookingEnabled: true }));
    expect(await activatePSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: true, alreadyApplied: false });
    expect(db.auditLog.create).toHaveBeenCalledOnce();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ previousOnlineBookingEnabled: true }),
    }) });
  });

  it("fails closed on an unknown config marker or colliding audit ID", async () => {
    db.module.findUnique.mockResolvedValueOnce(park({ onlineBookingActivationRelease: "another-release" }));
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PS_PARK_RELEASE_MARKER_CONFLICT");
    db.auditLog.findUnique.mockResolvedValueOnce({ ...audit(), metadata: { ...audit().metadata, offerHash: "different-offer" } });
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PS_PARK_RELEASE_MARKER_CONFLICT");
    expectNoMutation();
  });

  it("does not let a matching config marker conceal an invalid existing audit marker", async () => {
    db.module.findUnique.mockResolvedValue(park({
      onlineBookingEnabled: false, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
    }));
    db.auditLog.findUnique.mockResolvedValue({ ...audit(), action: "unrelated-action" });
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("PS_PARK_RELEASE_MARKER_CONFLICT");
    expectNoMutation();
  });

  it("preserves OFF with a valid audit even when the config marker was replaced", async () => {
    db.module.findUnique.mockResolvedValue(park({ onlineBookingEnabled: false, onlineBookingActivationRelease: "later-config" }));
    db.auditLog.findUnique.mockResolvedValue(audit());
    expect(await activatePSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: false, changed: false, alreadyApplied: true });
    expectNoMutation();
  });

  it("propagates audit failure from inside the same database transaction", async () => {
    db.auditLog.create.mockRejectedValue(new Error("synthetic-audit-failure"));
    await expect(activatePSParkRelease(client, CONTEXT)).rejects.toThrow("synthetic-audit-failure");
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.module.update).toHaveBeenCalledOnce();
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });
});

describe("Play Park failed first activation verification rollback", () => {
  beforeEach(() => {
    db.module.findUnique.mockResolvedValue(park({
      onlineBookingEnabled: true, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
      openHour: 9, tariff: { hourly: 500 },
    }));
    db.auditLog.findUnique.mockResolvedValue({ ...audit(), metadata: { ...audit().metadata, deploymentSha: SHA } });
  });

  it("turns off only this build's first activation and retains both durable markers", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    db.offerVersion.findFirst.mockResolvedValue(null);
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: false, changed: true });
    expect(db.module.update).toHaveBeenCalledWith({ where: { slug: "ps-park" }, data: { config: {
      onlineBookingEnabled: false, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
      openHour: 9, tariff: { hourly: 500 },
    } } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: {
      id: `${RELEASE_AUDIT_ID}:rollback:${SHA}`, userId: "system",
      action: "ps-park.online-booking.release.rollback", entity: "Module", entityId: "test-ps-module",
      metadata: {
        actorType: "system-deployment", releaseId: PS_PARK_ACTIVATION_RELEASE_ID,
        offerHash: PS_PARK_APPROVED_OFFER_HASH, deploymentSha: SHA,
      },
    } });
    expect(db.offerVersion.findFirst).not.toHaveBeenCalled();
    expect(isYooKassaConfigured).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("preserves an operator decision including an event in the activation's millisecond", async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: "synthetic-manual-decision" });
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: false });
    expect(db.auditLog.findFirst).toHaveBeenCalledWith({ where: {
      entity: "Module", entityId: "test-ps-module",
      action: { in: ["ps-park.online-booking", "module.config.update"] },
      createdAt: { gte: audit().createdAt },
    }, select: { id: true } });
    expectNoMutation();
  });

  it("preserves a newer Module update before its separate architect audit has been written", async () => {
    db.module.findUnique.mockResolvedValue({ ...park({
      onlineBookingEnabled: true, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID,
    }), updatedAt: new Date(ACTIVATION_TIME.getTime() + 1) });
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: false });
    expect(db.auditLog.findFirst).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("does not disable booking that was already enabled before this release", async () => {
    db.auditLog.findUnique.mockResolvedValue({ ...audit(), metadata: {
      ...audit().metadata, deploymentSha: SHA, previousOnlineBookingEnabled: true,
    } });
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: false });
    expectNoMutation();
  });

  it("does not roll back another build's activation or an absent/corrupt audit marker", async () => {
    db.auditLog.findUnique.mockResolvedValueOnce(audit()).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...audit(), action: "unrelated", metadata: { ...audit().metadata, deploymentSha: SHA } });
    for (let i = 0; i < 3; i++) {
      expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: false });
    }
    expectNoMutation();
  });

  it("preserves a replaced config marker and makes repeated OFF a no-op", async () => {
    db.module.findUnique.mockResolvedValueOnce(park({ onlineBookingEnabled: true }))
      .mockResolvedValueOnce(park({ onlineBookingEnabled: false, onlineBookingActivationRelease: PS_PARK_ACTIVATION_RELEASE_ID }));
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: true, changed: false });
    expect(await rollbackPSParkRelease(client, CONTEXT)).toEqual({ onlineBookingEnabled: false, changed: false });
    expectNoMutation();
  });

  it("uses the same environment and image guards before entering the database", async () => {
    await expect(rollbackPSParkRelease(client, { ...CONTEXT, nodeEnv: "test" })).rejects.toThrow("PRODUCTION_CONTEXT_REQUIRED");
    await expect(rollbackPSParkRelease(client, { ...CONTEXT, buildSha: undefined })).rejects.toThrow("DEPLOYMENT_SHA_MISMATCH");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("propagates a rollback audit failure through its transaction", async () => {
    db.auditLog.create.mockRejectedValue(new Error("synthetic-audit-failure"));
    await expect(rollbackPSParkRelease(client, CONTEXT)).rejects.toThrow("synthetic-audit-failure");
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
});
