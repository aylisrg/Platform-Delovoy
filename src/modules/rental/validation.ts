import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// === Tenant ===

export const createTenantSchema = z.object({
  companyName: z.string().min(1, "Название компании обязательно").max(200),
  tenantType: z.enum(["COMPANY", "IP", "INDIVIDUAL"]).optional(),
  contactName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  phonesExtra: z.array(z.string().max(20)).optional(),
  email: z.string().email("Некорректный email").optional(),
  emailsExtra: z.array(z.string().email("Некорректный email")).optional(),
  inn: z
    .string()
    .regex(/^\d{10,12}$/, "ИНН должен содержать 10 или 12 цифр")
    .optional(),
  legalAddress: z.string().max(500).optional(),
  needsLegalAddress: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

export const tenantFilterSchema = z.object({
  search: z.string().optional(),
  type: z.enum(["COMPANY", "IP", "INDIVIDUAL"]).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
});

// === Office ===

export const createOfficeSchema = z.object({
  number: z.string().min(1, "Номер помещения обязателен").max(20),
  floor: z.number().int().min(1, "Этаж должен быть >= 1").max(10),
  building: z.number().int().min(1, "Корпус должен быть >= 1").max(10),
  officeType: z.enum(["OFFICE", "CONTAINER", "MEETING_ROOM"]).optional(),
  area: z.number().positive("Площадь должна быть положительной"),
  pricePerMonth: z.number().nonnegative("Цена не может быть отрицательной"),
  hasWetPoint: z.boolean().optional(),
  hasToilet: z.boolean().optional(),
  hasRoofAccess: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  comment: z.string().max(500).optional(),
});

export const updateOfficeSchema = createOfficeSchema.partial().extend({
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"]).optional(),
});

export const officeFilterSchema = z.object({
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"]).optional(),
  floor: z.coerce.number().int().positive().optional(),
  building: z.coerce.number().int().positive().optional(),
  type: z.enum(["OFFICE", "CONTAINER", "MEETING_ROOM"]).optional(),
});

// === Contract ===

export const createContractSchema = z
  .object({
    tenantId: z.string().min(1, "Арендатор обязателен"),
    officeId: z.string().min(1, "Помещение обязательно"),
    startDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
    endDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
    pricePerSqm: z.number().positive("Ставка за м² должна быть положительной").optional(),
    monthlyRate: z.number().positive("Ставка должна быть положительной"),
    currency: z.string().length(3).optional(),
    deposit: z.number().nonnegative("Залог не может быть отрицательным").optional(),
    contractNumber: z.string().max(100).optional(),
    documentUrl: z.string().url("Некорректная ссылка на документ").optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((data) => data.startDate < data.endDate, {
    message: "Дата начала должна быть раньше даты окончания",
    path: ["endDate"],
  });

export const updateContractSchema = z.object({
  startDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  endDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  pricePerSqm: z.number().positive().optional(),
  monthlyRate: z.number().positive("Ставка должна быть положительной").optional(),
  currency: z.string().length(3).optional(),
  newPricePerSqm: z.number().positive().optional(),
  priceIncreaseDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  deposit: z.number().nonnegative().optional(),
  contractNumber: z.string().max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"]).optional(),
  documentUrl: z.string().url("Некорректная ссылка на документ").optional(),
  notes: z.string().max(5000).optional(),
});

export const contractFilterSchema = z.object({
  status: z
    .union([
      z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"]),
      z.array(z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"])),
    ])
    .optional(),
  tenantId: z.string().optional(),
  officeId: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
});

export const renewContractSchema = z.object({
  newEndDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  newPricePerSqm: z.number().positive().optional(),
});

// === Inquiry ===

export const createInquirySchema = z.object({
  name: z.string().min(1, "Имя обязательно").max(100),
  phone: z.string().min(7, "Некорректный телефон").max(20),
  email: z.string().email("Некорректный email").optional(),
  companyName: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  officeId: z.string().optional(),
  officeIds: z.array(z.string()).max(10).optional(),
});

export const updateInquirySchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "CONVERTED", "CLOSED"]).optional(),
  isRead: z.boolean().optional(),
  adminNotes: z.string().max(2000).optional(),
  convertedToId: z.string().optional(),
});

export const inquiryFilterSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "CONVERTED", "CLOSED"]).optional(),
  isRead: z.coerce.boolean().optional(),
});

// === Deals (Sales Pipeline) ===

const DEAL_STAGES = [
  "NEW_LEAD",
  "QUALIFICATION",
  "SHOWING",
  "PROPOSAL",
  "NEGOTIATION",
  "CONTRACT_DRAFT",
  "WON",
  "LOST",
] as const;

const DEAL_PRIORITIES = ["HOT", "WARM", "COLD"] as const;

const DEAL_SOURCES = [
  "WEBSITE",
  "PHONE",
  "WALK_IN",
  "REFERRAL",
  "AVITO",
  "CIAN",
  "OTHER",
] as const;

export const createDealSchema = z.object({
  contactName: z.string().min(1, "Имя контакта обязательно").max(200),
  phone: z.string().min(7, "Некорректный телефон").max(20),
  email: z.string().email("Некорректный email").optional(),
  companyName: z.string().max(200).optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  priority: z.enum(DEAL_PRIORITIES).optional(),
  source: z.enum(DEAL_SOURCES).optional(),
  desiredArea: z.string().max(100).optional(),
  budget: z.string().max(100).optional(),
  moveInDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  requirements: z.string().max(5000).optional(),
  officeId: z.string().optional(),
  inquiryId: z.string().optional(),
  dealValue: z.number().nonnegative().optional(),
  nextActionDate: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  nextAction: z.string().max(500).optional(),
  adminNotes: z.string().max(5000).optional(),
});

export const updateDealSchema = createDealSchema.partial().extend({
  lostReason: z.string().max(1000).optional(),
  tenantId: z.string().optional(),
  contractId: z.string().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const dealFilterSchema = z.object({
  stage: z
    .union([z.enum(DEAL_STAGES), z.array(z.enum(DEAL_STAGES))])
    .optional(),
  priority: z.enum(DEAL_PRIORITIES).optional(),
  source: z.enum(DEAL_SOURCES).optional(),
});

export const reorderDealSchema = z.object({
  dealId: z.string().min(1),
  newStage: z.enum(DEAL_STAGES),
  sortOrder: z.number().int().nonnegative(),
});

export const reorderDealsSchema = z.object({
  updates: z.array(reorderDealSchema).min(1).max(50),
});

// === Reports ===

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const revenueReportSchema = z.object({
  period: z.enum(["month", "quarter", "year"]).optional().default("month"),
  building: z.coerce.number().int().positive().optional(),
});

export const expiringReportSchema = z.object({
  days: z.coerce.number().int().positive().optional().default(30),
});
