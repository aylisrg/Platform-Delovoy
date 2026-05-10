import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_PUBLIC =
  "BJxQyKlF7sNqnG_1k0sM7G6yY3W4-r_lDxsRl6Hf-LhxN1AKr-MMSvEnX9YRs0aBcDe1xT_yU7B6oJyP0wRz3qg";
const VALID_PRIVATE = "abcdefghijklmnopqrstuvwxyz0123456789ABCD-_";

const enabledEnv = {
  WEB_PUSH_ENABLED: "true",
  VAPID_PUBLIC_KEY: VALID_PUBLIC,
  VAPID_PRIVATE_KEY: VALID_PRIVATE,
  VAPID_SUBJECT: "mailto:admin@delovoy-park.ru",
};

// Mocks must be hoisted — vi.mock factory runs before imports.
const {
  sendNotificationMock,
  setVapidDetailsMock,
  findUniqueMock,
  updateMock,
  updateUNCMock,
  transactionMock,
} = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  updateUNCMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
  setVapidDetails: setVapidDetailsMock,
  sendNotification: sendNotificationMock,
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

import { WebPushChannel } from "../index";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const ACTIVE_SUB = {
  endpoint: ENDPOINT,
  p256dh: "BPublic",
  auth: "AuthSecret",
  isActive: true,
};

describe("WebPushChannel", () => {
  beforeEach(() => {
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateUNCMock.mockReset();
    transactionMock.mockReset();
    // $transaction implementation: invoke callback with a tx that proxies to mocks
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

  describe("isAvailable", () => {
    it("false when WEB_PUSH_ENABLED is unset", () => {
      const ch = new WebPushChannel({});
      expect(ch.isAvailable()).toBe(false);
    });

    it("true when env fully configured", () => {
      const ch = new WebPushChannel(enabledEnv);
      expect(ch.isAvailable()).toBe(true);
    });
  });

  describe("send", () => {
    it("returns ok=false retryable=false when channel disabled", async () => {
      const ch = new WebPushChannel({});
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.retryable).toBe(false);
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });

    it("returns ok=false when subscription not found", async () => {
      findUniqueMock.mockResolvedValue(null);
      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.retryable).toBe(false);
        expect(r.reason).toMatch(/not found/);
      }
    });

    it("returns ok=false when subscription is inactive", async () => {
      findUniqueMock.mockResolvedValue({ ...ACTIVE_SUB, isActive: false });
      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });
      expect(r.ok).toBe(false);
    });

    it("happy path: sends payload with TTL/urgency and records success", async () => {
      findUniqueMock.mockResolvedValue(ACTIVE_SUB);
      sendNotificationMock.mockResolvedValue({ statusCode: 201, headers: {} });

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, {
        title: "Сессия просрочена",
        body: "Стол №3 — 10 минут",
        actions: [{ label: "Открыть", url: "/admin/ps-park" }],
      });

      expect(r.ok).toBe(true);
      expect(setVapidDetailsMock).toHaveBeenCalledWith(
        "mailto:admin@delovoy-park.ru",
        VALID_PUBLIC,
        VALID_PRIVATE,
      );
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
      const [keys, body, opts] = sendNotificationMock.mock.calls[0];
      expect(keys).toEqual({
        endpoint: ENDPOINT,
        keys: { p256dh: "BPublic", auth: "AuthSecret" },
      });
      const parsed = JSON.parse(body as string);
      expect(parsed.title).toBe("Сессия просрочена");
      expect(parsed.actions).toHaveLength(1);
      expect(opts).toEqual({ TTL: 60, urgency: "high" });

      // recordSuccessfulDelivery
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: ENDPOINT },
          data: expect.objectContaining({ lastSuccessAt: expect.any(Date) }),
        }),
      );
    });

    it("HTTP 410 Gone deactivates subscription and UNC", async () => {
      findUniqueMock.mockResolvedValue(ACTIVE_SUB);
      // First findUnique = ACTIVE_SUB (channel send), then service.deactivate calls findUnique
      // We need to support a second findUnique call inside deactivateSubscriptionByEndpoint:
      findUniqueMock
        .mockResolvedValueOnce(ACTIVE_SUB)
        .mockResolvedValueOnce({
          id: "sub-1",
          userNotificationChannelId: "unc-1",
        });
      const err = Object.assign(new Error("Gone"), { statusCode: 410 });
      sendNotificationMock.mockRejectedValue(err);

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.retryable).toBe(false);
        expect(r.reason).toMatch(/expired/);
      }
      // transaction called for atomic deactivation
      expect(transactionMock).toHaveBeenCalledTimes(1);
      // both UNC and sub were updated within the tx callback
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: ENDPOINT },
          data: expect.objectContaining({
            isActive: false,
            lastFailureReason: "HTTP 410",
          }),
        }),
      );
      expect(updateUNCMock).toHaveBeenCalledWith({
        where: { id: "unc-1" },
        data: { isActive: false },
      });
    });

    it("HTTP 404 Not Found also deactivates subscription", async () => {
      findUniqueMock
        .mockResolvedValueOnce(ACTIVE_SUB)
        .mockResolvedValueOnce({
          id: "sub-1",
          userNotificationChannelId: "unc-1",
        });
      const err = Object.assign(new Error("Not Found"), { statusCode: 404 });
      sendNotificationMock.mockRejectedValue(err);

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.retryable).toBe(false);
      expect(transactionMock).toHaveBeenCalled();
    });

    it("HTTP 401 (VAPID mismatch) deactivates subscription, not retryable", async () => {
      findUniqueMock
        .mockResolvedValueOnce(ACTIVE_SUB)
        .mockResolvedValueOnce({
          id: "sub-1",
          userNotificationChannelId: "unc-1",
        });
      const err = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      sendNotificationMock.mockRejectedValue(err);

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.retryable).toBe(false);
        expect(r.reason).toMatch(/auth/);
      }
    });

    it("HTTP 500 is retryable, does NOT deactivate subscription", async () => {
      findUniqueMock.mockResolvedValueOnce(ACTIVE_SUB);
      const err = Object.assign(new Error("Server Error"), { statusCode: 500 });
      sendNotificationMock.mockRejectedValue(err);

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.retryable).toBe(true);
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("HTTP 429 is retryable", async () => {
      findUniqueMock.mockResolvedValueOnce(ACTIVE_SUB);
      const err = Object.assign(new Error("Too Many"), { statusCode: 429 });
      sendNotificationMock.mockRejectedValue(err);

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.retryable).toBe(true);
    });

    it("unknown error without statusCode is not retryable", async () => {
      findUniqueMock.mockResolvedValueOnce(ACTIVE_SUB);
      sendNotificationMock.mockRejectedValue(new Error("network drama"));

      const ch = new WebPushChannel(enabledEnv);
      const r = await ch.send(ENDPOINT, { title: "t", body: "b" });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.retryable).toBe(false);
        expect(r.reason).toBe("network drama");
      }
    });
  });
});
