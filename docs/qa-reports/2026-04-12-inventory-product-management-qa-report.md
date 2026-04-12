# QA Report: Inventory v2 — Product & Stock Management Module

**Date:** 2026-04-12
**Reviewer:** QA Engineer (automated review via Claude Code)
**Commit:** `feat(inventory): Inventory & Product Management Module v2`
**Branch:** main

---

## Summary

The Inventory v2 module is a substantial implementation covering suppliers, stock receipts with FIFO batch tracking, write-offs, expiration tracking, inventory audits, a stock movement ledger, Telegram low-stock alerts with Redis deduplication, and a cron job. The architecture is clean and consistent. All 625 tests pass. However, **4 bugs of varying severity were found**, including one correctness bug in the FIFO deduction engine and one missing alert integration. The module does not fully satisfy the PRD acceptance criteria for product list filtering.

**Verdict: CONDITIONAL PASS** — The critical bugs must be fixed before this can be considered production-ready.

---

## Test Results (npm test)

```
Test Files  37 passed (37)
Tests       625 passed (625)
Duration    1.09s
```

All tests pass. No failures, no skipped tests.

---

## Acceptance Criteria Verification

### Product Catalog

| Criterion | Status | Notes |
|-----------|--------|-------|
| CRUD for products, categories, bundles, suppliers | PARTIAL PASS | Suppliers: full CRUD. SKU CRUD exists in v1 service (`/api/inventory/sku`). No dedicated bundle support found. |
| Product list filters: category, low_stock, expiring_soon, search by name/SKU | FAIL | `skuFilterSchema` (validation.ts:79–82) only supports `category` and `isActive`. Missing: `low_stock`, `expiring_soon`, `search`. `listAllSkus` in service.ts does not support these filters either. |
| Product with existing reservations cannot be hard-deleted | PARTIAL PASS | Supplier soft-delete (isActive=false) is implemented. SKU delete endpoint not found in v2 — v1 SKU `[id]/route.ts` exists but no hard-delete guard for products with reservations was verified. |

### Stock Receiving

| Criterion | Status | Notes |
|-----------|--------|-------|
| Stock receipt creates batches with correct purchase price and expiration date | PASS | `createStockReceipt` (service-v2.ts:85–180) creates `StockBatch` with `costPerUnit` and `expiresAt` per item. |
| Multi-product receipt works in a single transaction | PASS | All items processed in one `prisma.$transaction`. |
| `available_qty` increases immediately after receipt | PASS | `stockQuantity` is incremented on `inventorySku` inside the transaction (line 147–150). |

### Reservation & Deduction Flow

| Criterion | Status | Notes |
|-----------|--------|-------|
| FIFO: oldest batch by expiration then receipt date deducted first | PASS | SQL `ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC` (service-v2.ts:264–267). |
| Pessimistic lock via `FOR UPDATE` | PASS | Raw query uses `FOR UPDATE` (service-v2.ts:256–267). |
| Insufficient stock fails with descriptive error | PASS | `INVENTORY_INSUFFICIENT` error with product name, available qty, and requested qty (service-v2.ts:271–278). |
| **BUG: All FIFO movements record same `balanceAfter`** | BUG | See Bug #1 below. |

### Write-offs

| Criterion | Status | Notes |
|-----------|--------|-------|
| Write-off creates `StockMovement` with reason | PASS | Movement created with `WRITE_OFF` type and reason in note (service-v2.ts:437–449). |
| Batch write-off works for multiple products | PASS | `createBatchWriteOff` loops `createWriteOff` per item (service-v2.ts:462–472). |
| Write-off of expired batches works | PASS | `writeOffExpiredBatches` queries `expiresAt < now` and calls `createWriteOff` with batchId (service-v2.ts:474–501). |
| **BUG: Batch write-off is not atomic** | BUG | See Bug #2 below. |

### Expiration Tracking

