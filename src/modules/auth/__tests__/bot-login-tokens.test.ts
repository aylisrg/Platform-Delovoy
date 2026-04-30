import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedis, redisState, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  const mockRedis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(
      async (k: string, v: string, _ex?: string, ttl?: number) => {
        store.set(k, v);
        if (typeof ttl === "number") ttls.set(k, ttl);
        return "OK";
      }
    ),
    incr: vi.fn(async (k: string) => {
      const cur = parseInt(store.get(k) ?? "0", 10);
      const next = cur + 1;
      store.set(k, String(next));
      return next;
    }),
    expire: vi.fn(async (k: string, ttl: number) => {
      ttls.set(k, ttl);
      return 1;
    }),
    ttl: vi.fn(async (k: string) => ttls.get(k) ?? -1),
    watch: vi.fn(async () => "OK"),
    unwatch: vi.fn(async () => "OK"),
    multi: vi.fn(() => {
      const ops: Array<[string, ...unknown[]]> = [];
      const tx = {
        set(k: string, v: string, _ex?: string, ttl?: number) {
          ops.push(["set", k, v, ttl]);
          return tx;
        },
        async exec() {
          for (const op of ops) {
            if (op[0] === "set") {
              const [, k, v, ttl] = op as [string, string, string, number?];
              store.set(k, v);
              if (typeof ttl === "number") ttls.set(k, ttl);
            }
          }
          return [[null, "OK"]];
        },
      };
      return tx;
    }),
    _ttls: ttls,
    _reset() {
      store.clear();
      ttls.clear();
    },
  };

  return { mockRedis, redisState: { available: true }, store };
});

vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  get redisAvailable() {
    return redisState.available;
  },
}));

import {
  BOT_LOGIN_CONSUMED_TTL_SECONDS,
  BOT_LOGIN_RL_GLOBAL_LIMIT,
  BOT_LOGIN_RL_PER_TG_LIMIT,
  BOT_LOGIN_TOKEN_PREFIX,
  BOT_LOGIN_TTL_SECONDS,
  TOKEN_PREFIX,
  checkBotLoginRateLimit,
  consumeBotLoginToken,
  createBotLoginToken,
  hashTelegramId,
  mintOneTimeJwt,
  readBotLoginToken,
} from "../telegram-deep-link";
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_TYPE,
} from "../telegram-token-jwt";
import { jwtVerify } from "jose";

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  mockRedis._reset();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-please-replace-bot-login");
});

describe("createBotLoginToken", () => {
  it("writes a PENDING entry under the bot-login namespace with 5-min TTL", async () => {
    const { token, expiresAt } = await createBotLoginToken({
      userId: "u-1",
      telegramId: "12345",
    });
    expect(token.length).toBeGreaterThan(10);
    expect(typeof expiresAt).toBe("string");

    const raw = store.get(BOT_LOGIN_TOKEN_PREFIX + token);
    expect(raw).toBeTruthy();
    const entry = JSON.parse(raw!);
    expect(entry.status).toBe("PENDING");
    expect(entry.userId).toBe("u-1");
    expect(entry.telegramIdHash).toBe(hashTelegramId("12345"));
    expect(entry.telegramIdHash).not.toContain("12345");

    expect(mockRedis._ttls.get(BOT_LOGIN_TOKEN_PREFIX + token)).toBe(
      BOT_LOGIN_TTL_SECONDS
    );
  });

  it("uses a namespace that is isolated from web→bot tokens", async () => {
    const { token } = await createBotLoginToken({
      userId: "u-ns",
      telegramId: "67890",
    });
    expect(store.has(BOT_LOGIN_TOKEN_PREFIX + token)).toBe(true);
    expect(store.has(TOKEN_PREFIX + token)).toBe(false);
  });

  it("throws when Redis is unavailable", async () => {
    redisState.available = false;
    await expect(
      createBotLoginToken({ userId: "u-2", telegramId: "11111" })
    ).rejects.toThrow(/REDIS_UNAVAILABLE/);
  });
});

