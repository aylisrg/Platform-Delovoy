-- Phase 3 (ADR 2026-04-23): link StockBatch to its originating RECEIPT/INITIAL InventoryTransaction.
-- Required so that editing or voiding a legacy receipt can find and cascade-update the batch,
-- keeping the invariant SUM(batch.remainingQty WHERE skuId) === sku.stockQuantity.

ALTER TABLE "StockBatch" ADD COLUMN "receiptTxId" TEXT;

CREATE INDEX "StockBatch_receiptTxId_idx" ON "StockBatch"("receiptTxId");

ALTER TABLE "StockBatch"
  ADD CONSTRAINT "StockBatch_receiptTxId_fkey"
  FOREIGN KEY ("receiptTxId") REFERENCES "InventoryTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Best-effort backfill: for each StockBatch without a receiptTxId, try to find the
-- corresponding RECEIPT/INITIAL transaction by (skuId, quantity, receivedAt) match.
-- Rows that cannot be matched unambiguously stay NULL — this is safe, the new code paths
-- create batches with receiptTxId going forward; NULL-batches remain as historical data.
UPDATE "StockBatch" AS b
SET "receiptTxId" = t.id
FROM "InventoryTransaction" AS t
WHERE b."receiptTxId" IS NULL
  AND t."skuId" = b."skuId"
  AND t."type" IN ('RECEIPT', 'INITIAL')
  AND t."quantity" = b."initialQty"
  AND t."receivedAt" IS NOT NULL
  AND DATE_TRUNC('minute', t."receivedAt") = DATE_TRUNC('minute', b."receiptDate")
  AND NOT EXISTS (
    -- skip if another batch already claimed this transaction
    SELECT 1 FROM "StockBatch" b2
    WHERE b2."receiptTxId" = t.id AND b2.id <> b.id
  );