| Criterion | Status | Notes |
|-----------|--------|-------|
| `GET /api/inventory/expiring?days=7` returns results | PASS | Route exists at `src/app/api/inventory/expiring/route.ts`. Uses `expiringFilterSchema` with default `days=7`. |
| Cron job flags expired batches | PARTIAL PASS | Cron at `/api/cron/inventory` calls `getExpiringBatches(0)` and logs a `SystemEvent` for already-expired batches, but does **not** automatically write them off — it only reports them. Auto write-off requires a separate `POST /api/inventory/write-offs/expired` call. |

### Minimum Stock Alerts

| Criterion | Status | Notes |
|-----------|--------|-------|
| Telegram notification sent when `available_qty` drops below threshold | PARTIAL PASS | `checkAndSendLowStockAlert` exists and is well-implemented, but is **never called from `service-v2.ts`**. See Bug #3 below. |
| Max 1 notification per product per 24 hours (Redis dedup) | PASS | Redis key with 86400s TTL (alerts.ts:4, 57). |
| Notification includes product name, current stock, threshold | PASS | Message contains name, `${stockQuantity} ${unit}`, and threshold (alerts.ts:123–133). |

### Inventory Audit

| Criterion | Status | Notes |
|-----------|--------|-------|
| Audit session can be started | PASS | `POST /api/inventory/audits` creates audit; blocks if one `IN_PROGRESS` exists. |
| Physical counts can be submitted | PASS | `POST /api/inventory/audits/[id]/counts` uses `upsert` for idempotency. |
| Submitting audit adjusts stock and creates `AUDIT_ADJUSTMENT` movements | PASS | `finalizeAudit` updates `stockQuantity` and creates `StockMovement` with type `AUDIT_ADJUSTMENT` (service-v2.ts:680–719). |
| Completed audit cannot be re-opened | PASS | Both `submitAuditCounts` and `finalizeAudit` check `status === "COMPLETED"` and throw `AUDIT_COMPLETED`. |
| **Missing audit log on counts submission** | MINOR BUG | See Bug #4 below. |

### Stock Movement Ledger

| Criterion | Status | Notes |
|-----------|--------|-------|
| Every stock change creates a movement record | PASS | Receipts, write-offs, and audit adjustments all create `StockMovement` entries. |
| Movements are immutable (no edit/delete endpoints) | PASS | Only `GET /api/inventory/movements` exists. No PATCH or DELETE routes. |
| Filtering works (skuId, type, referenceType, performedById, date range) | PASS | `movementFilterSchema` and `listMovements` support all filters. |

### Cross-Cutting

| Criterion | Status | Notes |
|-----------|--------|-------|
| All API responses use `{ success, data/error }` format | PASS | All routes use `apiResponse` / `apiError` / `apiNotFound` etc. from `lib/api-response.ts`. |
| All mutations require MANAGER or SUPERADMIN role | PASS | Every POST/PATCH/DELETE checks `session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER"`. |
| SUPERADMIN-only dashboard | PASS | `GET /api/inventory/dashboard` checks `role !== "SUPERADMIN"` (dashboard/route.ts:14). |
| All mutations create audit logs | PARTIAL PASS | Receipts, write-offs, suppliers, audit start/complete all log. Missing: `submitAuditCounts` (counts/route.ts — no `logAudit` call). |
| No `any` types in business logic | PASS | The only `any` usages are in test files with explicit `// eslint-disable-next-line` comments — acceptable. |
| Zod validation on all inputs | PASS | Every mutation route validates via Zod before calling service layer. |

---

## Bugs Found

### Bug #1 (MEDIUM) — FIFO: All movements in a multi-batch deduction record the same `balanceAfter`

**File:** `src/modules/inventory/service-v2.ts`, lines 313–336

**Description:** When deducting stock across multiple batches, the code first updates all batches in a loop, then updates the aggregate `stockQuantity`, then iterates through the batches again to create `StockMovement` records. Every movement record receives the same `balanceAfter` value — the final post-deduction total. This means intermediate movements misrepresent the ledger state.

