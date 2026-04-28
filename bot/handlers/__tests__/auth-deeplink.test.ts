import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedis, redisState } = vi.hoisted(() => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  };
  return { mockRedis, redisState: { available: true } };
});

vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  get redisAvailable() {
    return redisState.available;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    userNotificationChannel: { upsert: vi.fn() },
    account: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { mockAutoMerge } = vi.hoisted(() => ({ mockAutoMerge: vi.fn() }));
vi.mock("@/modules/auth/auto-merge", () => ({ autoMergeOnLogin: mockAutoMerge }));

import { prisma } from "@/lib/db";
import { handleAuthDeepLink, handleAuthContact } from "../auth-deeplink";

type MockCtx = {
  reply: ReturnType<typeof vi.fn>;
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  chat?: { id: number };
  message?: { contact?: { phone_number: string; user_id: number; first_name?: string } };
};

function makeCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    from: { id: 12345, first_name: "Иван" },
    chat: { id: 12345 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  mockAutoMerge.mockResolvedValue({ kind: "no_candidates" });
});

describe("handleAuthDeepLink", () => {
  it("returns false for non-auth deep links", async () => {
    const ctx = makeCtx();
    const handled = await handleAuthDeepLink(ctx as never, "link_xyz");
    expect(handled).toBe(false);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("rejects too-short token", async () => {
    const ctx = makeCtx();
    const handled = await handleAuthDeepLink(ctx as never, "auth_abc");
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Ссылка для входа недействительна")
    );
  });

  it("replies expired when Redis has no entry", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    const ctx = makeCtx();
    const handled = await handleAuthDeepLink(
      ctx as never,
      "auth_thisIsALongValidLookingTokenAbc"
    );
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("устарела")
    );
  });

  it("requests contact when token is PENDING", async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
    );
    const ctx = makeCtx();
    const handled = await handleAuthDeepLink(
      ctx as never,
      "auth_thisIsALongValidLookingTokenAbc"
    );
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("поделись номером телефона"),
      expect.objectContaining({ reply_markup: expect.any(Object) })
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:tg:awaiting:12345$/),
      "thisIsALongValidLookingTokenAbc",
      "EX",
      300
    );
  });
});

describe("handleAuthContact", () => {
  it("ignores messages without a contact", async () => {
    const ctx = makeCtx();
    const handled = await handleAuthContact(ctx as never);
    expect(handled).toBe(false);
  });

  it("rejects forwarded contact (contact.user_id !== ctx.from.id)", async () => {
    const ctx = makeCtx({
      message: { contact: { phone_number: "+79001234567", user_id: 99999 } },
    });
    const handled = await handleAuthContact(ctx as never);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Можно делиться только своим контактом"),
      expect.any(Object)
    );
  });

  it("replies if no awaiting key for this user", async () => {
    const ctx = makeCtx({
      message: { contact: { phone_number: "+79001234567", user_id: 12345 } },
    });
    mockRedis.get.mockResolvedValueOnce(null); // awaiting:12345
    const handled = await handleAuthContact(ctx as never);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Не вижу активного запроса"),
      expect.any(Object)
    );
  });

  it("creates a new User + channel + Account on first sign-in", async () => {
    const ctx = makeCtx({
      message: { contact: { phone_number: "+79001234567", user_id: 12345 } },
    });
    // Order of redis.get: 1) awaiting → token, 2) entry → PENDING, 3) (after confirm we re-read inside confirmToken)
    mockRedis.get
      .mockResolvedValueOnce("longLongLongTokenValueXXX") // awaiting
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      );

    // No existing user.
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn) => {
      const txMock = {
        user: {
          findFirst: vi.fn().mockResolvedValue(null), // both telegram + phone lookups
          findUnique: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: "new-user-1", role: "USER" }),
          update: vi.fn().mockResolvedValue({}),
        },
        userNotificationChannel: { upsert: vi.fn().mockResolvedValue({}) },
        account: { upsert: vi.fn().mockResolvedValue({}) },
      };
      // @ts-expect-error simplified mock
      return fn(txMock);
    });

    const handled = await handleAuthContact(ctx as never);
    expect(handled).toBe(true);
    // Confirm wrote the CONFIRMED state.
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:tg:token:longLongLongTokenValueXXX$/),
      expect.stringContaining('"status":"CONFIRMED"'),
      "EX",
      300
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Вход подтверждён"),
      expect.any(Object)
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "new-user-1",
          action: "auth.signin.success",
          metadata: expect.objectContaining({
            provider: "telegram-token",
            method: "deeplink",
            isNewUser: true,
            chatIdMasked: expect.stringContaining("2345"),
          }),
        }),
      })
    );
    expect(mockAutoMerge).not.toHaveBeenCalled(); // no candidates
  });

  it("triggers auto-merge when phone matches a different existing user", async () => {
    const ctx = makeCtx({
      message: { contact: { phone_number: "+79001234567", user_id: 12345 } },
    });
    mockRedis.get
      .mockResolvedValueOnce("longLongLongTokenValueXXX")
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      );

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn) => {
      const txMock = {
        user: {
          findFirst: vi
            .fn()
            // first call (telegramId) — matched
            .mockResolvedValueOnce({ id: "tg-bound", role: "USER", name: null })
            // second call (phone) — DIFFERENT user
            .mockResolvedValueOnce({ id: "phone-bound", role: "USER", name: "Старая запись" }),
          findUnique: vi.fn().mockResolvedValue({
            telegramId: "12345",
            phone: null,
            phoneNormalized: null,
            name: null,
          }),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
        userNotificationChannel: { upsert: vi.fn().mockResolvedValue({}) },
        account: { upsert: vi.fn().mockResolvedValue({}) },
      };
      // @ts-expect-error simplified mock
      return fn(txMock);
    });

    await handleAuthContact(ctx as never);

    expect(mockAutoMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryUserId: "tg-bound",
        candidates: [
          expect.objectContaining({ id: "phone-bound", role: "USER", matchedBy: "phone" }),
        ],
        provider: "telegram-token",
      })
    );
  });

  it("logs auth.signin.success with masked chatId", async () => {
    const ctx = makeCtx({
      message: { contact: { phone_number: "+79001234567", user_id: 12345 } },
      chat: { id: 9876543210 },
    });
    mockRedis.get
      .mockResolvedValueOnce("longLongLongTokenValueXXX")
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ status: "PENDING", createdAt: new Date().toISOString() })
      );

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn) => {
      const txMock = {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: "u-mask", role: "USER" }),
          update: vi.fn().mockResolvedValue({}),
        },
        userNotificationChannel: { upsert: vi.fn().mockResolvedValue({}) },
        account: { upsert: vi.fn().mockResolvedValue({}) },
      };
      // @ts-expect-error simplified mock
      return fn(txMock);
    });

    await handleAuthContact(ctx as never);

    const auditCall = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    const meta = auditCall.data.metadata as Record<string, unknown>;
    // chatId 9876543210 → last 4 visible: ******3210
    expect(meta.chatIdMasked).toBe("******3210");
  });
});
