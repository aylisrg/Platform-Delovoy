-- Normalize whitespace in existing SKU names (trim + collapse multiple spaces)
UPDATE "InventorySku"
SET "name" = TRIM(REGEXP_REPLACE("name", '\s+', ' ', 'g'))
WHERE "name" <> TRIM(REGEXP_REPLACE("name", '\s+', ' ', 'g'));

-- Functional B-tree index for fast case-insensitive lookups (used by mode:"insensitive")
CREATE INDEX IF NOT EXISTS "inventory_sku_name_lower_idx"
  ON "InventorySku" (LOWER("name"));

-- Partial unique index: only active SKUs must have unique names (case-insensitive)
-- Archived SKUs (isActive=false) are exempt — they have [Объединён →] prefix
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_sku_active_name_lower_unique"
  ON "InventorySku" (LOWER("name"))
  WHERE "isActive" = true;
