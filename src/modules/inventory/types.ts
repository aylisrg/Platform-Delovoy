import type { InventorySku, InventoryTransaction, InventoryTransactionType } from "@prisma/client";

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
