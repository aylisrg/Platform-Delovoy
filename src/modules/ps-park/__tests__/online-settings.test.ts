import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: vi.fn() }, module: { findUnique: vi.fn(), update: vi.fn() },
  offerVersion: { findFirst: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn(),
} }));
vi.mock("@/lib/yookassa/client", () => ({ isYooKassaConfigured: vi.fn().mockReturnValue(true) }));
import { prisma } from "@/lib/db";
import { hashDocumentBody } from "@/modules/booking/offer";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { setOnlineBookingEnabled } from "../online-settings";

const body = "Only a test fixture, never a published offer";
const hash = hashDocumentBody(body);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "test-only");
  vi.stubEnv("YOOKASSA_RECEIPTS_ENABLED", "false");
  vi.mocked(isYooKassaConfigured).mockReturnValue(true);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN", mergedIntoUserId: null } as never);
  vi.mocked(prisma.module.findUnique).mockResolvedValue({ id: "park", isActive: true, config: { openHour: 9, pricePerHour: 500 } } as never);
  vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue({ body, contentHash: hash } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("Play Park release switch", () => {
  it("preserves configuration and records actor and accepted offer hash", async () => {
    expect(await setOnlineBookingEnabled("owner", true, hash)).toEqual({ onlineBookingEnabled: true, changed: true });
    expect(prisma.module.update).toHaveBeenCalledWith({ where: { slug: "ps-park" }, data: { config: { openHour: 9, pricePerHour: 500, onlineBookingEnabled: true } } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "owner", metadata: { onlineBookingEnabled: true, offerContentHash: hash } }) }));
  });
  it("requires an existing active superadmin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    await expect(setOnlineBookingEnabled("manager", true, hash)).rejects.toThrow("SUPERADMIN_REQUIRED");
    expect(prisma.module.update).not.toHaveBeenCalled();
  });
  it("requires published offer matching both file and stored content", async () => {
    vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue({ body: "changed", contentHash: hash } as never);
    await expect(setOnlineBookingEnabled("owner", true, hash)).rejects.toThrow("PUBLISHED_OFFER_MISMATCH");
    vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue(null);
    await expect(setOnlineBookingEnabled("owner", true, hash)).rejects.toThrow("PUBLISHED_OFFER_MISMATCH");
    expect(prisma.module.update).not.toHaveBeenCalled();
  });
  it("cannot enable without existing provider configuration and webhook secret", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    await expect(setOnlineBookingEnabled("owner", true, hash)).rejects.toThrow("PAYMENTS_NOT_CONFIGURED");
    vi.mocked(isYooKassaConfigured).mockReturnValue(true); vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "");
    await expect(setOnlineBookingEnabled("owner", true, hash)).rejects.toThrow("PAYMENTS_NOT_CONFIGURED");
    expect(prisma.module.update).not.toHaveBeenCalled();
  });
  it("rollback remains available if offer/provider become unavailable", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue(null);
    expect(await setOnlineBookingEnabled("owner", false)).toEqual({ onlineBookingEnabled: false, changed: true });
    expect(prisma.offerVersion.findFirst).not.toHaveBeenCalled();
  });
  it("repeated rollback does not rewrite configuration or duplicate audit", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: { onlineBookingEnabled: false } } as never);
    expect(await setOnlineBookingEnabled("owner", false)).toEqual({ onlineBookingEnabled: false, changed: false });
    expect(prisma.module.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
