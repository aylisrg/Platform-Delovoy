import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    deletionLog: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    systemEvent: { create: vi.fn() },
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}));

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  authorizeSuperadminDeletion,
  verifyUserPassword,
  logDeletion,
} from "@/lib/deletion";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("verifyUserPassword", () => {
  it("returns INVALID when password is empty", async () => {
    const r = await verifyUserPassword("u1", "");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INVALID");
  });

  it("returns USER_NOT_FOUND if user is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const r = await verifyUserPassword("u1", "pw");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("USER_NOT_FOUND");
  });

  it("returns NO_PASSWORD if the user has no hash (social-only)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: null } as never);
    const r = await verifyUserPassword("u1", "pw");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_PASSWORD");
  });

  it("returns ok when bcrypt matches", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: "$2a$hash" } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    const r = await verifyUserPassword("u1", "pw");
    expect(r.ok).toBe(true);
  });

  it("returns INVALID when bcrypt mismatches", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: "$2a$hash" } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
    const r = await verifyUserPassword("u1", "wrong");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INVALID");
  });
});

describe("authorizeSuperadminDeletion", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = makeRequest({ password: "x" });
    const result = await authorizeSuperadminDeletion(req, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects ADMIN with 403 FORBIDDEN — ADMIN has no delete rights", async () => {
    const req = makeRequest({ password: "x" });
    const session = { user: { id: "a1", role: "ADMIN" } };
    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects MANAGER with 403 FORBIDDEN even with a correct password", async () => {
    const req = makeRequest({ password: "whatever" });
    const session = { user: { id: "m1", role: "MANAGER" } };
    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    // Password check should be short-circuited — bcrypt is never called.
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects USER with 403 FORBIDDEN", async () => {
    const req = makeRequest({ password: "whatever" });
    const session = { user: { id: "u1", role: "USER" } };
    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("rejects SUPERADMIN without password (422 PASSWORD_REQUIRED)", async () => {
    const req = makeRequest({});
    const session = { user: { id: "sa", role: "SUPERADMIN" } };
    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(422);
      const body = await result.response.json();
      expect(body.error.code).toBe("PASSWORD_REQUIRED");
    }
  });

  it("rejects SUPERADMIN with wrong password (403 INVALID_PASSWORD) and logs a WARNING", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: "$2a$hash" } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const req = makeRequest(
      { password: "wrong" },
      { "x-forwarded-for": "10.0.0.1" }
    );
    const session = { user: { id: "sa", role: "SUPERADMIN", email: "s@x.com" } };
    const result = await authorizeSuperadminDeletion(req, session);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error.code).toBe("INVALID_PASSWORD");
    }
    expect(prisma.systemEvent.create).toHaveBeenCalledTimes(1);
  });

  it("rejects SUPERADMIN without a password hash (409 PASSWORD_NOT_SET)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: null } as never);

    const req = makeRequest({ password: "anything" });
    const session = { user: { id: "sa", role: "SUPERADMIN" } };
    const result = await authorizeSuperadminDeletion(req, session);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      const body = await result.response.json();
      expect(body.error.code).toBe("PASSWORD_NOT_SET");
    }
  });

  it("authorises SUPERADMIN with correct password and captures ip + ua + reason", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: "$2a$hash" } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);

    const req = makeRequest(
      { password: "correct", reason: "  тестовая причина  " },
      { "x-forwarded-for": "1.2.3.4, 9.9.9.9", "user-agent": "vitest" }
    );
    const session = {
      user: { id: "sa", role: "SUPERADMIN", email: "s@x.com", name: "Super" },
    };

    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.id).toBe("sa");
      expect(result.actor.email).toBe("s@x.com");
      expect(result.reason).toBe("тестовая причина");
      expect(result.ipAddress).toBe("1.2.3.4");
      expect(result.userAgent).toBe("vitest");
    }
  });

  it("rejects malformed JSON body with 422", async () => {
    const req = new NextRequest("http://localhost/api/x", {
      method: "DELETE",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const session = { user: { id: "sa", role: "SUPERADMIN" } };
    const result = await authorizeSuperadminDeletion(req, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(422);
  });
});

describe("logDeletion", () => {
  const authzOk = {
    ok: true as const,
    actor: { id: "sa", role: "SUPERADMIN", email: "s@x.com", name: "Super" },
    reason: "authz-reason",
    ipAddress: "1.2.3.4",
    userAgent: "vitest",
  };

  it("writes both DeletionLog and mirror AuditLog entries", async () => {
    vi.mocked(prisma.deletionLog.create).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as never);

    await logDeletion(authzOk, {
      entity: "Booking",
      entityId: "b1",
      entityLabel: "label",
      moduleSlug: "gazebos",
      snapshot: { id: "b1", clientName: "X" },
      reason: null,
    });

    expect(prisma.deletionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

    const call = vi.mocked(prisma.deletionLog.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.entity).toBe("Booking");
    expect(call.data.entityId).toBe("b1");
    expect(call.data.moduleSlug).toBe("gazebos");
    expect(call.data.deletionType).toBe("SOFT");
    expect(call.data.userId).toBe("sa");
    expect(call.data.userEmail).toBe("s@x.com");
    // Falls back to auth.reason when ctx.reason is null
    expect(call.data.reason).toBe("authz-reason");
  });

  it("never throws even if DeletionLog insert fails — surfaces via SystemEvent", async () => {
    vi.mocked(prisma.deletionLog.create).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.systemEvent.create).mockResolvedValueOnce({} as never);

    await expect(
      logDeletion(authzOk, {
        entity: "MenuItem",
        entityId: "m1",
        snapshot: { id: "m1" },
      })
    ).resolves.toBeUndefined();

    expect(prisma.systemEvent.create).toHaveBeenCalledTimes(1);
  });
});
