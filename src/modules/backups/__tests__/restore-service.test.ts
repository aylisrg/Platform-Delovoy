import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    backupLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    set: vi.fn(),
    del: vi.fn(),
  },
}));

import { planRestore, finaliseRestore, RestoreError } from "../restore-service";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

type MockPrisma = {
  backupLog: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};
type MockRedis = {
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};
const mp = prisma as unknown as MockPrisma;
const mr = redis as unknown as MockRedis;

const validToken = "valid-token-xxxxx";
const truthyVerify = vi.fn(async () => true);
const falsyVerify = vi.fn(async () => false);

const validBackup = {
  id: "bk_1",
  status: "SUCCESS",
  sizeBytes: BigInt(1024 * 1024),
  storagePath: "s3://x/daily/y.sql.gz",
};

beforeEach(() => {
  vi.clearAllMocks();
  truthyVerify.mockClear();
  falsyVerify.mockClear();
});

describe("planRestore — validation paths", () => {
  it("throws BACKUP_NOT_FOUND when backup missing", async () => {
    mp.backupLog.findUnique.mockResolvedValue(null);
    await expect(
      planRestore(
        {
          backupId: "missing",
          scope: "full",
          dryRun: true,
          confirmToken: validToken,
        },
        { performedById: "u1", verifyConfirmToken: truthyVerify }
      )
    ).rejects.toBeInstanceOf(RestoreError);
  });

  it("throws BACKUP_NOT_FOUND when backup status != SUCCESS", async () => {
    mp.backupLog.findUnique.mockResolvedValue({
      ...validBackup,
      status: "FAILED",
    });
    await expect(
      planRestore(
        {
          backupId: "bk_1",
          scope: "full",
          dryRun: true,
          confirmToken: validToken,
        },
        { performedById: "u1", verifyConfirmToken: truthyVerify }
      )
    ).rejects.toHaveProperty("code", "BACKUP_NOT_FOUND");
  });

  it("throws CONFIRM_TOKEN_INVALID on bad token", async () => {
    mp.backupLog.findUnique.mockResolvedValue(validBackup);
    await expect(
      planRestore(
        {
          backupId: "bk_1",
          scope: "full",
          dryRun: true,
          confirmToken: "nope-ever",
        },
        { performedById: "u1", verifyConfirmToken: falsyVerify }
      )
    ).rejects.toHaveProperty("code", "CONFIRM_TOKEN_INVALID");
  });
});

describe("planRestore — PARTIAL backup (S3 upload failed)", () => {
  const partialBackup = {
    id: "bk_partial",
    status: "PARTIAL",
    sizeBytes: BigInt(512 * 1024),
    storagePath: "/opt/backups/postgres/daily/delovoy_park_DAILY_20260421_020000.dump",
  };

  it("allows dry-run restore from PARTIAL backup but attaches warning", async () => {
    mp.backupLog.findUnique.mockResolvedValue(partialBackup);
    mp.backupLog.create.mockResolvedValue({
      id: "log_partial_dry",
      status: "SUCCESS",
    });

    const result = await planRestore(
      {
        backupId: "bk_partial",
        scope: "record",
        dryRun: true,
        confirmToken: validToken,
        target: {
          scope: "record",
          table: "Booking",
          primaryKey: { id: "b1" },
          upsert: true,
        },
      },
      { performedById: "u1", verifyConfirmToken: truthyVerify }
    );

    expect(result.dryRun).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/PARTIAL/);
    expect(result.warning).toMatch(/локально|VPS/);
    expect(result.message).toMatch(/PARTIAL/);
  });

  it("allows real restore from PARTIAL backup and surfaces warning", async () => {
    mp.backupLog.findUnique.mockResolvedValue(partialBackup);
    mr.set.mockResolvedValue("OK");
    mp.backupLog.create.mockResolvedValue({
      id: "log_partial_real",
      status: "IN_PROGRESS",
    });

    const result = await planRestore(
      {
        backupId: "bk_partial",
        scope: "full",
        dryRun: false,
        confirmToken: validToken,
      },
      { performedById: "u1", verifyConfirmToken: truthyVerify }
    );

    expect(result.status).toBe("IN_PROGRESS");
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/PARTIAL/);
    expect(result.message).toMatch(/PARTIAL/);
  });

  it("rejects restore from FAILED backup (status not SUCCESS or PARTIAL)", async () => {
    mp.backupLog.findUnique.mockResolvedValue({
      ...partialBackup,
      status: "FAILED",
    });
    await expect(
      planRestore(
        {
          backupId: "bk_failed",
          scope: "full",
          dryRun: true,
          confirmToken: validToken,
        },
        { performedById: "u1", verifyConfirmToken: truthyVerify }
      )
    ).rejects.toHaveProperty("code", "BACKUP_NOT_FOUND");
  });

  it("rejects restore from IN_PROGRESS backup", async () => {
    mp.backupLog.findUnique.mockResolvedValue({
      ...partialBackup,
      status: "IN_PROGRESS",
    });
    await expect(
      planRestore(
        {
          backupId: "bk_inprog",
          scope: "full",
          dryRun: true,
          confirmToken: validToken,
        },
        { performedById: "u1", verifyConfirmToken: truthyVerify }
      )
    ).rejects.toHaveProperty("code", "BACKUP_NOT_FOUND");
  });
});

