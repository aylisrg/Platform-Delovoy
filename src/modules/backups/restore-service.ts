import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import type { Prisma } from "@prisma/client";
import type { RestoreRequestInput } from "./validation";
import type { RestoreResult } from "./types";

const RESTORE_LOCK_KEY = "restore:active";
const RESTORE_LOCK_TTL_SECONDS = 60 * 30; // 30 minutes safety cap

export class RestoreError extends Error {
  constructor(
    public code:
      | "BACKUP_NOT_FOUND"
      | "RESTORE_IN_PROGRESS"
      | "CONFIRM_TOKEN_INVALID"
      | "RESTORE_FAILED"
      | "UNSUPPORTED_SCOPE",
    message: string
  ) {
    super(message);
    this.name = "RestoreError";
  }
}

/**
 * Acquire Redis-based exclusive lock for restore operations. Returns a releaser.
 * Falls back to best-effort if Redis is unavailable (does NOT block in that case —
 * staging/dev usability). Production always has Redis per docker-compose.
 */
async function acquireRestoreLock(): Promise<() => Promise<void>> {
  try {
    // SET key value NX EX <ttl> — atomic "set if not exists"
    const ok = await redis.set(
      RESTORE_LOCK_KEY,
      String(Date.now()),
      "EX",
      RESTORE_LOCK_TTL_SECONDS,
      "NX"
    );
    if (ok !== "OK") {
      throw new RestoreError(
        "RESTORE_IN_PROGRESS",
        "Восстановление уже выполняется — дождитесь завершения"
      );
    }
    return async () => {
      try {
        await redis.del(RESTORE_LOCK_KEY);
      } catch {
        // ignore unlock errors; key will expire
      }
    };
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    // Redis unavailable — proceed without lock but log
    console.warn("[restore] Redis lock unavailable, proceeding unlocked:", err);
    return async () => {};
  }
}

type VerifyConfirmToken = (token: string, userId: string) => Promise<boolean>;

/**
 * Plan a restore job. The actual data movement (pg_restore) runs out-of-band
 * on the VPS via `scripts/restore-backup.sh` and is orchestrated by this service
 * purely through BackupLog rows + an async trigger (`metadata.trigger`).
 *
 * This function only:
 *   1. Validates backup exists & is restorable.
 *   2. Validates confirm token (injected for testability).
 *   3. Acquires Redis lock.
 *   4. Creates a BackupLog(type=RESTORE, status=IN_PROGRESS).
 *   5. Returns job info. For dryRun, marks complete immediately.
 *
 * The actual restore execution is a separate process — this service is the
 * **control plane**, not the data plane. This keeps Next.js route handlers
 * fast and keeps destructive pg_restore out of the app container.
 */
export async function planRestore(
  input: RestoreRequestInput,
  context: { performedById: string; verifyConfirmToken: VerifyConfirmToken }
): Promise<RestoreResult> {
  const backup = await prisma.backupLog.findUnique({
    where: { id: input.backupId },
  });
  if (!backup) {
    throw new RestoreError("BACKUP_NOT_FOUND", "Бекап не найден");
  }
  if (backup.status !== "SUCCESS") {
    throw new RestoreError(
      "BACKUP_NOT_FOUND",
      "Этот бекап не в статусе SUCCESS — восстановление невозможно"
    );
  }

  const tokenOk = await context.verifyConfirmToken(
    input.confirmToken,
    context.performedById
  );
  if (!tokenOk) {
    throw new RestoreError(
      "CONFIRM_TOKEN_INVALID",
      "Неверный confirmToken — повторите действие из UI"
    );
  }

  // DryRun doesn't need the lock — it doesn't touch data
  if (input.dryRun) {
    const log = await prisma.backupLog.create({
      data: {
        type: "RESTORE",
        status: "SUCCESS",
        sourceBackupId: backup.id,
        scope:
          input.scope === "full"
            ? "FULL"
            : input.scope === "table"
            ? "TABLE"
            : "RECORD",
        targetTable:
          input.target && input.target.scope !== "full"
            ? input.target.table
            : null,
        targetKey:
          input.target && input.target.scope === "record"
            ? (input.target.primaryKey as Prisma.InputJsonValue)
            : undefined,
        performedById: context.performedById,
        metadata: {
          dryRun: true,
          sourceStoragePath: backup.storagePath,
        } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return {
      jobId: log.id,
      backupLogId: log.id,
      status: "SUCCESS",
      dryRun: true,
      wouldAffectRows: input.scope === "record" ? 1 : undefined,
      message:
        "Dry-run проверка пройдена. Запустите с dryRun=false для реального восстановления.",
    };
  }

  const release = await acquireRestoreLock();
  try {
    const log = await prisma.backupLog.create({
      data: {
        type: "RESTORE",
        status: "IN_PROGRESS",
        sourceBackupId: backup.id,
        scope:
          input.scope === "full"
            ? "FULL"
            : input.scope === "table"
            ? "TABLE"
            : "RECORD",
        targetTable:
          input.target && input.target.scope !== "full"
            ? input.target.table
            : null,
        targetKey:
          input.target && input.target.scope === "record"
            ? (input.target.primaryKey as Prisma.InputJsonValue)
            : undefined,
        performedById: context.performedById,
        metadata: {
          dryRun: false,
          sourceStoragePath: backup.storagePath,
          trigger: "pending",
        } as Prisma.InputJsonValue,
      },
    });

    // Estimate duration: ~1s per MB, minimum 30s
    const sizeBytes = backup.sizeBytes ? Number(backup.sizeBytes) : 0;
    const estimatedSeconds = Math.max(30, Math.round(sizeBytes / (1024 * 1024)));

    return {
      jobId: log.id,
      backupLogId: log.id,
      status: "IN_PROGRESS",
      estimatedSeconds,
      message:
        "Задача создана. Выполнение запускается на VPS через scripts/restore-backup.sh.",
    };
  } catch (err) {
    await release();
    throw err;
  }
  // Note: lock is NOT released here — the external restore process is expected
  // to call `finaliseRestore()` which releases the lock. Lock also has 30-min TTL
  // as a safety net.
}

/**
 * Called by the out-of-band restore process (or a follow-up API) once pg_restore
 * finished. Updates the BackupLog and releases the lock.
 */
export async function finaliseRestore(
  backupLogId: string,
  result: {
    status: "SUCCESS" | "FAILED" | "PARTIAL";
    affectedRows?: number;
    durationMs?: number;
    error?: string;
  }
): Promise<void> {
  await prisma.backupLog.update({
    where: { id: backupLogId },
    data: {
      status: result.status,
      affectedRows: result.affectedRows,
      durationMs: result.durationMs,
      error: result.error,
      completedAt: new Date(),
    },
  });

  try {
    await redis.del(RESTORE_LOCK_KEY);
  } catch {
    // ignore
  }
}
