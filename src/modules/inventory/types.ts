import type {
  InventorySku,
  InventoryTransaction,
  InventoryTransactionType,
  MovementType,
  ReferenceType,
  WriteOffReason,
  AuditStatus,
  Supplier,
  StockBatch,
  StockReceipt,
  StockReceiptItem,
  StockMovement,
  WriteOff,
  InventoryAudit,
  InventoryAuditCount,
} from "@prisma/client";

export type SkuSummary = Pick<
  InventorySku,
  "id" | "name" | "category" | "unit" | "price" | "stockQuantity" | "isActive"
>;

export type SkuWithLowStock = SkuSummary & {
  lowStockThreshold: number;
  lowStock: boolean;
  outOfStock: boolean;
};

export type CreateSkuInput = {
  name: string;
  category: string;
  unit?: string;
  price: number;
  lowStockThreshold?: number;
  initialStock?: number;
};

export type UpdateSkuInput = Partial<Omit<CreateSkuInput, "initialStock">> & {
  isActive?: boolean;
};

export type ReceiveInput = {
  skuId: string;
  quantity: number;
  note?: string;
  receivedAt?: Date;
};

export type ReceiptHistoryRow = {
  id: string;
  skuId: string;
  skuName: string;
  type: "RECEIPT" | "INITIAL";
  quantity: number;
  note: string | null;
  performedById: string;
  performedByName: string | null;
  receivedAt: string;
  createdAt: string;
};

export type AdjustInput = {
  skuId: string;
  targetQuantity: number;
  note: string;
};

export type VoidTransactionInput = {
  note?: string;
};

export type TransactionFilter = {
  skuId?: string;
  type?: InventoryTransactionType;
  bookingId?: string;
  moduleSlug?: string;
  dateFrom?: string;
  dateTo?: string;
  isVoided?: boolean;
  page?: number;
  perPage?: number;
};

export type TransactionWithSku = InventoryTransaction & {
  sku: Pick<InventorySku, "name">;
};

// Used when booking items (Bloc 3)
export type BookingItemInput = {
  skuId: string;
  quantity: number;
};

export type BookingItemSnapshot = {
  skuId: string;
  skuName: string;
  quantity: number;
  priceAtBooking: string;
};

export type BookingSaleResult = {
  transactionIds: string[];
  itemsTotal: number;
};

export type InventoryAnalytics = {
  totalSkus: number;
  lowStockSkus: Array<{
    id: string;
    name: string;
    stockQuantity: number;
    lowStockThreshold: number;
  }>;
  salesByModule: Record<
    string,
    { totalItems: number; totalRevenue: string }
  >;
  topSkus: Array<{
    id: string;
    name: string;
    soldQuantity: number;
    revenue: string;
  }>;
  period: { from: string; to: string };
};

// === V2 TYPES ===

export type { MovementType, ReferenceType, WriteOffReason, AuditStatus };

// Supplier
export type SupplierSummary = Pick<
  Supplier,
  "id" | "name" | "contactName" | "phone" | "email" | "isActive" | "createdAt"
>;

export type CreateSupplierInput = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  inn?: string;
  notes?: string;
};

export type UpdateSupplierInput = Partial<CreateSupplierInput> & {
  isActive?: boolean;
};

// Stock Receipt
export type StockReceiptItemInput = {
  skuId: string;
  quantity: number;
  costPerUnit?: number;
  expiresAt?: string;
};

export type CreateStockReceiptInput = {
  supplierId?: string;
  invoiceNumber?: string;
  receivedAt: string;
  notes?: string;
  moduleSlug?: string;
  items: StockReceiptItemInput[];
};

export type EditDraftReceiptInput = {
  supplierId?: string | null;
  invoiceNumber?: string | null;
  receivedAt?: string;
  notes?: string | null;
  items?: StockReceiptItemInput[];
};

export type CorrectReceiptInput = {
  items: StockReceiptItemInput[];
  correctionReason?: string;
};

export type StockReceiptWithItems = StockReceipt & {
  supplier: Pick<Supplier, "id" | "name"> | null;
  items: (StockReceiptItem & {
    sku: Pick<InventorySku, "id" | "name" | "unit">;
  })[];
};

// Stock Batch
export type StockBatchSummary = Pick<
  StockBatch,
  | "id"
  | "skuId"
  | "initialQty"
  | "remainingQty"
  | "costPerUnit"
  | "receiptDate"
  | "expiresAt"
  | "isExhausted"
>;

// Stock Movement
export type StockMovementRow = Pick<
  StockMovement,
  | "id"
  | "skuId"
  | "batchId"
  | "type"
  | "delta"
  | "balanceAfter"
  | "referenceType"
  | "referenceId"
  | "performedById"
  | "note"
  | "createdAt"
> & {
  sku: Pick<InventorySku, "name">;
};

export type MovementFilter = {
  skuId?: string;
  type?: MovementType;
  referenceType?: ReferenceType;
  performedById?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
};

// Write-off
export type CreateWriteOffInput = {
  skuId: string;
  quantity: number;
  reason: WriteOffReason;
  note?: string;
  batchId?: string;
};

export type WriteOffWithSku = WriteOff & {
  sku: Pick<InventorySku, "id" | "name" | "unit">;
};

// Inventory Audit
export type CreateAuditInput = {
  notes?: string;
};

export type AuditCountInput = {
  skuId: string;
  actualQty: number;
};

export type SubmitAuditInput = {
  counts: AuditCountInput[];
};

export type AuditWithCounts = InventoryAudit & {
  counts: (InventoryAuditCount & {
    sku: Pick<InventorySku, "id" | "name" | "unit">;
  })[];
};

// Expiring batches
export type ExpiringBatchRow = {
  batchId: string;
  skuId: string;
  skuName: string;
  skuUnit: string;
  remainingQty: number;
  expiresAt: string;
  daysUntilExpiry: number;
};

// FIFO deduction result
export type FifoDeductResult = {
  movementIds: string[];
  newStockQuantity: number;
  batchesAffected: number;
};
