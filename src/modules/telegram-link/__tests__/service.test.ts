import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    telegramLinkToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

// Must import after mocks
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import {
  requestLink,
  confirmLink,
  skipLink,
  generateDeepLink,
  processDeepLink,
  hasSkippedLinking,
  LinkError,
} from "../service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestLink", () => {
  it("returns sent=true on success for email", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null) // not linked by telegramId
      .mockResolvedValueOnce({ id: "user-1", telegramId: null, email: "u@mail.com", phone: null } as never); // found by email
    vi.mocked(redis.get).mockResolvedValue(null); // not blocked
    vi.mocked(redis.set).mockResolvedValue("OK");

    const result = await requestLink("tg-123", { type: "email", value: "u@mail.com" });

    expect(result.sent).toBe(true);
    expect(result.maskedValue).toContain("@");
    expect(result.expiresIn).toBe(600);
  });

  it("throws TELEGRAM_ALREADY_LINKED if telegramId is already linked", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "user-1" } as never);

    await expect(
      requestLink("tg-123", { type: "email", value: "u@mail.com" })
    ).rejects.toMatchObject({ code: "TELEGRAM_ALREADY_LINKED", status: 409 });
  });

  it("throws LINK_BLOCKED if blocked", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(redis.get).mockResolvedValue("1");

    await expect(
      requestLink("tg-123", { type: "email", value: "u@mail.com" })
    ).rejects.toMatchObject({ code: "LINK_BLOCKED", status: 429 });
  });

  it("throws ACCOUNT_NOT_FOUND if no user with that email", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null) // not linked by telegramId
      .mockResolvedValueOnce(null); // not found by email
    vi.mocked(redis.get).mockResolvedValue(null);

    await expect(
      requestLink("tg-123", { type: "email", value: "unknown@mail.com" })
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND", status: 404 });
  });
});

describe("confirmLink", () => {
  const mockOtp = JSON.stringify({
    userId: "user-1",
    type: "email",
    value: "u@mail.com",
    code: "123456",
    attempts: 0,
  });

  it("links telegram on correct OTP", async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null).mockResolvedValueOnce(mockOtp);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "user-1",
      name: "Ivan",
      role: "USER",
      telegramId: "tg-123",
    } as never);
    vi.mocked(redis.del).mockResolvedValue(1);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const result = await confirmLink("tg-123", "123456");

    expect(result.linked).toBe(true);
    expect(result.user.telegramId).toBe("tg-123");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { telegramId: "tg-123" },
      select: { id: true, name: true, role: true, telegramId: true },
    });
  });

  it("throws LINK_BLOCKED if blocked key exists", async () => {
    vi.mocked(redis.get).mockResolvedValueOnce("1");

    await expect(confirmLink("tg-123", "111111")).rejects.toMatchObject({
      code: "LINK_BLOCKED",
      status: 429,
    });
  });

  it("throws CODE_EXPIRED if no OTP in redis", async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(confirmLink("tg-123", "123456")).rejects.toMatchObject({
      code: "CODE_EXPIRED",
      status: 410,
    });
  });

  it("throws INVALID_CODE on wrong code and increments attempts", async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null).mockResolvedValueOnce(mockOtp);
    vi.mocked(redis.set).mockResolvedValue("OK");

    await expect(confirmLink("tg-123", "000000")).rejects.toMatchObject({
      code: "INVALID_CODE",
      status: 400,
    });
    expect(redis.set).toHaveBeenCalled();
  });

  it("blocks after 3 wrong attempts", async () => {
    const otpWith2Attempts = JSON.stringify({
      userId: "user-1",
      type: "email",
      value: "u@mail.com",
      code: "123456",
      attempts: 2,
    });
    vi.mocked(redis.get).mockResolvedValueOnce(null).mockResolvedValueOnce(otpWith2Attempts);
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(redis.del).mockResolvedValue(1);

    await expect(confirmLink("tg-123", "000000")).rejects.toMatchObject({
      code: "LINK_BLOCKED",
      status: 429,
    });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("block"),
      "1",
      "EX",
      expect.any(Number)
    );
  });
});

describe("skipLink", () => {
  it("sets skip flag in redis", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK");

    await skipLink("tg-123");

    expect(redis.set).toHaveBeenCalledWith(
      "tg-link:skipped:tg-123",
      "1",
      "EX",
      expect.any(Number)
    );
  });
});

describe("hasSkippedLinking", () => {
  it("returns true when skip flag exists", async () => {
    vi.mocked(redis.get).mockResolvedValue("1");
    expect(await hasSkippedLinking("tg-123")).toBe(true);
  });

  it("returns false when no skip flag", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    expect(await hasSkippedLinking("tg-123")).toBe(false);
  });
});

describe("generateDeepLink", () => {
  it("generates deep link for user without telegram", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ telegramId: null } as never);
    vi.mocked(prisma.telegramLinkToken.create).mockResolvedValue({} as never);
    vi.mocked(redis.set).mockResolvedValue("OK");

    const result = await generateDeepLink("user-1");

    expect(result.deepLink).toContain("t.me/");
    expect(result.deepLink).toContain("start=link_");
    expect(result.expiresIn).toBe(900);
  });

  it("throws TELEGRAM_ALREADY_LINKED if user has telegramId", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ telegramId: "tg-existing" } as never);

    await expect(generateDeepLink("user-1")).rejects.toMatchObject({
      code: "TELEGRAM_ALREADY_LINKED",
      status: 409,
    });
  });
});

describe("processDeepLink", () => {
  it("links telegram via valid token from Redis", async () => {
    vi.mocked(redis.get).mockResolvedValue("user-1");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null); // telegramId not linked to other user
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1", name: "Ivan" } as never);
    vi.mocked(prisma.telegramLinkToken.update).mockResolvedValue({} as never);
    vi.mocked(redis.del).mockResolvedValue(1);

    const result = await processDeepLink({
      token: "a".repeat(48),
      telegramId: "tg-999",
    });

    expect(result.linked).toBe(true);
    expect(result.userName).toBe("Ivan");
  });

  it("throws INVALID_TOKEN if token not found in Redis or DB", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(prisma.telegramLinkToken.findUnique).mockResolvedValue(null);

    await expect(
      processDeepLink({ token: "a".repeat(48), telegramId: "tg-999" })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 400 });
  });

  it("throws TELEGRAM_ALREADY_LINKED if telegramId belongs to another user", async () => {
    vi.mocked(redis.get).mockResolvedValue("user-1");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-OTHER" } as never);

    await expect(
      processDeepLink({ token: "a".repeat(48), telegramId: "tg-999" })
    ).rejects.toMatchObject({ code: "TELEGRAM_ALREADY_LINKED", status: 409 });
  });
});

describe("LinkError", () => {
  it("has correct properties", () => {
    const err = new LinkError("SOME_CODE", "some message", 400);
    expect(err.code).toBe("SOME_CODE");
    expect(err.message).toBe("some message");
    expect(err.status).toBe(400);
    expect(err instanceof Error).toBe(true);
  });
});
