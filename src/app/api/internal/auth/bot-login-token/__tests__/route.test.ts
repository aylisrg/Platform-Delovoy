import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedis, redisState, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const mockRedis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, _ex?: string, ttl?: number) => {
      store.set(k, v);
      if (typeof ttl === "number") ttls.set(k, ttl);
      return "OK";
    }),
    incr: vi.fn(async (k: string) => {
      const cur = parseInt(store.get(k) ?? "0", 10) + 1;
      store.set(k, String(cur));
      return cur;
    }),
    expire: vi.fn(async (k: string, ttl: number) => {
      ttls.set(k, ttl);
      return 1;
    }),
    ttl: vi.fn(async (k: string) => ttls.get(k) ?? -1),
    watch: vi.fn(async () => "OK"),
    unwatch: vi.fn(async () => "OK"),
    multi: vi.fn(() => ({
      set() {
        return this;
      },
      async exec() {
        return [[null, "OK"]];
      },
    })),
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

const prismaMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(async () => ({})),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMocks,
}));

import { POST } from "../route";

const SECRET = "test-bot-internal-secret-32bytes-aaaaaaaaaaaaaaaaaa";

function makeReq(opts: {
  body: unknown;
  authorization?: string;
}): Request {
  return new Request("http://localhost/api/internal/auth/bot-login-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.authorization
        ? { authorization: opts.authorization }
        : {}),
    },
    body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  }) as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  mockRedis._reset();
  vi.stubEnv("BOT_INTERNAL_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
});

describe("POST /api/internal/auth/bot-login-token", () => {
  it("returns 503 when BOT_INTERNAL_SECRET is not set", async () => {
    vi.stubEnv("BOT_INTERNAL_SECRET", "");
    const res = await POST(
      makeReq({ body: { telegramId: "12345" } }) as never
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("BOT_INTERNAL_NOT_CONFIGURED");
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(
      makeReq({ body: { telegramId: "12345" } }) as never
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when secret is wrong", async () => {
    const res = await POST(
      makeReq({
        authorization: "Bearer wrong-secret",
        body: { telegramId: "12345" },
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid telegramId", async () => {
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "not-digits" },
      }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 on malformed JSON body", async () => {
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: "not-json{",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 503 when Redis is unavailable", async () => {
    redisState.available = false;
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345" },
      }) as never
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("REDIS_UNAVAILABLE");
  });

  it("returns 404 when no user has this telegramId", async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345" },
      }) as never
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("returns 404 for a merged (tombstoned) user", async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce({
      id: "u-merged",
      role: "USER",
      mergedIntoUserId: "u-primary",
    });
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345" },
      }) as never
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for SUPERADMIN", async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce({
      id: "u-admin",
      role: "SUPERADMIN",
      mergedIntoUserId: null,
    });
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345", chatId: "12345" },
      }) as never
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("ADMIN_NO_BOT_LOGIN");
    expect(prismaMocks.auditLog.create).toHaveBeenCalled();
  });

  it("returns 403 for MANAGER", async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce({
      id: "u-mgr",
      role: "MANAGER",
      mergedIntoUserId: null,
    });
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345" },
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("happy path: 200 with token + callbackUrl, AuditLog written", async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce({
      id: "u-happy",
      role: "USER",
      mergedIntoUserId: null,
    });
    const res = await POST(
      makeReq({
        authorization: `Bearer ${SECRET}`,
        body: { telegramId: "12345", chatId: "12345" },
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.callbackUrl).toBe(
      `https://delovoy-park.ru/auth/tg-callback?token=${encodeURIComponent(body.data.token)}`
    );
    expect(body.data.expiresInSec).toBe(300);

    // Token persisted under bot-login namespace
    expect(store.has(`auth:tg:bot-login:${body.data.token}`)).toBe(true);

    // AuditLog mint event
    expect(prismaMocks.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u-happy",
          action: "auth.signin.attempt",
        }),
      })
    );
    const firstCall = prismaMocks.auditLog.create.mock.calls[0] as unknown as
      | [{ data: { metadata: Record<string, unknown> } }]
      | undefined;
    const meta = firstCall?.[0]?.data?.metadata;
    expect(meta).toEqual(
      expect.objectContaining({
        provider: "telegram-token",
        method: "bot-deeplink",
      })
    );
    // PII safety: raw chatId not present, masked is.
    expect(JSON.stringify(meta)).not.toContain("12345");
    expect(meta?.chatIdMasked).toMatch(/\*+2345$/);
  });

  it("returns 429 once per-tg limit is exceeded", async () => {
    prismaMocks.user.findUnique.mockResolvedValue({
      id: "u-rl",
      role: "USER",
      mergedIntoUserId: null,
    });
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await POST(
        makeReq({
          authorization: `Bearer ${SECRET}`,
          body: { telegramId: "55555" },
        }) as never
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
