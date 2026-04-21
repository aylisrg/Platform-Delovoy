import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    backupLog: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import {
  createBackupLog,
  markBackupStatus,
  listBackups,
  getBackupById,
  getLastSuccessfulBackupAge,
} from "../service";
import { prisma } from "@/lib/db";

type MockPrisma = {
  backupLog: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};
const mp = prisma as unknown as MockPrisma;

const sampleRow = {
  id: "bk_1",
  type: "DAILY" as const,
  status: "SUCCESS" as const,
  sizeBytes: BigInt(10 * 1024 * 1024), // 10 MB
  storagePath: "s3://delovoy-backups/daily/x.sql.gz",
  checksum: null,
  sourceBackupId: null,
  scope: null,
  targetTable: null,
  targetKey: null,
  affectedRows: null,
  migrationTag: null,
  performedById: null,
  performedBy: null,
  durationMs: 4200,
  error: null,
  metadata: null,
  createdAt: new Date("2026-04-21T03:00:00Z"),
  completedAt: new Date("2026-04-21T03:00:04Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBackupLog", () => {
  it("creates IN_PROGRESS row with BigInt sizeBytes", async () => {
    mp.backupLog.create.mockResolvedValue(sampleRow);

    await createBackupLog({
      type: "DAILY",
      storagePath: "s3://x",
      sizeBytes: 123,
      performedById: "u1",
    });

    expect(mp.backupLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "DAILY",
        status: "IN_PROGRESS",
        storagePath: "s3://x",
        sizeBytes: BigInt(123),
        performedById: "u1",
      }),
    });
  });

  it("omits sizeBytes when not provided", async () => {
    mp.backupLog.create.mockResolvedValue(sampleRow);
    await createBackupLog({ type: "MANUAL" });
    const call = mp.backupLog.create.mock.calls[0][0];
    expect(call.data.sizeBytes).toBeNull();
  });
});

describe("markBackupStatus", () => {
  it("updates to SUCCESS with completedAt", async () => {
    mp.backupLog.update.mockResolvedValue({ ...sampleRow });
    await markBackupStatus({
      id: "bk_1",
      status: "SUCCESS",
      durationMs: 4200,
      sizeBytes: 100,
    });
    expect(mp.backupLog.update).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        durationMs: 4200,
        sizeBytes: BigInt(100),
        completedAt: expect.any(Date),
      }),
    });
  });

  it("updates to FAILED with error text", async () => {
    mp.backupLog.update.mockResolvedValue({ ...sampleRow, status: "FAILED" });
    await markBackupStatus({
      id: "bk_1",
      status: "FAILED",
      error: "pg_dump exit 2",
    });
    const call = mp.backupLog.update.mock.calls[0][0];
    expect(call.data.status).toBe("FAILED");
    expect(call.data.error).toBe("pg_dump exit 2");
  });

  it("updates to PARTIAL with local storage path and S3 error note", async () => {
    mp.backupLog.update.mockResolvedValue({ ...sampleRow, status: "PARTIAL" });
    await markBackupStatus({
      id: "bk_1",
      status: "PARTIAL",
      sizeBytes: 10 * 1024 * 1024,
      storagePath: "/opt/backups/postgres/daily/delovoy_park_DAILY_20260421.dump",
      error: "aws s3 cp exited non-zero (endpoint=https://s3.timeweb.cloud)",
      durationMs: 3100,
    });
    const call = mp.backupLog.update.mock.calls[0][0];
    expect(call.data.status).toBe("PARTIAL");
    expect(call.data.storagePath).toMatch(/^\/opt\/backups/);
    expect(call.data.error).toMatch(/s3/i);
    expect(call.data.sizeBytes).toBe(BigInt(10 * 1024 * 1024));
  });
});

describe("listBackups — PARTIAL filter", () => {
  it("filters by status=PARTIAL and serialises local storagePath", async () => {
    const partialRow = {
      ...sampleRow,
      id: "bk_partial",
      status: "PARTIAL" as const,
      storagePath: "/opt/backups/postgres/daily/x.dump",
      error: "aws s3 cp exited non-zero",
    };
    mp.backupLog.findMany.mockResolvedValue([partialRow]);
    mp.backupLog.count.mockResolvedValue(1);

    const { items, total } = await listBackups({ status: "PARTIAL" });
    expect(total).toBe(1);
    expect(items[0].status).toBe("PARTIAL");
    expect(items[0].storagePath).toBe("/opt/backups/postgres/daily/x.dump");
    expect(items[0].error).toMatch(/s3/i);

    const findManyArgs = mp.backupLog.findMany.mock.calls[0][0];
    expect(findManyArgs.where.status).toBe("PARTIAL");
  });
});

describe("listBackups", () => {
  it("applies type + status + date range filters and serialises result", async () => {
    mp.backupLog.findMany.mockResolvedValue([sampleRow]);
    mp.backupLog.count.mockResolvedValue(1);

    const { items, total } = await listBackups({
      type: "DAILY",
      status: "SUCCESS",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-22T00:00:00Z"),
      limit: 10,
      offset: 0,
    });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("bk_1");
    expect(items[0].sizeMb).toBe(10);
    expect(items[0].sizeBytes).toBe(10 * 1024 * 1024);

    const findManyArgs = mp.backupLog.findMany.mock.calls[0][0];
    expect(findManyArgs.where.type).toBe("DAILY");
    expect(findManyArgs.where.status).toBe("SUCCESS");
    expect(findManyArgs.where.createdAt.gte).toEqual(new Date("2026-04-20T00:00:00Z"));
    expect(findManyArgs.take).toBe(10);
  });

  it("caps limit at 100", async () => {
    mp.backupLog.findMany.mockResolvedValue([]);
    mp.backupLog.count.mockResolvedValue(0);
    await listBackups({ limit: 999, offset: 0 });
    const call = mp.backupLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(100);
  });
});

describe("getBackupById", () => {
  it("returns null when not found", async () => {
    mp.backupLog.findUnique.mockResolvedValue(null);
    const result = await getBackupById("missing");
    expect(result).toBeNull();
  });

  it("serialises found row", async () => {
    mp.backupLog.findUnique.mockResolvedValue(sampleRow);
    const r = await getBackupById("bk_1");
    expect(r).not.toBeNull();
    expect(r?.sizeMb).toBe(10);
  });
});

describe("getLastSuccessfulBackupAge", () => {
  it("returns null when no rows", async () => {
    mp.backupLog.findFirst.mockResolvedValue(null);
    const age = await getLastSuccessfulBackupAge();
    expect(age).toBeNull();
  });

  it("returns age in ms", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    mp.backupLog.findFirst.mockResolvedValue({ createdAt: oneHourAgo });
    const age = await getLastSuccessfulBackupAge();
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThan(59 * 60 * 1000);
    expect(age!).toBeLessThan(61 * 60 * 1000);
  });
});
