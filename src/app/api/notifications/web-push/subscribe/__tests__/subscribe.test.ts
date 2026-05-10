import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  authMock,
  rateLimitMock,
  subscribeUserMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn().mockResolvedValue(null),
  subscribeUserMock: vi.fn(),
  auditLogCreateMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: (...args: unknown[]) => auditLogCreateMock(...args) },
  },
}));

vi.mock("@/modules/notifications/dispatch/channels/web-push/service", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/notifications/dispatch/channels/web-push/service")
  >("@/modules/notifications/dispatch/channels/web-push/service");
  return {
    ...actual,
    subscribeUser: (...args: unknown[]) => subscribeUserMock(...args),
  };
});

import { POST } from "../route";
import { WebPushSubscriptionConflictError } from "@/modules/notifications/dispatch/channels/web-push/service";

const VALID_PUB =
  "BPzS3w7m9eWWyqL0kU7-VhJxIv6dTeHJ3kK9fOaTYz5XoEN3hbcdvIwZ4n7QqlQ8aS6_xY9KZUq2H8eGfX1jLhM";
const VALID_PRIV = "k6n8Q3nYx_z2fYqXnTpRbGeUu9MjOoP1qAwS3Vd5Hjk";
const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123xyz";

function makeReq(body: unknown): NextRequest {
  return {
    headers: { get: () => "127.0.0.1" },
    nextUrl: new URL("http://localhost/api/notifications/web-push/subscribe"),
    json: async () => body,
  } as unknown as NextRequest;
}

function enableWebPush() {
  process.env.WEB_PUSH_ENABLED = "true";
  process.env.VAPID_PUBLIC_KEY = VALID_PUB;
  process.env.VAPID_PRIVATE_KEY = VALID_PRIV;
  process.env.VAPID_SUBJECT = "mailto:admin@delovoy-park.ru";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VALID_PUB;
}

describe("POST /api/notifications/web-push/subscribe", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
    enableWebPush();
    authMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue(null);
    subscribeUserMock.mockReset();
    auditLogCreateMock.mockReset();
    auditLogCreateMock.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = ORIGINAL;
    vi.clearAllMocks();
  });

  it("401 when not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(401);
    expect(subscribeUserMock).not.toHaveBeenCalled();
  });

  it("503 when web push disabled", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(503);
    expect(subscribeUserMock).not.toHaveBeenCalled();
  });

  it("503 when web push disabled — even without auth (flag check is BEFORE auth)", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    authMock.mockResolvedValue(null);

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(503);
    expect(authMock).not.toHaveBeenCalled();
    expect(subscribeUserMock).not.toHaveBeenCalled();
  });

  it("403 when USER role — Web Push not available for USER", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("FORBIDDEN");
    expect(subscribeUserMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("uses web-push-subscribe rate-limit tier keyed per-user (10/min)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-42", role: "MANAGER" } });
    subscribeUserMock.mockResolvedValue({
      id: "sub-1",
      userId: "user-42",
      endpoint: FCM_ENDPOINT,
      p256dh: "x",
      auth: "y",
      userAgent: null,
      isActive: true,
      userNotificationChannelId: "unc-1",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "web-push-subscribe",
      "user-42",
    );
  });

  it("returns 429 when rate limit exceeded", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    rateLimitMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "x" } }),
        { status: 429 },
      ),
    );

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(429);
    expect(subscribeUserMock).not.toHaveBeenCalled();
  });

  it("happy path: creates subscription, writes AuditLog, doesn't leak p256dh/auth", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    subscribeUserMock.mockResolvedValue({
      id: "sub-1",
      userId: "user-1",
      endpoint: FCM_ENDPOINT,
      p256dh: "SECRET-P256",
      auth: "SECRET-AUTH",
      userAgent: "Chrome 120",
      isActive: true,
      userNotificationChannelId: "unc-1",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p256-key", auth: "auth-key" },
        userAgent: "Chrome 120",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.subscription.id).toBe("sub-1");
    expect(json.data.subscription.endpoint).toBe(FCM_ENDPOINT);
    // никаких криптоключей в ответе
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("SECRET-P256");
    expect(serialized).not.toContain("SECRET-AUTH");
    expect(serialized).not.toContain("p256dh");
    // AuditLog
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "notification.web-push.subscribe",
        entity: "WebPushSubscription",
        entityId: "sub-1",
        metadata: expect.objectContaining({
          endpointHost: "fcm.googleapis.com",
        }),
      }),
    });
  });

  it("422 SSRF: endpoint host not in allowlist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await POST(
      makeReq({
        endpoint: "https://evil.com/push/abc",
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(422);
    expect(subscribeUserMock).not.toHaveBeenCalled();
  });

  it("422 when body invalid (missing keys)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await POST(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(422);
  });

  it("409 when endpoint owned by another user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    subscribeUserMock.mockRejectedValue(new WebPushSubscriptionConflictError());

    const res = await POST(
      makeReq({
        endpoint: FCM_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("SUBSCRIPTION_CONFLICT");
  });
});
