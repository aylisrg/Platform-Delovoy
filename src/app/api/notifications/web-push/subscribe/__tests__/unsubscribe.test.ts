import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  authMock,
  rateLimitMock,
  unsubscribeUserMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn().mockResolvedValue(null),
  unsubscribeUserMock: vi.fn(),
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
    unsubscribeUser: (...args: unknown[]) => unsubscribeUserMock(...args),
  };
});

import { DELETE } from "../route";

const VALID_PUB =
  "BPzS3w7m9eWWyqL0kU7-VhJxIv6dTeHJ3kK9fOaTYz5XoEN3hbcdvIwZ4n7QqlQ8aS6_xY9KZUq2H8eGfX1jLhM";
const VALID_PRIV = "k6n8Q3nYx_z2fYqXnTpRbGeUu9MjOoP1qAwS3Vd5Hjk";
const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123xyz";

function makeReq(body: unknown, queryEndpoint?: string): NextRequest {
  const url = new URL("http://localhost/api/notifications/web-push/subscribe");
  if (queryEndpoint) url.searchParams.set("endpoint", queryEndpoint);
  return {
    headers: { get: () => "127.0.0.1" },
    nextUrl: url,
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

describe("DELETE /api/notifications/web-push/subscribe", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
    enableWebPush();
    authMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue(null);
    unsubscribeUserMock.mockReset();
    auditLogCreateMock.mockReset();
    auditLogCreateMock.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = ORIGINAL;
    vi.clearAllMocks();
  });

  it("503 when web push disabled", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(503);
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
  });

  it("503 when web push disabled — even without auth (flag check is BEFORE auth)", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    authMock.mockResolvedValue(null);

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(503);
    expect(authMock).not.toHaveBeenCalled();
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
  });

  it("401 when not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(401);
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
  });

  it("happy path: deactivates and writes AuditLog", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    unsubscribeUserMock.mockResolvedValue({ alreadyInactive: false });

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ok: true, alreadyInactive: false });
    expect(unsubscribeUserMock).toHaveBeenCalledWith("user-1", FCM_ENDPOINT);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "notification.web-push.unsubscribe",
        entity: "WebPushSubscription",
        metadata: { endpointHost: "fcm.googleapis.com" },
      }),
    });
  });

  it("idempotent: 200 alreadyInactive=true when subscription not found, no AuditLog", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    unsubscribeUserMock.mockResolvedValue({ alreadyInactive: true });

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ok: true, alreadyInactive: true });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("accepts endpoint via query param", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
    unsubscribeUserMock.mockResolvedValue({ alreadyInactive: false });

    const res = await DELETE(makeReq(null, FCM_ENDPOINT));

    expect(res.status).toBe(200);
    expect(unsubscribeUserMock).toHaveBeenCalledWith("user-1", FCM_ENDPOINT);
  });

  it("422 when endpoint missing or invalid", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await DELETE(makeReq({}));

    expect(res.status).toBe(422);
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
  });

  it("422 when endpoint host not in SSRF allowlist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });

    const res = await DELETE(
      makeReq({ endpoint: "https://evil.example.com/push/abc" }),
    );

    expect(res.status).toBe(422);
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
  });

  it("403 when USER role", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("FORBIDDEN");
    expect(unsubscribeUserMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("uses web-push-subscribe rate-limit tier keyed per-user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-77", role: "MANAGER" } });
    unsubscribeUserMock.mockResolvedValue({ alreadyInactive: false });

    await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "web-push-subscribe",
      "user-77",
    );
  });
});
