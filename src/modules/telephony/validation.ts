import { z } from "zod";

export const initiateCallSchema = z.object({
  bookingId: z.string().min(1),
  moduleSlug: z.enum(["gazebos", "ps-park"]),
});

/** Direct call by phone number (no bookingId required — for tenant contacts etc.) */
export const initiateDirectCallSchema = z.object({
  phone: z
    .string()
    .regex(/^\d{10,15}$/, "Телефон должен содержать 10–15 цифр без +"),
  tenantId: z.string().optional(),
  context: z.string().max(100).optional(),
});

export const callFilterSchema = z.object({
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  status: z
    .enum(["INITIATED", "RINGING", "ANSWERED", "NO_ANSWER", "BUSY", "FAILED", "COMPLETED"])
    .optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export const novofonWebhookSchema = z
  .object({
    event: z.string(),
    call_id: z.string(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    duration: z.number().int().nonnegative().optional(),
    recording_url: z.string().url().optional(),
    caller: z.string().optional(),
    callee: z.string().optional(),
  })
  .passthrough();

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type InitiateDirectCallInput = z.infer<typeof initiateDirectCallSchema>;
export type CallFilter = z.infer<typeof callFilterSchema>;
export type NovofonWebhookInput = z.infer<typeof novofonWebhookSchema>;
