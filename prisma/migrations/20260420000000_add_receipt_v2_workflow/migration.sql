-- Fixes schema drift between prisma/schema.prisma and the production database.
-- Covers:
--   1. Role enum: add ADMIN value (referenced by RBAC code)
--   2. ReferenceType enum: add CORRECTION value (used by correctReceipt)
--   3. ReceiptStatus enum: new (DRAFT/CONFIRMED/PROBLEM/CORRECTED)
--   4. StockReceipt: add V2 workflow columns (status, moduleSlug, confirm/problem/correct metadata)
--   5. StockReceiptCorrection: new table (audit trail of corrections)
-- All ALTER/CREATE statements are guarded to be idempotent so this can be re-run safely.

-- 1. Role enum — add ADMIN if not present
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';

-- 2. ReferenceType enum — add CORRECTION if not present
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'CORRECTION';

-- 3. ReceiptStatus enum
DO $$ BEGIN
  CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROBLEM', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. StockReceipt — add V2 workflow columns
ALTER TABLE "StockReceipt"
    ADD COLUMN IF NOT EXISTS "moduleSlug" TEXT,
    ADD COLUMN IF NOT EXISTS "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS "confirmedById" TEXT,
    ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "problemNote" TEXT,
    ADD COLUMN IF NOT EXISTS "problemReportedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "problemReportedById" TEXT,
    ADD COLUMN IF NOT EXISTS "correctedById" TEXT,
    ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3);

-- Existing receipts were created under the v1 flow where stock was applied immediately —
-- mark them CONFIRMED so they're not picked up as pending by the new v2 dashboard.
UPDATE "StockReceipt"
SET "status" = 'CONFIRMED',
    "confirmedById" = "performedById",
    "confirmedAt" = "createdAt"
WHERE "status" = 'DRAFT'
  AND "confirmedById" IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS "StockReceipt_status_idx" ON "StockReceipt"("status");
CREATE INDEX IF NOT EXISTS "StockReceipt_moduleSlug_idx" ON "StockReceipt"("moduleSlug");
CREATE INDEX IF NOT EXISTS "StockReceipt_performedById_idx" ON "StockReceipt"("performedById");

-- 5. StockReceiptCorrection
CREATE TABLE IF NOT EXISTS "StockReceiptCorrection" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "reason" TEXT,
    "itemsBefore" JSONB NOT NULL,
    "itemsAfter" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceiptCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockReceiptCorrection_receiptId_idx" ON "StockReceiptCorrection"("receiptId");
CREATE INDEX IF NOT EXISTS "StockReceiptCorrection_correctedById_idx" ON "StockReceiptCorrection"("correctedById");
CREATE INDEX IF NOT EXISTS "StockReceiptCorrection_createdAt_idx" ON "StockReceiptCorrection"("createdAt");

DO $$ BEGIN
    ALTER TABLE "StockReceiptCorrection"
        ADD CONSTRAINT "StockReceiptCorrection_receiptId_fkey"
        FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