describe("planRestore — dry run", () => {
  it("creates RESTORE log with dryRun metadata, no Redis lock", async () => {
    mp.backupLog.findUnique.mockResolvedValue(validBackup);
    mp.backupLog.create.mockResolvedValue({
      id: "log_1",
      status: "SUCCESS",
    });

    const result = await planRestore(
      {
        backupId: "bk_1",
        scope: "record",
        dryRun: true,
        confirmToken: validToken,
        target: {
          scope: "record",
          table: "Booking",
          primaryKey: { id: "b1" },
          upsert: true,
        },
      },
      { performedById: "u1", verifyConfirmToken: truthyVerify }
    );

    expect(result.dryRun).toBe(true);
    expect(result.status).toBe("SUCCESS");
    expect(mr.set).not.toHaveBeenCalled();

    const createArgs = mp.backupLog.create.mock.calls[0][0].data;
    expect(createArgs.scope).toBe("RECORD");
    expect(createArgs.targetTable).toBe("Booking");
    expect(createArgs.status).toBe("SUCCESS");
  });
});

describe("planRestore — real run", () => {
  it("acquires Redis lock and creates IN_PROGRESS log", async () => {
    mp.backupLog.findUnique.mockResolvedValue(validBackup);
    mr.set.mockResolvedValue("OK");
    mp.backupLog.create.mockResolvedValue({
      id: "log_2",
      status: "IN_PROGRESS",
    });

    const result = await planRestore(
      {
        backupId: "bk_1",
        scope: "full",
        dryRun: false,
        confirmToken: validToken,
      },
      { performedById: "u1", verifyConfirmToken: truthyVerify }
    );

    expect(mr.set).toHaveBeenCalledWith(
      "restore:active",
      expect.any(String),
      "EX",
      expect.any(Number),
      "NX"
    );
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.estimatedSeconds).toBeGreaterThanOrEqual(30);
  });

  it("throws RESTORE_IN_PROGRESS when Redis lock held", async () => {
    mp.backupLog.findUnique.mockResolvedValue(validBackup);
    mr.set.mockResolvedValue(null); // lock held

    await expect(
      planRestore(
        {
          backupId: "bk_1",
          scope: "full",
          dryRun: false,
          confirmToken: validToken,
        },
        { performedById: "u1", verifyConfirmToken: truthyVerify }
      )
    ).rejects.toHaveProperty("code", "RESTORE_IN_PROGRESS");
  });
});

describe("finaliseRestore", () => {
  it("updates BackupLog and releases the lock", async () => {
    mp.backupLog.update.mockResolvedValue({});
    mr.del.mockResolvedValue(1);

    await finaliseRestore("log_1", {
      status: "SUCCESS",
      affectedRows: 42,
      durationMs: 2500,
    });

    expect(mp.backupLog.update).toHaveBeenCalledWith({
      where: { id: "log_1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        affectedRows: 42,
        durationMs: 2500,
        completedAt: expect.any(Date),
      }),
    });
    expect(mr.del).toHaveBeenCalledWith("restore:active");
  });
});
