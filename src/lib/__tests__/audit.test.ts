import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { logAuthEvent, hashIp, maskChatId } from "../audit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashIp", () => {
  it("returns 16-char hex for a real IP", () => {
    const out = hashIp("203.0.113.42");
    expect(out).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is stable across calls (same input → same hash)", () => {
    expect(hashIp("203.0.113.42")).toBe(hashIp("203.0.113.42"));
  });

  it("differs for different inputs", () => {
    expect(hashIp("1.2.3.4")).not.toBe(hashIp("5.6.7.8"));
  });

  it("returns undefined for empty / null / undefined", () => {
    expect(hashIp(null)).toBeUndefined();
    expect(hashIp(undefined)).toBeUndefined();
    expect(hashIp("")).toBeUndefined();
    expect(hashIp("   ")).toBeUndefined();
  });
});

describe("maskChatId", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskChatId("1234567890")).toBe("******7890");
  });

  it("preserves negative sign on group chats", () => {
    expect(maskChatId("-1001234567890")).toBe("-*********7890");
  });

  it("returns the input untouched when too short to mask", () => {
    expect(maskChatId("42")).toBe("42");
  });

  it("accepts numeric input", () => {
    expect(maskChatId(1234567890)).toBe("******7890");
  });

  it("returns undefined for null / undefined", () => {
    expect(maskChatId(null)).toBeUndefined();
    expect(maskChatId(undefined)).toBeUndefined();
  });
});

describe("logAuthEvent", () => {
  it("writes auth.signin.attempt with provider+ipHash", async () => {
    await logAuthEvent("auth.signin.attempt", "user-1", {
      provider: "telegram-token",
      method: "deeplink",
      ipHash: "abc123",
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "auth.signin.attempt",
        entity: "User",
        entityId: "user-1",
        metadata: {
          provider: "telegram-token",
          method: "deeplink",
          ipHash: "abc123",
        },
      },
    });
  });

  it("writes auth.signin.success with isNewUser flag", async () => {
    await logAuthEvent("auth.signin.success", "user-2", {
      provider: "telegram-token",
      isNewUser: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "auth.signin.success",
          metadata: expect.objectContaining({ isNewUser: true }),
        }),
      })
    );
  });

  it("writes auth.signin.failure with reason", async () => {
    await logAuthEvent("auth.signin.failure", "user-3", {
      provider: "telegram-token",
      reason: "JWT_EXPIRED",
    });
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.signin.failure");
    expect((call.data.metadata as Record<string, unknown>).reason).toBe(
      "JWT_EXPIRED"
    );
  });

  it("writes auth.signout", async () => {
    await logAuthEvent("auth.signout", "user-4", {});
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.signout");
  });

  it("writes auth.merge.auto with matchedBy + secondary", async () => {
    await logAuthEvent("auth.merge.auto", "user-5", {
      matchedBy: "phone",
      secondaryUserId: "user-6",
    });
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.merge.auto");
    expect(call.data.metadata).toMatchObject({
      matchedBy: "phone",
      secondaryUserId: "user-6",
    });
  });

  it("writes auth.merge.manual with fkMoved counts", async () => {
    await logAuthEvent("auth.merge.manual", "admin-1", {
      secondaryUserId: "user-7",
      fkMoved: { bookings: 3, orders: 2, taskComments: 1 },
    });
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.merge.manual");
    expect(call.data.metadata).toMatchObject({
      fkMoved: { bookings: 3, orders: 2, taskComments: 1 },
    });
  });

  it("writes auth.merge.conflict with candidate ids", async () => {
    await logAuthEvent("auth.merge.conflict", "user-8", {
      candidateUserIds: ["user-9", "user-10"],
      matchedBy: "phone",
    });
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.merge.conflict");
    expect(call.data.metadata).toMatchObject({
      candidateUserIds: ["user-9", "user-10"],
    });
  });

  it("writes auth.merge.skipped_admin with role", async () => {
    await logAuthEvent("auth.merge.skipped_admin", "user-11", {
      matchedBy: "phone",
      role: "MANAGER",
      secondaryUserId: "admin-1",
    });
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("auth.merge.skipped_admin");
    expect(call.data.metadata).toMatchObject({ role: "MANAGER" });
  });

  it("skips DB write when userId is null/undefined (anonymous)", async () => {
    await logAuthEvent("auth.signin.attempt", null, { provider: "x" });
    await logAuthEvent("auth.signin.attempt", undefined, { provider: "x" });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not throw when prisma write fails", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error("DB down"));
    await expect(
      logAuthEvent("auth.signin.success", "user-12", {})
    ).resolves.not.toThrow();
  });
});
