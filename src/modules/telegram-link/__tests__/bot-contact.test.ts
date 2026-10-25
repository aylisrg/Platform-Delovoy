import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    telegramBotContact: { findMany: vi.fn(), aggregate: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  computeBotStatus,
  getBotContacts,
  getBotTrackingSince,
  isBotUnreachable,
  recordBotBlocked,
  recordBotContact,
  recordDeliveryProof,
  resetBotTrackingSinceCache,
  toBotStatusDto,
} from "../bot-contact";

const d = (iso: string) => new Date(iso);
const empty = { startedAt: null, startedBackfill: false, lastContactAt: null, lastDeliveryOkAt: null, blockedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetBotTrackingSinceCache();
});

describe("computeBotStatus (AC-E1.1, four states)", () => {
  it("no Telegram → NOT_LINKED", () => {
    expect(computeBotStatus(null, null, null)).toEqual({ state: "NOT_LINKED" });
  });

  it("linked but never contacted → NOT_STARTED with tracking start date", () => {
    const since = d("2026-10-25T00:00:00Z");
    expect(computeBotStatus("1", null, since)).toEqual({ state: "NOT_STARTED", trackingSince: since });
    expect(computeBotStatus("1", empty, since)).toEqual({ state: "NOT_STARTED", trackingSince: since });
  });

  it("first contact date is the «запущен» date (AC-E1.2); backfill = date unknown (AC-E1.5)", () => {
    expect(computeBotStatus("1", { ...empty, startedAt: d("2026-10-01T00:00:00Z") }, null)).toEqual({
      state: "STARTED",
      startedAt: d("2026-10-01T00:00:00Z"),
    });
    expect(computeBotStatus("1", { ...empty, startedBackfill: true }, null)).toEqual({ state: "STARTED", startedAt: null });
    expect(computeBotStatus("1", { ...empty, lastDeliveryOkAt: d("2026-10-02T00:00:00Z") }, null).state).toBe("STARTED");
  });

  it("block newer than any contact/delivery → BLOCKED; a later contact lifts it (AC-E1.4)", () => {
    const blocked = { ...empty, startedAt: d("2026-10-01T00:00:00Z"), lastContactAt: d("2026-10-03T00:00:00Z"), blockedAt: d("2026-10-05T00:00:00Z") };
    expect(computeBotStatus("1", blocked, null)).toEqual({ state: "BLOCKED", blockedAt: d("2026-10-05T00:00:00Z") });
    expect(computeBotStatus("1", { ...blocked, lastContactAt: d("2026-10-06T00:00:00Z") }, null).state).toBe("STARTED");
  });

  it("DTO serializes dates; unreachable = blocked or not started", () => {
    expect(toBotStatusDto({ state: "BLOCKED", blockedAt: d("2026-10-05T00:00:00Z") })).toEqual({
      state: "BLOCKED",
      blockedAt: "2026-10-05T00:00:00.000Z",
    });
    expect(toBotStatusDto({ state: "STARTED", startedAt: null })).toEqual({ state: "STARTED", startedAt: null });
    expect(isBotUnreachable({ state: "NOT_STARTED", trackingSince: null })).toBe(true);
    expect(isBotUnreachable({ state: "STARTED", startedAt: null })).toBe(false);
  });
});

describe("writes", () => {
  it("record* run one upsert statement and ignore invalid ids", async () => {
    await recordBotContact("123", d("2026-10-25T10:00:00Z"));
    await recordBotBlocked("123");
    await recordDeliveryProof("123");
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    const sql = vi.mocked(prisma.$executeRaw).mock.calls.map((c) => (c[0] as unknown as string[]).join("?"));
    expect(sql[0]).toMatch(/"startedAt" = COALESCE\("TelegramBotContact"\."startedAt"/);
    expect(sql[1]).toMatch(/"blockedAt" = EXCLUDED\."blockedAt"/);
    expect(sql[2]).toMatch(/interval '1 hour'/);

    vi.mocked(prisma.$executeRaw).mockClear();
    await recordBotContact("12a; DROP");
    await recordBotBlocked("");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("never throws on DB errors (best effort)", async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordBotContact("123")).resolves.toBeUndefined();
  });
});

describe("reads", () => {
  it("getBotContacts dedupes ids and skips invalid ones", async () => {
    vi.mocked(prisma.telegramBotContact.findMany).mockResolvedValue([{ telegramId: "1" }] as never);
    const map = await getBotContacts(["1", "1", "x"]);
    expect(prisma.telegramBotContact.findMany).toHaveBeenCalledWith({ where: { telegramId: { in: ["1"] } } });
    expect(map.get("1")).toEqual({ telegramId: "1" });
    expect(await getBotContacts([])).toEqual(new Map());
  });

  it("getBotTrackingSince is cached in-process", async () => {
    vi.mocked(prisma.telegramBotContact.aggregate).mockResolvedValue({ _min: { createdAt: d("2026-10-25T12:00:00Z") } } as never);
    expect(await getBotTrackingSince()).toEqual(d("2026-10-25T12:00:00Z"));
    await getBotTrackingSince();
    expect(prisma.telegramBotContact.aggregate).toHaveBeenCalledTimes(1);
  });
});
