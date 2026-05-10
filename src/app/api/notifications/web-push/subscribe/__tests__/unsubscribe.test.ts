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

describe("DELETE /api/notifications/web-push/subscribe", () => {
  beforeEach(() => {
    authMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue(null);
    unsubscribeUserMock.mockReset();
    auditLogCreateMock.mockReset();
    auditLogCreateMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
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
});
