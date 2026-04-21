import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/modules/backups/restore-service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/backups/restore-service")>(
    "@/modules/backups/restore-service"
  );
  return {
    planRestore: vi.fn(),
    // Preserve RestoreError class for instanceof checks in the route
    RestoreError: actual.RestoreError,
  };
});

vi.mock("@/modules/backups/notify", () => ({
  notifyRestore: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

import { GET, POST } from "../route";
import { auth } from "@/lib/auth";
import { planRestore, RestoreError } from "@/modules/backups/restore-service";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockPlan = planRestore as unknown as ReturnType<typeof vi.fn>;
const mockRedisSet = (redis as unknown as { set: ReturnType<typeof vi.fn> }).set;
const mockAuditCreate = (
  prisma as unknown as { auditLog: { create: ReturnType<typeof vi.fn> } }
).auditLog.create;

beforeEach(() => {
  vi.clearAllMocks();
});

function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/backups/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/backups/restore — confirm token issuance", () => {
  it("401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403 for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("issues token for SUPERADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } });
    mockRedisSet.mockResolvedValue("OK");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.confirmToken).toMatch(/^[a-f0-9]{48}$/);
    expect(body.data.expiresInSeconds).toBeGreaterThan(0);
    expect(mockRedisSet).toHaveBeenCalled();
  });
});

describe("POST /api/admin/backups/restore", () => {
  it("401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(
      postReq({ backupId: "bk_1", scope: "full", confirmToken: "xxxxxxxx" })
    );
    expect(res.status).toBe(401);
  });

  it("403 for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    const res = await POST(
      postReq({ backupId: "bk_1", scope: "full", confirmToken: "xxxxxxxx" })
    );
    expect(res.status).toBe(403);
  });

  it("422 on invalid body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } });
    const res = await POST(postReq({ backupId: "bk_1" }));
    expect(res.status).toBe(422);
  });

  it("200 on successful dry-run + writes AuditLog", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockPlan.mockResolvedValue({
      jobId: "log_1",
      backupLogId: "log_1",
      status: "SUCCESS",
      dryRun: true,
    });

    const res = await POST(
      postReq({
        backupId: "bk_1",
        scope: "full",
        dryRun: true,
        confirmToken: "xxxxxxxx",
      })
    );
    expect(res.status).toBe(200);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "backup.restore.dryrun",
        entity: "BackupLog",
        entityId: "log_1",
      }),
    });
  });

  it("202 on planned real restore", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockPlan.mockResolvedValue({
      jobId: "log_2",
      backupLogId: "log_2",
      status: "IN_PROGRESS",
      estimatedSeconds: 60,
    });

    const res = await POST(
      postReq({
        backupId: "bk_1",
        scope: "full",
        dryRun: false,
        confirmToken: "xxxxxxxx",
      })
    );
    expect(res.status).toBe(202);
  });

  it("409 when RESTORE_IN_PROGRESS", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockPlan.mockRejectedValue(
      new RestoreError("RESTORE_IN_PROGRESS", "busy")
    );
    const res = await POST(
      postReq({
        backupId: "bk_1",
        scope: "full",
        dryRun: false,
        confirmToken: "xxxxxxxx",
      })
    );
    expect(res.status).toBe(409);
  });

  it("404 when BACKUP_NOT_FOUND", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockPlan.mockRejectedValue(
      new RestoreError("BACKUP_NOT_FOUND", "nope")
    );
    const res = await POST(
      postReq({
        backupId: "bk_missing",
        scope: "full",
        dryRun: true,
        confirmToken: "xxxxxxxx",
      })
    );
    expect(res.status).toBe(404);
  });

  it("422 on CONFIRM_TOKEN_INVALID", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    mockPlan.mockRejectedValue(
      new RestoreError("CONFIRM_TOKEN_INVALID", "stale")
    );
    const res = await POST(
      postReq({
        backupId: "bk_1",
        scope: "full",
        dryRun: false,
        confirmToken: "xxxxxxxx",
      })
    );
    expect(res.status).toBe(422);
  });
});
