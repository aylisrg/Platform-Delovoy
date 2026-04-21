-- Backups: audit log + restore tracking
-- Additive-only migration. Safe for hotfix pre-migration backup hook.

-- Enums
DO $$ BEGIN
  CREATE TYPE "BackupType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'PRE_MIGRATION', 'MANUAL', 'RESTORE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BackupStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RestoreScope" AS ENUM ('FULL', 'TABLE', 'RECORD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Main table
CREATE TABLE IF NOT EXISTS "BackupLog" (
  "id"             TEXT NOT NULL,
  "type"           "BackupType" NOT NULL,
  "status"         "BackupStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "sizeBytes"      BIGINT,
  "storagePath"    TEXT,
  "checksum"       TEXT,

  "sourceBackupId" TEXT,
  "scope"          "RestoreScope",
  "targetTable"    TEXT,
  "targetKey"      JSONB,
  "affectedRows"   INTEGER,

  "migrationTag"   TEXT,

  "performedById"  TEXT,

  "durationMs"     INTEGER,
  "error"          TEXT,
  "metadata"       JSONB,

  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),

  CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BackupLog_type_createdAt_idx" ON "BackupLog"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "BackupLog_status_idx" ON "BackupLog"("status");
CREATE INDEX IF NOT EXISTS "BackupLog_performedById_idx" ON "BackupLog"("performedById");

-- Foreign key to User (nullable — system-scheduled backups have no performedBy)
DO $$ BEGIN
  ALTER TABLE "BackupLog"
    ADD CONSTRAINT "BackupLog_performedById_fkey"
    FOREIGN KEY ("performedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
