-- Adds the dedicated DeletionLog audit trail for SUPERADMIN-only destructive actions.
-- All statements are idempotent so this can be safely re-applied in staging / prod.

DO $$ BEGIN
  CREATE TYPE "DeletionType" AS ENUM ('SOFT', 'HARD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "userName" TEXT,
    "userRole" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "moduleSlug" TEXT,
    "deletionType" "DeletionType" NOT NULL DEFAULT 'SOFT',
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeletionLog_userId_idx" ON "DeletionLog"("userId");
CREATE INDEX IF NOT EXISTS "DeletionLog_entity_entityId_idx" ON "DeletionLog"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "DeletionLog_moduleSlug_createdAt_idx" ON "DeletionLog"("moduleSlug", "createdAt");
CREATE INDEX IF NOT EXISTS "DeletionLog_createdAt_idx" ON "DeletionLog"("createdAt");