describe("readBotLoginToken", () => {
  it("returns parsed entry on hit", async () => {
    const { token } = await createBotLoginToken({
      userId: "u-r",
      telegramId: "55555",
    });
    const entry = await readBotLoginToken(token);
    expect(entry?.userId).toBe("u-r");
    expect(entry?.status).toBe("PENDING");
  });

  it("returns null on miss", async () => {
    expect(await readBotLoginToken("nope")).toBeNull();
  });

  it("returns null on corrupted JSON", async () => {
    store.set(BOT_LOGIN_TOKEN_PREFIX + "corrupt", "not-json{");
    expect(await readBotLoginToken("corrupt")).toBeNull();
  });

  it("returns null when Redis is down", async () => {
    redisState.available = false;
    expect(await readBotLoginToken("anything")).toBeNull();
  });
});

describe("consumeBotLoginToken", () => {
  it("transitions PENDING → CONSUMED on first call and returns userId", async () => {
    const { token } = await createBotLoginToken({
      userId: "u-c",
      telegramId: "10001",
    });
    const result = await consumeBotLoginToken(token);
    expect(result).toEqual({ ok: true, userId: "u-c" });

    const raw = store.get(BOT_LOGIN_TOKEN_PREFIX + token)!;
    expect(JSON.parse(raw).status).toBe("CONSUMED");
    expect(mockRedis._ttls.get(BOT_LOGIN_TOKEN_PREFIX + token)).toBe(
      BOT_LOGIN_CONSUMED_TTL_SECONDS
    );
  });

  it("returns already_used on the second consume", async () => {
    const { token } = await createBotLoginToken({
      userId: "u-d",
      telegramId: "10002",
    });
    await consumeBotLoginToken(token);
    const second = await consumeBotLoginToken(token);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("returns not_found for an unknown token", async () => {
    expect(await consumeBotLoginToken("ghost-token")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("does not touch the web→bot namespace", async () => {
    // Hand-write a token under the web→bot prefix and verify the
    // bot-login consumer ignores it.
    store.set(
      TOKEN_PREFIX + "abc",
      JSON.stringify({
        status: "CONFIRMED",
        userId: "u-other",
        createdAt: new Date().toISOString(),
      })
    );
    expect(await consumeBotLoginToken("abc")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found when Redis is unavailable", async () => {
    redisState.available = false;
    expect(await consumeBotLoginToken("any")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("checkBotLoginRateLimit", () => {
  it("allows up to per-tg limit, then blocks with scope=tg", async () => {
    for (let i = 0; i < BOT_LOGIN_RL_PER_TG_LIMIT; i++) {
      const r = await checkBotLoginRateLimit("99999");
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkBotLoginRateLimit("99999");
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("tg");
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("blocks with scope=global when global counter exceeds", async () => {
    // Pre-seed global counter just over the limit.
    store.set(
      "auth:tg:botlogin:rl:global",
      String(BOT_LOGIN_RL_GLOBAL_LIMIT + 5)
    );
    mockRedis._ttls.set("auth:tg:botlogin:rl:global", 30);
    const r = await checkBotLoginRateLimit("88888");
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe("global");
  });

  it("returns allowed=false with no scope when Redis is down (caller treats as 503)", async () => {
    redisState.available = false;
    const r = await checkBotLoginRateLimit("77777");
    expect(r.allowed).toBe(false);
    expect(r.scope).toBeUndefined();
  });
});

describe("mintOneTimeJwt", () => {
  it("returns a JWT with sub + type + jti and verifiable signature", async () => {
    const jwt = await mintOneTimeJwt("u-jwt");
    expect(jwt).toBeTruthy();
    const { payload } = await jwtVerify(
      jwt!,
      new TextEncoder().encode("test-secret-please-replace-bot-login"),
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    expect(payload.sub).toBe("u-jwt");
    expect(payload.type).toBe(JWT_TYPE);
    expect(payload.jti).toBeTruthy();
  });

  it("returns null without NEXTAUTH_SECRET", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(await mintOneTimeJwt("u-x")).toBeNull();
  });

  it("returns null on empty userId", async () => {
    expect(await mintOneTimeJwt("")).toBeNull();
  });
});
