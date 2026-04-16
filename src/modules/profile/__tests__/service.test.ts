import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getProfile,
  updateName,
  requestEmailAttach,
  confirmEmailAttach,
  requestPhoneAttach,
  confirmPhoneAttach,
} from "../service";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/redis", () => {
  const store: Record<string, string> = {};
  return {
    redisAvailable: true,
    redis: {
      get: vi.fn(async (key: string) => store[key] ?? null),
      set: vi.fn(async (key: string, value: string) => { store[key] = value; }),
      del: vi.fn(async (key: string) => { delete store[key]; }),
    },
  };
});

vi.mock("@/lib/green-api", () => ({
  isGreenApiConfigured: vi.fn(() => true),
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: vi.fn(async () => ({ success: true })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

function mockUser(overrides = {}) {
  return {
    id: "user-1",
    name: "Иван",
    image: null,
    email: null,
    phone: null,
    telegramId: "tg-123",
    vkId: null,
    ...overrides,
  };
}

// ── getProfile ────────────────────────────────────────────────────────────────

describe("getProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns profile with contacts", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(
      mockUser({ email: "test@test.com", phone: "+79001234567" }) as never
    );

    const profile = await getProfile("user-1");

    expect(profile.id).toBe("user-1");
    expect(profile.name).toBe("Иван");
    expect(profile.contacts.telegram).toBe("tg-123");
    expect(profile.contacts.email).toBe("test@test.com");
    expect(profile.contacts.phone).toBe("+79001234567");
    expect(profile.contacts.vk).toBeNull();
  });

  it("returns null contacts for empty user", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never);

    const profile = await getProfile("user-1");

    expect(profile.contacts.email).toBeNull();
    expect(profile.contacts.phone).toBeNull();
    expect(profile.contacts.vk).toBeNull();
  });
});

// ── updateName ────────────────────────────────────────────────────────────────

describe("updateName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns new name", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({ name: "Пётр" } as never);

    const result = await updateName("user-1", { name: "Пётр" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Пётр" },
      select: { name: true },
    });
    expect(result.name).toBe("Пётр");
  });
});

// ── requestEmailAttach ────────────────────────────────────────────────────────

describe("requestEmailAttach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends verification email for new email", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ email: null } as never)   // current user
      .mockResolvedValueOnce(null);                        // no other owner

    const result = await requestEmailAttach("user-1", { email: "new@test.com" });

    expect(result.sent).toBe(true);
    expect(redis.set).toHaveBeenCalled();
  });

  it("throws EMAIL_ALREADY_ATTACHED if same email", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      { email: "same@test.com" } as never
    );

    await expect(
      requestEmailAttach("user-1", { email: "same@test.com" })
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_ATTACHED" });
  });

  it("throws EMAIL_IN_USE if owned by another user", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ email: null } as never)
      .mockResolvedValueOnce({ id: "other-user" } as never);

    await expect(
      requestEmailAttach("user-1", { email: "taken@test.com" })
    ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
  });
});

// ── confirmEmailAttach ────────────────────────────────────────────────────────

describe("confirmEmailAttach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches email on valid token", async () => {
    const token = "abc123token";
    // Simulate stored value in Redis
    vi.mocked(redis.get).mockResolvedValue(`${token}:test@test.com` as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);  // not taken
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const result = await confirmEmailAttach("user-1", { token });

    expect(result.email).toBe("test@test.com");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "test@test.com", emailVerified: expect.any(Date) },
    });
  });

  it("throws INVALID_TOKEN when redis has no entry", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await expect(
      confirmEmailAttach("user-1", { token: "wrong" })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("throws INVALID_TOKEN on token mismatch", async () => {
    vi.mocked(redis.get).mockResolvedValue("correcttoken:test@test.com" as never);

    await expect(
      confirmEmailAttach("user-1", { token: "wrongtoken" })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});

// ── requestEmailAttach – SEND_FAILED ─────────────────────────────────────────

describe("requestEmailAttach – SEND_FAILED", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws SEND_FAILED when email send fails", async () => {
    const { sendTransactionalEmail } = await import(
      "@/modules/notifications/channels/email"
    );
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({ success: false } as never);

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ email: null } as never)
      .mockResolvedValueOnce(null);

    await expect(
      requestEmailAttach("user-1", { email: "new@test.com" })
    ).rejects.toMatchObject({ code: "SEND_FAILED" });
  });
});

// ── confirmEmailAttach – race condition ───────────────────────────────────────

describe("confirmEmailAttach – race condition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws EMAIL_IN_USE if email taken by another user between request and confirm", async () => {
    const token = "racetoken";
    vi.mocked(redis.get).mockResolvedValue(`${token}:race@test.com` as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "other-user" } as never);

    await expect(
      confirmEmailAttach("user-1", { token })
    ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
  });
});

// ── requestPhoneAttach ────────────────────────────────────────────────────────

describe("requestPhoneAttach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends OTP for new phone", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ phone: null } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(redis.get).mockResolvedValue(null); // no cooldown

    const result = await requestPhoneAttach("user-1", { phone: "+79001234567" });

    expect(result.sent).toBe(true);
    expect(result.phone).toContain("***");
  });

  it("throws PHONE_ALREADY_ATTACHED if same phone", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      { phone: "+79001234567" } as never
    );

    await expect(
      requestPhoneAttach("user-1", { phone: "79001234567" })
    ).rejects.toMatchObject({ code: "PHONE_ALREADY_ATTACHED" });
  });

  it("throws PHONE_IN_USE if owned by another", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ phone: null } as never)
      .mockResolvedValueOnce({ id: "other" } as never);
    vi.mocked(redis.get).mockResolvedValue(null);

    await expect(
      requestPhoneAttach("user-1", { phone: "79001234567" })
    ).rejects.toMatchObject({ code: "PHONE_IN_USE" });
  });

  it("cleans up OTP on SEND_FAILED", async () => {
    const { sendWhatsAppMessage } = await import("@/lib/green-api");
    vi.mocked(sendWhatsAppMessage).mockResolvedValueOnce({ success: false } as never);

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ phone: null } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(redis.get).mockResolvedValue(null);

    await expect(
      requestPhoneAttach("user-1", { phone: "79001234567" })
    ).rejects.toMatchObject({ code: "SEND_FAILED" });

    // Verify OTP was cleaned up
    expect(redis.del).toHaveBeenCalledWith(
      expect.stringContaining("profile:phone-otp:")
    );
  });
});

// ── confirmPhoneAttach ────────────────────────────────────────────────────────

describe("confirmPhoneAttach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches phone on valid OTP", async () => {
    vi.mocked(redis.get).mockResolvedValue("79001234567:123456:0" as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const result = await confirmPhoneAttach("user-1", {
      phone: "79001234567",
      code: "123456",
    });

    expect(result.phone).toBe("+79001234567");
  });

  it("throws CODE_EXPIRED when no Redis entry", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await expect(
      confirmPhoneAttach("user-1", { phone: "79001234567", code: "111111" })
    ).rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });

  it("throws INVALID_CODE on wrong code", async () => {
    vi.mocked(redis.get).mockResolvedValue("79001234567:123456:0" as never);
    vi.mocked(redis.set).mockResolvedValue("OK" as never);

    await expect(
      confirmPhoneAttach("user-1", { phone: "79001234567", code: "999999" })
    ).rejects.toMatchObject({ code: "INVALID_CODE" });
  });
});
