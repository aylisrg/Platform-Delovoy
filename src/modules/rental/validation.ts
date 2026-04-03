import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// === Office ===

export const createOfficeSchema = z.object({
  number: z.string().min(1, "Номер офиса обязателен").max(20),
  floor: z.number().int().positive("Этаж должен быть положительным числом"),
  area: z.number().positive("Площадь должна быть положительной"),
  pricePerMonth: z.number().positive("Цена должна быть положительной"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateOfficeSchema = createOfficeSchema.partial().extend({
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]).optional(),
});

// === Tenant ===

export const createTenantSchema = z.object({
  companyName: z.string().min(1, "Название компании обязательно").max(200),
  contactName: z.string().min(1, "Контактное лицо обязательно").max(100),
  email: z.string().email("Некорректный email").optional(),
  phone: z.string().min(7, "Некорректный телефон").max(20).optional(),
  inn: z.string().length(10, "ИНН должен содержать 10 цифр").regex(/^\d+$/, "ИНН должен содержать только цифры").optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

// === Contract ===

export const createContractSchema = z.object({
  tenantId: z.string().min(1, "Арендатор обязателен"),
  officeId: z.string().min(1, "Офис обязателен"),
  startDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  endDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  monthlyRate: z.number().positive("Ставка должна быть положительной"),
  deposit: z.number().nonnegative("Залог не может быть отрицательным").optional(),
  documentUrl: z.string().url("Некорректная ссылка на документ").optional(),
  notes: z.string().max(2000).optional(),
}).refine(
  (data) => data.startDate < data.endDate,
  { message: "Дата начала должна быть раньше даты окончания", path: ["endDate"] }
);

export const updateContractSchema = z.object({
  endDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  monthlyRate: z.number().positive("Ставка должна быть положительной").optional(),
  deposit: z.number().nonnegative().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"]).optional(),
  documentUrl: z.string().url("Некорректная ссылка на документ").optional(),
  notes: z.string().max(2000).optional(),
});

export const contractFilterSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"]).optional(),
  tenantId: z.string().optional(),
  officeId: z.string().optional(),
});

export const officeFilterSchema = z.object({
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]).optional(),
  floor: z.coerce.number().int().positive().optional(),
});

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
