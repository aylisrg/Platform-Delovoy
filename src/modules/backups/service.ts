import { prisma } from "@/lib/db";
import type {
  BackupListItem,
  CreateBackupLogInput,
  ListBackupsFilter,
  MarkBackupStatusInput,
} from "./types";
import { serialiseBackupLog } from "./types";
import type { BackupLog, Prisma } from "@prisma/client";

/**
 * Create a new BackupLog row in IN_PROGRESS status. Returns the row.
 * Caller is expected to later call `markBackupStatus` with the final state.
 */
export async function createBackupLog(
  input: CreateBackupLogInput
): Promise<BackupLog> {
  return prisma.backupLog.create({
    data: {
      type: input.type,
      status: "IN_PROGRESS",
      storagePath: input.storagePath,
      sizeBytes:
        input.sizeBytes === undefined ? null : BigInt(input.sizeBytes as number),
      checksum: input.checksum,
      migrationTag: input.migrationTag,
      performedById: input.performedById,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Transition a BackupLog row to its terminal state (SUCCESS/FAILED/PARTIAL).
 * Idempotent in spirit — two calls result in the later state winning.
 */
export async function markBackupStatus(
  input: MarkBackupStatusInput
): Promise<BackupLog> {
  return prisma.backupLog.update({
    where: { id: input.id },
    data: {
      status: input.status,
      storagePath: input.storagePath,
      sizeBytes:
        input.sizeBytes === undefined ? undefined : BigInt(input.sizeBytes as number),
      checksum: input.checksum,
      durationMs: input.durationMs,
      error: input.error,
      affectedRows: input.affectedRows,
      completedAt: new Date(),
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Return a paginated, filtered list of BackupLog rows with serialised shape.
 */
export async function listBackups(
  filter: ListBackupsFilter
): Promise<{ items: BackupListItem[]; total: number }> {
  const where: Prisma.BackupLogWhereInput = {};
  if (filter.type) where.type = filter.type;
  if (filter.status) where.status = filter.status;
  if (filter.from || filter.to) {
    where.createdAt = {};
    if (filter.from) where.createdAt.gte = filter.from;
    if (filter.to) where.createdAt.lte = filter.to;
  }

  const [rows, total] = await Promise.all([
    prisma.backupLog.findMany({
      where,
      include: { performedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(filter.limit ?? 50, 100),
      skip: filter.offset ?? 0,
    }),
    prisma.backupLog.count({ where }),
  ]);

  return {
    items: rows.map((r) => serialiseBackupLog(r)),
    total,
  };
}

/**
 * Fetch a single BackupLog by id (with performer).
 */
export async function getBackupById(
  id: string
): Promise<BackupListItem | null> {
  const row = await prisma.backupLog.findUnique({
    where: { id },
    include: { performedBy: { select: { id: true, name: true } } },
  });
  return row ? serialiseBackupLog(row) : null;
}

/**
 * How long ago was the last successful DAILY or MANUAL backup? Used by
 * monitoring / heartbeat check ("last backup older than 26 hours → alert").
 */
export async function getLastSuccessfulBackupAge(): Promise<number | null> {
  const row = await prisma.backupLog.findFirst({
    where: {
      status: "SUCCESS",
      type: { in: ["DAILY", "MANUAL", "PRE_MIGRATION"] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!row) return null;
  return Date.now() - row.createdAt.getTime();
}