**Example:** 20 units across 2 batches, deducting 15. Movement 1 (takes 10 from batch A): `balanceAfter=5`. Movement 2 (takes 5 from batch B): `balanceAfter=5`. Both show `5`, but the correct ledger trail would show `10` after the first movement and `5` after the second.

**Impact:** The movement ledger is misleading for audit purposes, though the final stock quantity is correct.

**Expected:** Each movement should record the running balance after that specific deduction, not the final total.

---

### Bug #2 (HIGH) — Batch write-off is not atomic

**File:** `src/modules/inventory/service-v2.ts`, lines 462–472

```typescript
export async function createBatchWriteOff(
  items: CreateWriteOffInput[],
  performedById: string
) {
  const results = [];
  for (const item of items) {
    const result = await createWriteOff(item, performedById);  // each is its own transaction
    results.push(result);
  }
  return results;
}
```

**Description:** `createBatchWriteOff` calls `createWriteOff` sequentially, and each call opens its own `prisma.$transaction`. If the third item in a five-item batch fails (e.g., `INVENTORY_INSUFFICIENT`), the first two write-offs are already committed and cannot be rolled back.

**Impact:** A partial batch write-off will silently corrupt stock state — some items written off, others not — with no way to undo the committed ones.

**Expected:** The entire batch should execute inside a single `prisma.$transaction`.

---

### Bug #3 (MEDIUM) — Low-stock alert never triggered after write-off or FIFO deduction

**File:** `src/modules/inventory/service-v2.ts`, lines 454–457

**Description:** `checkAndSendLowStockAlert` (defined in `alerts.ts`) is never imported or called from `service-v2.ts`. After a write-off reduces stock below `lowStockThreshold`, only `autoDisableMenuItems` is called via `setImmediate`. The same omission exists in `deductStockFifo` — no alert is triggered after a FIFO deduction.

The alert only fires via the cron sweep (`GET /api/cron/inventory`) which runs on a schedule, not immediately on the triggering event.

**Impact:** Real-time low-stock alerts per the PRD ("When available_qty drops below threshold, Telegram notification is sent") do not fire on the event — only on the next cron run.

**Expected:** After `createWriteOff` and `deductStockFifo` (post-transaction, via `setImmediate`), call `checkAndSendLowStockAlert(skuId)`.

---

### Bug #4 (LOW) — Missing audit log when submitting inventory counts

**File:** `src/app/api/inventory/audits/[id]/counts/route.ts`

**Description:** The `POST /api/inventory/audits/[id]/counts` route does not call `logAudit`. Every other mutation in the module creates an audit trail entry, but count submission — which is a significant data-entry action during stock-taking — is not logged.

**Impact:** No audit trail for who submitted counts and when. This is a compliance gap.

**Expected:** Add `await logAudit(session.user.id, "inventory.audit.counts.submit", "InventoryAudit", id, { countItems: parsed.data.counts.length })` after the service call.

---

## Code Quality Notes

### Strengths

1. **Clean architecture.** `service-v2.ts` is purely business logic, route handlers are thin (parse → call service → return). No DB logic leaks into routes.

2. **Pessimistic locking.** `FOR UPDATE` in `deductStockFifo` and the write-off batch query is a production-grade approach to preventing race conditions in concurrent stock deduction.

3. **Soft-delete pattern.** Suppliers use `isActive: false` rather than hard delete, preserving relational integrity with receipts.

4. **Error propagation.** `InventoryError` with a structured `code` propagates cleanly from service through route handler to API response. Consistent pattern across all routes.

5. **Redis graceful degradation.** `redisAvailable` flag means alerts degrade gracefully if Redis is unavailable — they just won't be deduped (alerts.ts:30–32).

6. **Transaction safety for receipts.** The `createStockReceipt` transaction correctly handles the receipt → item → batch → SKU update → movement chain atomically.

