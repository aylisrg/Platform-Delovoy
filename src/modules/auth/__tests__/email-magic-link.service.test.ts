import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks (vi.mock factories are hoisted, so vars must be too) ---

const { mockVerificationToken, mockUser, mockRedis, redisState } = vi.hoisted(() => {
  const mockVerificationToken = {
    deleteMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const mockUser = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
  const redisState = { available: true };
  return { mockVerificationToken, mockUser, mockRedis, redisState };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    verificationToken: mockVerificationToken,
    user: mockUser,
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  get redisAvailable() {
    return redisState.available;
  },
}));

vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn(),
  },
}));

// Mock crypto.randomBytes to produce deterministic token
vi.mock("crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("crypto")>();
  return {
    ...original,
    default: {
      ...original,
      randomBytes: vi.fn(() => Buffer.from("a".repeat(32))),
    },
  };
});

import {
  canSendMagicLink,
  generateAndStoreMagicLink,
  sendMagicLinkEmail,
  verifyMagicLink,
} from "../email-magic-link.service";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
});

// --- canSendMagicLink ---

describe("canSendMagicLink", () => {
  it("returns true when no cooldown key in Redis", async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await canSendMagicLink("user@example.com");
    expect(result).toBe(true);
  });

  it("returns false when cooldown key exists", async () => {
    mockRedis.get.mockResolvedValue("1");
    const result = await canSendMagicLink("user@example.com");
    expect(result).toBe(false);
  });

  it("normalizes email before checking", async () => {
    mockRedis.get.mockResolvedValue(null);
    await canSendMagicLink("  USER@Example.COM  ");
    expect(mockRedis.get).toHaveBeenCalledWith(
      expect.stringContaining("user@example.com")
    );
  });

  it("falls back to DB token lookup when Redis unavailable — blocks within cooldown", async () => {
    redisState.available = false;
    mockVerificationToken.findFirst.mockResolvedValue({ token: "recent" });
    const result = await canSendMagicLink("user@example.com");
    expect(result).toBe(false);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockVerificationToken.findFirst).toHaveBeenCalledWith({
      where: {
        identifier: "user@example.com",
        expires: { gt: expect.any(Date) },
      },
      select: { token: true },
    });
  });

  it("falls back to DB token lookup when Redis unavailable — allows when no recent token", async () => {
    redisState.available = false;
    mockVerificationToken.findFirst.mockResolvedValue(null);
    const result = await canSendMagicLink("user@example.com");
    expect(result).toBe(true);
  });

  it("DB fallback uses correct cooldown cutoff (~14 min in future)", async () => {
    redisState.available = false;
    mockVerificationToken.findFirst.mockResolvedValue(null);
    const before = Date.now();
    await canSendMagicLink("user@example.com");
    const call = mockVerificationToken.findFirst.mock.calls[0][0];
    const cutoff: Date = call.where.expires.gt;
    const diffMs = cutoff.getTime() - before;
    // 14 minutes = token TTL (15m) - cooldown (1m)
    expect(diffMs).toBeGreaterThanOrEqual(13 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});

// --- generateAndStoreMagicLink ---

describe("generateAndStoreMagicLink", () => {
  beforeEach(() => {
    mockVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
    mockVerificationToken.create.mockResolvedValue({});
    mockRedis.set.mockResolvedValue("OK");
  });

  it("deletes existing tokens before creating", async () => {
    await generateAndStoreMagicLink("test@example.com");
    expect(mockVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "test@example.com" },
    });
  });

  it("creates a new VerificationToken with correct fields", async () => {
    await generateAndStoreMagicLink("test@example.com");
    expect(mockVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: "test@example.com",
        token: expect.any(String),
        expires: expect.any(Date),
      }),
    });
  });

  it("expires in ~15 minutes", async () => {
    const before = Date.now();
    await generateAndStoreMagicLink("test@example.com");
    const call = mockVerificationToken.create.mock.calls[0][0];
    const expires: Date = call.data.expires;
    const diffMs = expires.getTime() - before;
    expect(diffMs).toBeGreaterThanOrEqual(14 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(16 * 60 * 1000);
  });

  it("stores password hash in Redis when password provided", async () => {
    await generateAndStoreMagicLink("test@example.com", "mypassword");
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("magic-link:pw:"),
      "hashed-password",
      "EX",
      expect.any(Number)
    );
  });

  it("does not store password hash when no password", async () => {
    await generateAndStoreMagicLink("test@example.com");
    const pwCall = mockRedis.set.mock.calls.find((c) =>
      String(c[0]).includes("magic-link:pw:")
    );
    expect(pwCall).toBeUndefined();
  });

  it("sets cooldown in Redis", async () => {
    await generateAndStoreMagicLink("test@example.com");
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("magic-link:cooldown:"),
      "1",
      "EX",
      60
    );
  });

  it("normalizes email to lowercase", async () => {
    await generateAndStoreMagicLink("UPPER@Example.COM");
    expect(mockVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: "upper@example.com",
      }),
    });
  });
});

