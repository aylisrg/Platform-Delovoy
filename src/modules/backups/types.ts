import type { BackupLog, BackupType, BackupStatus, RestoreScope } from "@prisma/client";

export type { BackupLog, BackupType, BackupStatus, RestoreScope };

export type CreateBackupLogInput = {
  type: BackupType;
  storagePath?: string;
  sizeBytes?: number | bigint;
  checksum?: string;
  migrationTag?: string;
  performedById?: string;
  metadata?: Record<string, unknown>;
};

export type MarkBackupStatusInput = {
  id: string;
  status: BackupStatus;
  sizeBytes?: number | bigint;
  storagePath?: string;
  checksum?: string;
  durationMs?: number;
  error?: string;
  affectedRows?: number;
  metadata?: Record<string, unknown>;
};

export type ListBackupsFilter = {
  type?: BackupType;
  status?: BackupStatus;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export type BackupListItem = {
  id: string;
  type: BackupType;
  status: BackupStatus;
  sizeBytes: number | null;
  sizeMb: number | null;
  storagePath: string | null;
  performedById: string | null;
  performedByName: string | null;
  error: string | null;
  scope: RestoreScope | null;
  targetTable: string | null;
  migrationTag: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
};

export type RestoreScopeRequest =
  | { scope: "full" }
  | { scope: "table"; table: string; truncateBefore?: boolean }
  | {
      scope: "record";
      table: string;
      primaryKey: Record<string, string | number>;
      upsert?: boolean;
    };

export type RestoreRequest = {
  backupId: string;
  scope: "full" | "table" | "record";
  target?: RestoreScopeRequest;
  dryRun: boolean;
  confirmToken: string;
};

export type RestoreResult = {
  jobId: string;
  backupLogId: string;
  status: BackupStatus;
  estimatedSeconds?: number;
  dryRun?: boolean;
  wouldAffectRows?: number;
  message?: string;
  /** Non-blocking warning — например, при restore из PARTIAL бекапа (только локально на VPS). */
  warning?: string;
};

/** Serialise a raw BackupLog row into API-safe shape (BigInt → number, Date → ISO). */
export function serialiseBackupLog(
  row: BackupLog & { performedBy?: { id: string; name: string | null } | null }
): BackupListItem {
  const sizeBytes = row.sizeBytes === null ? null : Number(row.sizeBytes);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    sizeBytes,
    sizeMb: sizeBytes === null ? null : Math.round((sizeBytes / 1024 / 1024) * 100) / 100,
    storagePath: row.storagePath,
    performedById: row.performedById,
    performedByName: row.performedBy?.name ?? null,
    error: row.error,
    scope: row.scope,
    targetTable: row.targetTable,
    migrationTag: row.migrationTag,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
