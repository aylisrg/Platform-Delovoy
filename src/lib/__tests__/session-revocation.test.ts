import { describe, it, expect, vi, beforeEach } from "vitest";

const redisState = vi.hoisted(() => ({ available: true }));
vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  get redisAvailable() {
    return redisState.available;
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import {
  AUTH_STATE_TTL_SECONDS,
  bumpSessionVersion,
  getAuthState,
  publishAuthState,
} from "@/lib/session-revocation";

const dbRow = { sessionVersion: 3, role: "MANAGER", mergedIntoUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
});

describe("getAuthState", () => {
  it("serves a valid cache hit without touching the DB", async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ sessionVersion: 7, role: "ADMIN", merged: false }));
    expect(await getAuthState("u1")).toEqual({ sessionVersion: 7, role: "ADMIN", merged: false });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("cache miss → DB → cached for 60 s", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbRow as never);
    expect(await getAuthState("u1")).toEqual({ sessionVersion: 3, role: "MANAGER", merged: false });
    expect(redis.set).toHaveBeenCalledWith("auth:state:u1", expect.any(String), "EX", AUTH_STATE_TTL_SECONDS);
    expect(AUTH_STATE_TTL_SECONDS).toBe(60);
  });

  it("corrupted cache entry falls back to the DB", async () => {
    vi.mocked(redis.get).mockResolvedValue("{not json");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...dbRow, mergedIntoUserId: "p1" } as never);
    expect(await getAuthState("u1")).toEqual({ sessionVersion: 3, role: "MANAGER", merged: true });
  });

  it("Redis error or Redis down → DB", async () => {
    vi.mocked(redis.get).mockRejectedValue(new Error("boom"));
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbRow as never);
    expect(await getAuthState("u1")).toMatchObject({ sessionVersion: 3 });
    redisState.available = false;
    vi.mocked(redis.get).mockClear();
    expect(await getAuthState("u1")).toMatchObject({ sessionVersion: 3 });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("missing user → null; DB failure → unavailable", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await getAuthState("u1")).toBeNull();
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("db"));
    expect(await getAuthState("u1")).toBe("unavailable");
  });
});

describe("bumpSessionVersion / publishAuthState", () => {
  it("increments inside the given transaction", async () => {
    const tx = { user: { update: vi.fn().mockResolvedValue({ sessionVersion: 4 }) } };
    expect(await bumpSessionVersion(tx as never, "u1")).toBe(4);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
  });

  it("publishes the committed state so revocation applies from the next request", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...dbRow, sessionVersion: 4, role: "USER" } as never);
    await publishAuthState("u1");
    expect(redis.set).toHaveBeenCalledWith(
      "auth:state:u1",
      JSON.stringify({ sessionVersion: 4, role: "USER", merged: false }),
      "EX",
      60,
    );
  });

  it("never throws (TTL is the fallback)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbRow as never);
    vi.mocked(redis.set).mockRejectedValue(new Error("redis down"));
    await expect(publishAuthState("u1")).resolves.toBeUndefined();
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("db down"));
    await expect(publishAuthState("u1")).resolves.toBeUndefined();
  });

  it("deleted user → cache entry removed", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await publishAuthState("u1");
    expect(redis.del).toHaveBeenCalledWith("auth:state:u1");
  });
});