// --- sendMagicLinkEmail ---

describe("sendMagicLinkEmail", () => {
  it("calls sendTransactionalEmail with correct recipient and subject", async () => {
    await sendMagicLinkEmail("user@example.com", "abc123token");
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: expect.stringContaining("Деловой Парк"),
        html: expect.stringContaining("abc123token"),
      })
    );
  });

  it("throws EMAIL_SEND_FAILED when email send fails", async () => {
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({
      success: false,
      error: "API error",
    });
    await expect(
      sendMagicLinkEmail("user@example.com", "token")
    ).rejects.toThrow("EMAIL_SEND_FAILED");
  });

  it("includes the token in the magic link URL", async () => {
    const token = "my-unique-token-123";
    await sendMagicLinkEmail("user@example.com", token);
    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.html).toContain(token);
    expect(call.text).toContain(token);
  });
});

// --- verifyMagicLink ---

describe("verifyMagicLink", () => {
  const validRecord = {
    identifier: "user@example.com",
    token: "valid-token",
    expires: new Date(Date.now() + 10 * 60 * 1000), // 10 min in future
  };

  const existingUser = {
    id: "user-1",
    email: "user@example.com",
    emailVerified: null,
    passwordHash: null,
  };

  beforeEach(() => {
    mockVerificationToken.findFirst.mockResolvedValue(validRecord);
    mockVerificationToken.deleteMany.mockResolvedValue({ count: 1 });
    mockUser.findUnique.mockResolvedValue(null);
    mockUser.create.mockResolvedValue({ id: "new-user-1", email: "user@example.com" });
    mockUser.update.mockResolvedValue(existingUser);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
  });

  it("throws TOKEN_INVALID when token not found", async () => {
    mockVerificationToken.findFirst.mockResolvedValue(null);
    await expect(
      verifyMagicLink("bad-token", "user@example.com")
    ).rejects.toThrow("TOKEN_INVALID");
  });

  it("throws TOKEN_EXPIRED when token is past expires", async () => {
    mockVerificationToken.findFirst.mockResolvedValue({
      ...validRecord,
      expires: new Date(Date.now() - 1000), // 1 second in past
    });
    await expect(
      verifyMagicLink("valid-token", "user@example.com")
    ).rejects.toThrow("TOKEN_EXPIRED");
  });

  it("deletes token after successful verification (one-time use)", async () => {
    await verifyMagicLink("valid-token", "user@example.com");
    expect(mockVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "user@example.com", token: "valid-token" },
    });
  });

  it("creates new user when user does not exist", async () => {
    mockUser.findUnique.mockResolvedValue(null);
    const result = await verifyMagicLink("valid-token", "user@example.com");
    expect(mockUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "user@example.com",
        role: "USER",
        emailVerified: expect.any(Date),
      }),
    });
    expect(result.isNewUser).toBe(true);
  });

  it("creates new user with passwordHash from Redis when available", async () => {
    mockRedis.get.mockResolvedValue("stored-hash");
    await verifyMagicLink("valid-token", "user@example.com");
    expect(mockUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordHash: "stored-hash",
      }),
    });
    expect(mockRedis.del).toHaveBeenCalledWith("magic-link:pw:valid-token");
  });

  it("logs in existing user without overwriting passwordHash", async () => {
    const userWithPassword = {
      ...existingUser,
      id: "existing-1",
      emailVerified: new Date(),
      passwordHash: "existing-hash",
    };
    mockUser.findUnique.mockResolvedValue(userWithPassword);

    const result = await verifyMagicLink("valid-token", "user@example.com");
    expect(mockUser.create).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
    expect(result.userId).toBe("existing-1");
  });

  it("marks emailVerified for existing unverified user", async () => {
    mockUser.findUnique.mockResolvedValue({ ...existingUser, id: "existing-1" });
    await verifyMagicLink("valid-token", "user@example.com");
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: "existing-1" },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it("normalizes email before lookup", async () => {
    await verifyMagicLink("valid-token", "  USER@Example.COM  ");
    expect(mockVerificationToken.findFirst).toHaveBeenCalledWith({
      where: { token: "valid-token", identifier: "user@example.com" },
    });
  });
});
