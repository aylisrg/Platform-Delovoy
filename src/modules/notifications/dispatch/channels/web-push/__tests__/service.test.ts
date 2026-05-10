import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — vi.mock factory runs before imports.
const {
  findUniqueMock,
  updateMock,
  updateUNCMock,
  transactionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  updateUNCMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webPushSubscription: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    userNotificationChannel: {
      update: (...args: unknown[]) => updateUNCMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import {
  deactivateSubscriptionByEndpoint,
  recordSuccessfulDelivery,
  toPublicWebPushSubscription,
} from "../service";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

describe("web-push service", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateUNCMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)({
          webPushSubscription: { update: updateMock },
          userNotificationChannel: { update: updateUNCMock },
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
