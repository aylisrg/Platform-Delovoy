import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — vi.mock factory runs before imports.
const {
  findUniqueMock,
  updateMock,
  updateUNCMock,
  transactionMock,
  upsertMock,
  upsertUNCMock,
  aggregateUNCMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  updateUNCMock: vi.fn(),
  transactionMock: vi.fn(),
  upsertMock: vi.fn(),
  upsertUNCMock: vi.fn(),
  aggregateUNCMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webPushSubscription: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
    userNotificationChannel: {
      update: (...args: unknown[]) => updateUNCMock(...args),
      upsert: (...args: unknown[]) => upsertUNCMock(...args),
      aggregate: (...args: unknown[]) => aggregateUNCMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import {
  deactivateSubscriptionByEndpoint,
  recordSuccessfulDelivery,
  toPublicWebPushSubscription,
  subscribeUser,
  unsubscribeUser,
  WebPushSubscriptionConflictError,
} from "../service";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

describe("web-push service", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateUNCMock.mockReset();
    transactionMock.mockReset();
    upsertMock.mockReset();
    upsertUNCMock.mockReset();
    aggregateUNCMock.mockReset();
    transactionMock.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)({
          webPushSubscription: { update: updateMock, upsert: upsertMock },
          userNotificationChannel: {
            update: updateUNCMock,
            upsert: upsertUNCMock,
            aggregate: aggregateUNCMock,
          },
        });
      }
      return undefined;
    });
    updateMock.mockResolvedValue({});
    updateUNCMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("deactivateSubscriptionByEndpoint", () => {
    it("happy path: deactivates both WebPushSubscription and UserNotificationChannel", async () => {
      findUniqueMock.mockResolvedValue({
        id: "sub-1",
        userNotificationChannelId: "unc-1",
      });

      const result = await deactivateSubscriptionByEndpoint(ENDPOINT, "HTTP 410");

      expect(result).toBe(true);
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT },
        data: {
          isActive: false,
          lastFailureAt: expect.any(Date),
          lastFailureReason: "HTTP 410",
        },
      });
      expect(updateUNCMock).toHaveBeenCalledWith({
        where: { id: "unc-1" },
        data: { isActive: false },
      });
    });

    it("only deactivates subscription when userNotificationChannelId is null", async () => {
      findUniqueMock.mockResolvedValue({
        id: "sub-2",
        userNotificationChannelId: null,
      });

      const result = await deactivateSubscriptionByEndpoint(ENDPOINT, "HTTP 410");

      expect(result).toBe(true);
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT },
        data: {
          isActive: false,
          lastFailureAt: expect.any(Date),
          lastFailureReason: "HTTP 410",
        },
      });
      expect(updateUNCMock).not.toHaveBeenCalled();
    });

    it("no-op (returns false) when endpoint not found, without throwing", async () => {
      findUniqueMock.mockResolvedValue(null);

      const result = await deactivateSubscriptionByEndpoint(ENDPOINT, "HTTP 410");

      expect(result).toBe(false);
      expect(transactionMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(updateUNCMock).not.toHaveBeenCalled();
    });
  });

  describe("recordSuccessfulDelivery", () => {
    it("updates lastSuccessAt", async () => {
      updateMock.mockResolvedValue({});

      await recordSuccessfulDelivery(ENDPOINT);

      expect(updateMock).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT },
        data: { lastSuccessAt: expect.any(Date) },
      });
    });

    it("swallows errors when subscription deleted in race", async () => {
      updateMock.mockRejectedValue(new Error("Record not found"));

      await expect(recordSuccessfulDelivery(ENDPOINT)).resolves.toBeUndefined();
    });
  });

  describe("subscribeUser", () => {
    const VALID_INPUT = {
      endpoint: ENDPOINT,
      keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      userAgent: "Chrome 120",
    };

    it("creates UNC with priority=100 + WebPushSubscription when first subscription", async () => {
      findUniqueMock.mockResolvedValue(null); // не существует
      aggregateUNCMock.mockResolvedValue({ _max: { priority: null } });
      upsertUNCMock.mockResolvedValue({ id: "unc-new" });
      upsertMock.mockResolvedValue({
        id: "sub-new",
        userId: "user-1",
        endpoint: ENDPOINT,
        p256dh: "p256dh-key",
        auth: "auth-secret",
        userAgent: "Chrome 120",
        isActive: true,
        userNotificationChannelId: "unc-new",
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await subscribeUser("user-1", VALID_INPUT);

      expect(result.id).toBe("sub-new");
      expect(upsertUNCMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: "user-1",
            kind: "PUSH",
            address: ENDPOINT,
            priority: 100,
            isActive: true,
          }),
        }),
      );
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: ENDPOINT },
          create: expect.objectContaining({
            userId: "user-1",
            endpoint: ENDPOINT,
            p256dh: "p256dh-key",
            auth: "auth-secret",
            isActive: true,
          }),
        }),
      );
    });

    it("uses priority = max+1 when user already has PUSH channels", async () => {
      findUniqueMock.mockResolvedValue(null);
      aggregateUNCMock.mockResolvedValue({ _max: { priority: 102 } });
      upsertUNCMock.mockResolvedValue({ id: "unc-3" });
      upsertMock.mockResolvedValue({
        id: "sub-3",
        userId: "user-1",
        endpoint: ENDPOINT,
        p256dh: "p256dh-key",
        auth: "auth-secret",
        userAgent: "Chrome 120",
        isActive: true,
        userNotificationChannelId: "unc-3",
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await subscribeUser("user-1", VALID_INPUT);

      expect(upsertUNCMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ priority: 103 }),
        }),
      );
    });

    it("reactivates existing inactive subscription of the same user", async () => {
      findUniqueMock.mockResolvedValue({ userId: "user-1" });
      aggregateUNCMock.mockResolvedValue({ _max: { priority: 100 } });
      upsertUNCMock.mockResolvedValue({ id: "unc-existing" });
      upsertMock.mockResolvedValue({
        id: "sub-existing",
        userId: "user-1",
        endpoint: ENDPOINT,
        p256dh: "p256dh-key",
        auth: "auth-secret",
        userAgent: "Chrome 120",
        isActive: true,
        userNotificationChannelId: "unc-existing",
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        lastFailureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await subscribeUser("user-1", VALID_INPUT);

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            isActive: true,
            p256dh: "p256dh-key",
            auth: "auth-secret",
            lastFailureReason: null,
          }),
        }),
      );
    });

    it("throws WebPushSubscriptionConflictError when endpoint owned by another user", async () => {
      findUniqueMock.mockResolvedValue({ userId: "user-OTHER" });

      await expect(subscribeUser("user-1", VALID_INPUT)).rejects.toBeInstanceOf(
        WebPushSubscriptionConflictError,
      );
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribeUser", () => {
    it("happy path: deactivates subscription and returns alreadyInactive=false", async () => {
      // 1st findUnique: ownership check (active, owned)
      findUniqueMock.mockResolvedValueOnce({ userId: "user-1", isActive: true });
      // 2nd findUnique: inside deactivateSubscriptionByEndpoint
      findUniqueMock.mockResolvedValueOnce({
        id: "sub-1",
        userNotificationChannelId: "unc-1",
      });

      const result = await unsubscribeUser("user-1", ENDPOINT);

      expect(result).toEqual({ alreadyInactive: false });
      expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it("idempotent: returns alreadyInactive=true when subscription not found", async () => {
      findUniqueMock.mockResolvedValueOnce(null);

      const result = await unsubscribeUser("user-1", ENDPOINT);

      expect(result).toEqual({ alreadyInactive: true });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("idempotent: returns alreadyInactive=true when subscription belongs to another user", async () => {
      // Не утечка: для чужой подписки тоже отвечаем alreadyInactive=true.
      findUniqueMock.mockResolvedValueOnce({
        userId: "user-OTHER",
        isActive: true,
      });

      const result = await unsubscribeUser("user-1", ENDPOINT);

      expect(result).toEqual({ alreadyInactive: true });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("idempotent: returns alreadyInactive=true when subscription already inactive", async () => {
      findUniqueMock.mockResolvedValueOnce({
        userId: "user-1",
        isActive: false,
      });

      const result = await unsubscribeUser("user-1", ENDPOINT);

      expect(result).toEqual({ alreadyInactive: true });
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });

  describe("toPublicWebPushSubscription", () => {
    it("never leaks p256dh / auth crypto secrets", async () => {
      const now = new Date();
      const sub = {
        id: "sub-1",
        userId: "user-1",
        userNotificationChannelId: "unc-1",
        endpoint: ENDPOINT,
        p256dh: "SECRET-P256DH-PUBLIC-KEY",
        auth: "SECRET-AUTH-SECRET",
        userAgent: "Chrome 120",
        isActive: true,
        lastSuccessAt: now,
        lastFailureAt: null,
        lastFailureReason: null,
        createdAt: now,
        updatedAt: now,
      };

      // Cast to satisfy WebPushSubscription type — fields above match Prisma model.
      const dto = toPublicWebPushSubscription(sub as Parameters<typeof toPublicWebPushSubscription>[0]);

      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain("SECRET-P256DH-PUBLIC-KEY");
      expect(serialized).not.toContain("SECRET-AUTH-SECRET");
      expect(serialized).not.toContain("p256dh");
      expect(serialized).not.toContain("auth");
      // Sanity: non-secret fields are present
      expect(dto.id).toBe("sub-1");
      expect(dto.endpoint).toBe(ENDPOINT);
      expect(dto.userAgent).toBe("Chrome 120");
      expect(dto.isActive).toBe(true);
    });
  });
});
