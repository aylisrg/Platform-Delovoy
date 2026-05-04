import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// F4 ADR — manual guest CRUD. Phone is required for create (only reliable
// dedup key); on edit it's locked (smena phone — это операция merge).
export const createClientSchema = z.object({
  phone: z
    .string()
    .min(1, "Телефон обязателен")
    .refine((v) => normalizePhone(v) !== null, "Некорректный номер телефона"),
  name: z.string().trim().min(1).max(120).optional().nullable(),
  email: z.string().email("Некорректный e-mail").optional().nullable(),
  birthday: z
    .string()
    .regex(dateRegex, "Формат: YYYY-MM-DD")
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const updateClientSchema = z.object({
  // phone намеренно отсутствует — менять можно только через merge
  name: z.string().trim().min(1).max(120).optional().nullable(),
  email: z.string().email("Некорректный e-mail").optional().nullable(),
  birthday: z
    .string()
    .regex(dateRegex, "Формат: YYYY-MM-DD")
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientFilterSchema = z.object({
  search: z.string().max(200).optional(),
  moduleSlug: z.enum(["gazebos", "ps-park", "cafe"]).optional(),
  dateFrom: z
    .string()
    .regex(dateRegex, "Формат даты: YYYY-MM-DD")
    .optional(),
  dateTo: z
    .string()
    .regex(dateRegex, "Формат даты: YYYY-MM-DD")
    .optional(),
  sortBy: z
    .enum(["totalSpent", "lastActivity", "createdAt", "name"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ClientFilterInput = z.infer<typeof clientFilterSchema>;

export const mergeClientsSchema = z
  .object({
    primaryId: z.string().min(1, "primaryId обязателен"),
    secondaryId: z.string().min(1, "secondaryId обязателен"),
  })
  .refine((data) => data.primaryId !== data.secondaryId, {
    message: "Нельзя объединить клиента с самим собой",
  });

export const mergePreviewSchema = z.object({
  primaryId: z.string().min(1),
  secondaryId: z.string().min(1),
});

export type MergeClientsInput = z.infer<typeof mergeClientsSchema>;
export type MergePreviewInput = z.infer<typeof mergePreviewSchema>;
