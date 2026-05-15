-- Migration: Add Park model and parkSlug discriminator to rental entities
-- Adds multi-park support (delovoy + nedelovoy) without duplicating tables.
-- All existing rows are backfilled to parkSlug = 'delovoy'.

-- 1. Create Park table
CREATE TABLE "Park" (
    "id"           TEXT NOT NULL,
    "slug"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "legalAddress" TEXT,
    "config"       JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Park_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Park_slug_key" ON "Park"("slug");

-- Seed default parks immediately so backfill FK references are valid
INSERT INTO "Park" ("id", "slug", "name", "description", "isActive", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'delovoy',   'Деловой',    'Бизнес-парк Деловой (основной)', true, NOW()),
  (gen_random_uuid()::text, 'nedelovoy', 'НеДеловой',  'Бизнес-парк НеДеловой',          true, NOW());

-- 2. Add parkSlug to Office (nullable first for backfill)
ALTER TABLE "Office" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
DROP INDEX IF EXISTS "Office_building_floor_number_key";
CREATE UNIQUE INDEX "Office_parkSlug_building_floor_number_key" ON "Office"("parkSlug", "building", "floor", "number");
CREATE INDEX "Office_parkSlug_idx" ON "Office"("parkSlug");

-- 3. Add parkSlug to RentalContract
ALTER TABLE "RentalContract" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
CREATE INDEX "RentalContract_parkSlug_idx" ON "RentalContract"("parkSlug");

-- 4. Add parkSlug to RentalInquiry
ALTER TABLE "RentalInquiry" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
CREATE INDEX "RentalInquiry_parkSlug_status_idx" ON "RentalInquiry"("parkSlug", "status");

-- 5. Add parkSlug to RentalDeal
ALTER TABLE "RentalDeal" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
CREATE INDEX "RentalDeal_parkSlug_idx" ON "RentalDeal"("parkSlug");

-- 6. Add parkSlug to ManagerTask
ALTER TABLE "ManagerTask" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';

-- 7. Add parkSlug to EmailTemplate — drop old key-only unique, add (parkSlug, key) unique
ALTER TABLE "EmailTemplate" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
DROP INDEX IF EXISTS "EmailTemplate_key_key";
CREATE UNIQUE INDEX "EmailTemplate_parkSlug_key_key" ON "EmailTemplate"("parkSlug", "key");
CREATE INDEX "EmailTemplate_parkSlug_idx" ON "EmailTemplate"("parkSlug");

-- 8. Add parkSlug to EmailLog
ALTER TABLE "EmailLog" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
CREATE INDEX "EmailLog_parkSlug_idx" ON "EmailLog"("parkSlug");

-- 9. Update RentalNotificationSettings singleton → per-park
--    Old: id = 'singleton' (hardcoded string PK)
--    New: id = cuid(), parkSlug String @unique
ALTER TABLE "RentalNotificationSettings" ADD COLUMN "parkSlug" TEXT NOT NULL DEFAULT 'delovoy';
-- Update existing singleton row's id to a proper cuid (keep data intact)
UPDATE "RentalNotificationSettings" SET "id" = gen_random_uuid()::text WHERE "id" = 'singleton';
CREATE UNIQUE INDEX "RentalNotificationSettings_parkSlug_key" ON "RentalNotificationSettings"("parkSlug");