7. **Test coverage.** All three test files are thorough. V2 schemas are fully tested in `validation.test.ts`. Alert deduplication and Telegram delivery are covered. Service logic tests cover happy paths and error cases.

### Issues / Observations

8. **`InventoryError` defined in v1 `service.ts`, imported by v2 `service-v2.ts`.** This creates a coupling between v1 and v2. If `service.ts` is ever deprecated or removed, `service-v2.ts` and its tests will break. Consider moving `InventoryError` to a shared `errors.ts` file in the module.

9. **`getExpiringBatches(0)` in cron includes items that expire *today* at any time.** `cutoff = now + 0ms = now`. The Prisma query uses `lte: cutoff`, so items with `expiresAt = now` are included. Items expiring later today (e.g., midnight tonight) would not yet be in the `lte` filter unless their timestamp is less than the moment the cron runs. This is likely the intended behavior but should be documented.

10. **`createStockReceiptSchema` does not validate that `receivedAt` is not in the future.** The v1 `receiveSchema` has a `refine` guard preventing future dates. The v2 `createStockReceiptSchema` only validates date format (`/^\d{4}-\d{2}-\d{2}$/`), allowing future-dated receipts. This may allow incorrect inventory timestamps.

11. **`dynamic import` in expiring route.** `src/app/api/inventory/expiring/route.ts` line 29 uses a dynamic `import("@/lib/api-response")` inside a catch block, while all other routes import statically at the top. This is inconsistent and adds unnecessary async overhead in the error path. The `InventoryError` check is also redundant since `getExpiringBatches` doesn't throw `InventoryError`.

12. **`createBatchWriteOff` does not log individual write-offs in the batch.** `POST /api/inventory/write-offs/batch` logs one `inventory.write-off.batch` audit entry with `itemCount`, but not the individual SKU IDs and quantities written off. This limits auditability.

13. **`skuFilterSchema` missing v2 filters.** The PRD specifies `low_stock` and `expiring_soon` filters for the product list. Neither is present in `skuFilterSchema` (validation.ts:79–82) or `listAllSkus` (service.ts:33–44). This is a missing feature, not just a test gap.

14. **No test coverage for `createStockReceipt`, `createWriteOff`, `finalizeAudit`, or `deductStockFifo`.** These are the most complex and critical functions in the module. The service-v2 test file tests the simpler read functions (`listSuppliers`, `getExpiringBatches`, `listMovements`, `getInventoryDashboard`) but skips the transaction-heavy write paths. The bugs in Bug #1 and Bug #2 would have been caught by tests for `deductStockFifo` and `createBatchWriteOff`.

---

## Verdict: CONDITIONAL PASS

| Area | Result |
|------|--------|
| Test suite (npm test) | PASS — 625/625 |
| API format (`{ success, data/error }`) | PASS |
| RBAC (MANAGER/SUPERADMIN gates) | PASS |
| Zod validation on all inputs | PASS |
| Audit logging completeness | PARTIAL PASS |
| FIFO correctness | BUG (medium) |
| Batch write-off atomicity | BUG (high) |
| Real-time low-stock alerts | BUG (medium) |
| Product list filtering | FAIL (missing features) |
| Test coverage of write paths | INSUFFICIENT |

**Required before merge:**
- Fix Bug #2 (batch write-off atomicity) — HIGH risk of data corruption in production
- Fix Bug #3 (low-stock alert not triggered on events) — PRD feature not delivered
- Add `low_stock` and `expiring_soon` filters to product list endpoint

**Recommended (not blocking):**
- Fix Bug #1 (FIFO movement `balanceAfter` accuracy)
- Fix Bug #4 (missing audit log on counts submission)
- Fix issue #10 (future `receivedAt` in v2 receipt schema)
- Fix issue #11 (dynamic import in expiring route catch block)
- Add tests for `createStockReceipt`, `createWriteOff`, `deductStockFifo`, `finalizeAudit`
