import { describe, it, expect, vi, beforeEach } from "vitest";

const redisState = vi.hoisted(() => ({ available: true }));
vi.mock("@/lib/redis", () => ({
  redis: { set: vi.fn() },
  get redisAvailable() {
    return redisState.available;
  },
}));
vi.mock("@/lib/db", () => ({ prisma: { $executeRaw: vi.fn() } }));

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { runNotificationHousekeeping, SKIP_RETENTION_DAYS } from "../housekeeping";

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
});

describe("runNotificationHousekeeping (ADR 2026-10-25 §Q3)", () => {
  const now = new Date("2026-10-25T03:00:00Z");

  it("runs once a day: expired links (400-day TTL) and skips older than 180 days", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(3).mockResolvedValueOnce(7);
    expect(await runNotificationHousekeeping(now)).toEqual({ ran: true, links: 3, skips: 7 });
    expect(redis.set).toHaveBeenCalledWith("notif:housekeeping:2026-10-25", "1", "EX", 90_000, "NX");
    const calls = vi.mocked(prisma.$executeRaw).mock.calls;
    expect((calls[0][0] as unknown as string[]).join("?")).toMatch(/DELETE FROM "NotificationLink"[\s\S]*"expiresAt" </);
    expect(calls[0][1]).toEqual(now);
    expect((calls[1][0] as unknown as string[]).join("?")).toMatch(/DELETE FROM "NotificationDeliverySkip"/);
    expect((calls[1][1] as Date).getTime()).toBe(now.getTime() - SKIP_RETENTION_DAYS * 86_400_000);
    expect(SKIP_RETENTION_DAYS).toBe(180);
  });

  it("keeps deleting while full batches come back", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(5000).mockResolvedValueOnce(10).mockResolvedValueOnce(0);
    expect(await runNotificationHousekeeping(now)).toEqual({ ran: true, links: 5010, skips: 0 });
  });

  it("second run the same day, or no Redis → does nothing", async () => {
    vi.mocked(redis.set).mockResolvedValue(null as never);
    expect((await runNotificationHousekeeping(now)).ran).toBe(false);
    redisState.available = false;
    expect((await runNotificationHousekeeping(now)).ran).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
