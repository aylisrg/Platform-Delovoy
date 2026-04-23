import { z } from "zod";

export const createSkuSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  category: z.string().min(1, "Категория обязательна").max(100),
  unit: z.string().max(20).default("шт"),
  price: z.number().positive("Цена должна быть положительной"),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  initialStock: z.number().int().nonnegative().optional(),
});

export const updateSkuSchema = createSkuSchema
  .omit({ initialStock: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

const todayISO = () => new Date().toISOString().slice(0, 10);

export const receiveSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  note: z.string().max(500).optional(),
  receivedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD")
    .refine((val) => val <= todayISO(), "Дата прихода не может быть в будущем")
    .optional(),
});

export const adjustSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  targetQuantity: z
    .number()
    .int()
    .nonnegative("Целевой остаток не может быть отрицательным"),
  note: z
    .string()
    .min(1, "Причина корректировки обязательна")
    .max(500),
});

export const voidTransactionSchema = z.object({
  note: z.string().max(500).optional(),
});

// PATCH /api/inventory/receipts/:id — edit a legacy receipt transaction.
// At least one of the editable fields must be present.
export const updateReceiptSchema = z
  .object({
    quantity: z
      .number()
      .int()
      .positive("Количество должно быть положительным")
      .max(100000, "Слишком большое количество")
      .optional(),
    receivedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD")
      .refine((val) => val <= new Date().toISOString().slice(0, 10), "Дата прихода не может быть в будущем")
      .optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (data) =>
      data.quantity !== undefined ||
      data.receivedAt !== undefined ||
      data.note !== undefined,
    { message: "Укажите хотя бы одно поле для изменения" }
  );

// DELETE /api/inventory/receipts/:id — superadmin-only hard delete.
// Password is validated by authorizeSuperadminDeletion helper; reason is optional audit context.
export const deleteReceiptSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const transactionFilterSchema = z.object({
  skuId: z.string().optional(),
  type: z
    .enum(["INITIAL", "RECEIPT", "SALE", "RETURN", "ADJUSTMENT"])
    .optional(),
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  isVoided: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const analyticsQuerySchema = z.object({
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const skuFilterSchema = z.object({
  category: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

// Reusable booking item schema (used in ps-park and gazebos)
export const bookingItemSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const bookingItemsArraySchema = z
  .array(bookingItemSchema)
  .max(20, "Не более 20 позиций товаров");

// === V2 SCHEMAS ===

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createSupplierSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  contactName: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  inn: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const supplierFilterSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

const stockReceiptItemSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  costPerUnit: z.number().positive("Цена закупки должна быть положительной").optional(),
  expiresAt: z.string().regex(dateRegex, "Дата в формате YYYY-MM-DD").optional(),
});

const WAREHOUSE_MODULE_SLUGS = ["cafe", "bbq", "ps-park"] as const;

export const createStockReceiptSchema = z.object({
  supplierId: z.string().optional(),
  invoiceNumber: z.string().max(100).optional(),
  receivedAt: z.string().regex(dateRegex, "Дата в формате YYYY-MM-DD"),
  notes: z.string().max(1000).optional(),
  moduleSlug: z.enum(WAREHOUSE_MODULE_SLUGS, { message: "Допустимые модули: cafe, bbq, ps-park" }).optional(),
  items: z.array(stockReceiptItemSchema).min(1, "Минимум одна позиция").max(100),
});

export const receiptFilterSchema = z.object({
  supplierId: z.string().optional(),
  skuId: z.string().optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "PROBLEM", "CORRECTED"]).optional(),
  moduleSlug: z.enum(WAREHOUSE_MODULE_SLUGS).optional(),
  performedById: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const flagProblemSchema = z.object({
  problemNote: z
    .string()
    .min(10, "Описание проблемы должно быть не менее 10 символов")
    .max(2000, "Описание проблемы не более 2000 символов"),
});

export const editReceiptSchema = z.object({
  supplierId: z.string().nullable().optional(),
  invoiceNumber: z.string().max(100).nullable().optional(),
  receivedAt: z.string().regex(dateRegex, "Дата в формате YYYY-MM-DD").optional(),
  notes: z.string().max(1000).nullable().optional(),
  items: z.array(stockReceiptItemSchema).min(1).max(100).optional(),
  correctionReason: z.string().max(2000).optional(),
});

export const pendingReceiptsFilterSchema = z.object({
  moduleSlug: z.enum(WAREHOUSE_MODULE_SLUGS).optional(),
});

export const createWriteOffSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  reason: z.enum(["EXPIRED", "DAMAGED", "LOST", "OTHER"]),
  note: z.string().max(1000).optional(),
  batchId: z.string().optional(),
}).refine(
  (data) => data.reason !== "OTHER" || (data.note && data.note.length > 0),
  { message: "Причина 'Иное' требует комментария", path: ["note"] }
);

export const batchWriteOffSchema = z.object({
  items: z.array(createWriteOffSchema).min(1, "Минимум одна позиция"),
});

export const writeOffFilterSchema = z.object({
  skuId: z.string().optional(),
  reason: z.enum(["EXPIRED", "DAMAGED", "LOST", "OTHER"]).optional(),
  performedById: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const createAuditSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export const auditCountsSchema = z.object({
  counts: z.array(z.object({
    skuId: z.string().min(1),
    actualQty: z.number().int().nonnegative("Количество не может быть отрицательным"),
  })).min(1, "Минимум одна позиция"),
});

export const movementFilterSchema = z.object({
  skuId: z.string().optional(),
  type: z.enum(["RECEIPT", "SALE", "RESERVATION", "RELEASE", "WRITE_OFF", "AUDIT_ADJUSTMENT", "MANUAL_CORRECTION"]).optional(),
  referenceType: z.enum(["BOOKING", "ORDER", "RECEIPT", "WRITE_OFF", "AUDIT", "MANUAL", "CORRECTION"]).optional(),
  performedById: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const expiringFilterSchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(7),
});

export const linkMenuItemSchema = z.object({
  inventorySkuId: z.string().nullable(),
});
