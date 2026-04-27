-- ============================================================================
-- Auth + CRM v1 — Wave 1 schema
--
-- 1. New columns on "User":
--    tags, notes, lastSeenAt, source, mergedIntoUserId, mergedAt,
--    phoneNormalized, emailNormalized
-- 2. New table "MergeCandidate" for manual merge resolution.
-- 3. Backfill normalized columns + source/lastSeenAt for existing rows.
-- 4. Partial unique indexes on phoneNormalized/emailNormalized
--    where mergedIntoUserId IS NULL — Prisma cannot express partial unique,
--    so we use raw SQL.
--
-- Forward-compatible: new columns are nullable / have defaults so old code
-- keeps working before deploy.
-- ============================================================================

-- 1. Add columns to "User"
ALTER TABLE "User"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "source" TEXT,
  ADD COLUMN "mergedIntoUserId" TEXT,
  ADD COLUMN "mergedAt" TIMESTAMP(3),
  ADD COLUMN "phoneNormalized" TEXT,
  ADD COLUMN "emailNormalized" TEXT;

-- 2. FK for self-relation
ALTER TABLE "User"
  ADD CONSTRAINT "User_mergedIntoUserId_fkey"
  FOREIGN KEY ("mergedIntoUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Indexes (non-unique)
CREATE INDEX "User_mergedIntoUserId_idx" ON "User"("mergedIntoUserId");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
CREATE INDEX "User_phoneNormalized_idx" ON "User"("phoneNormalized");
CREATE INDEX "User_emailNormalized_idx" ON "User"("emailNormalized");
CREATE INDEX "User_source_idx" ON "User"("source");

-- 4. Backfill phoneNormalized: strip non-digit/+ chars
UPDATE "User"
SET "phoneNormalized" = regexp_replace("phone", '[^0-9+]', '', 'g')
WHERE "phone" IS NOT NULL;

-- 5. Backfill emailNormalized: lowercase
UPDATE "User"
SET "emailNormalized" = LOWER("email")
WHERE "email" IS NOT NULL;

-- 6. Backfill source: existing users without source = "legacy"
UPDATE "User"
SET "source" = 'legacy'
WHERE "source" IS NULL;

-- 7. Backfill lastSeenAt: best-effort fall back to updatedAt
UPDATE "User"
SET "lastSeenAt" = "updatedAt"
WHERE "lastSeenAt" IS NULL;

-- 8. Partial unique indexes — only enforce uniqueness for NON-merged users.
--    This frees up phone/email after a merge so the secondary user can keep
--    its tombstone row without blocking re-registration on the same address.
--    Prisma cannot express partial unique constraints, so we use raw SQL.
CREATE UNIQUE INDEX "User_phoneNormalized_active_unique"
  ON "User"("phoneNormalized")
  WHERE "mergedIntoUserId" IS NULL AND "phoneNormalized" IS NOT NULL;

CREATE UNIQUE INDEX "User_emailNormalized_active_unique"
  ON "User"("emailNormalized")
  WHERE "mergedIntoUserId" IS NULL AND "emailNormalized" IS NOT NULL;

-- ============================================================================
-- MergeCandidate
-- ============================================================================
CREATE TABLE "MergeCandidate" (
  "id"               TEXT NOT NULL,
  "primaryUserId"    TEXT NOT NULL,
  "candidateUserId"  TEXT NOT NULL,
  "matchedFields"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "matchScore"       DOUBLE PRECISION NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "detectedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"       TIMESTAMP(3),
  "resolvedByUserId" TEXT,

  CONSTRAINT "MergeCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MergeCandidate_primaryUserId_candidateUserId_key"
  ON "MergeCandidate"("primaryUserId", "candidateUserId");
CREATE INDEX "MergeCandidate_status_detectedAt_idx"
  ON "MergeCandidate"("status", "detectedAt");
CREATE INDEX "MergeCandidate_primaryUserId_idx"
  ON "MergeCandidate"("primaryUserId");
CREATE INDEX "MergeCandidate_candidateUserId_idx"
  ON "MergeCandidate"("candidateUserId");

ALTER TABLE "MergeCandidate"
  ADD CONSTRAINT "MergeCandidate_primaryUserId_fkey"
  FOREIGN KEY ("primaryUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MergeCandidate"
  ADD CONSTRAINT "MergeCandidate_candidateUserId_fkey"
  FOREIGN KEY ("candidateUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
