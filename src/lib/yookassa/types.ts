import { z } from "zod";

/**
 * YooKassa API v3 — типы и Zod-схемы ответов.
 * Официального Node.js SDK нет; схемы описывают только используемые поля,
 * неизвестные ключи Zod по умолчанию отбрасывает (не ломают парсинг).
 * Docs: https://yookassa.ru/developers/api
 */

// === Общие ===

export const yooAmountSchema = z.object({
  value: z.string(),
  currency: z.string(),
});

export type YooAmount = z.infer<typeof yooAmountSchema>;

export const yooPaymentStatusSchema = z.enum([
  "pending",
  "waiting_for_capture",
  "succeeded",
  "canceled",
]);

export type YooPaymentStatus = z.infer<typeof yooPaymentStatusSchema>;

// === Payment (ответ API) ===

export const yooPaymentSchema = z.object({
  id: z.string(),
  status: yooPaymentStatusSchema,
  paid: z.boolean().optional(),
  amount: yooAmountSchema,
  description: z.string().nullish(),
  confirmation: z
    .object({
      type: z.string(),
      confirmation_url: z.string().optional(),
    })
    .nullish(),
  payment_method: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      saved: z.boolean().optional(),
    })
    .nullish(),
  cancellation_details: z
    .object({
      party: z.string(),
      reason: z.string(),
    })
    .nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  test: z.boolean().optional(),
  created_at: z.string(),
  captured_at: z.string().nullish(),
  expires_at: z.string().nullish(),
  refunded_amount: yooAmountSchema.nullish(),
});

export type YooPayment = z.infer<typeof yooPaymentSchema>;

// === Refund (ответ API) ===

export const yooRefundStatusSchema = z.enum(["pending", "succeeded", "canceled"]);

export const yooRefundSchema = z.object({
  id: z.string(),
  status: yooRefundStatusSchema,
  amount: yooAmountSchema,
  payment_id: z.string(),
  created_at: z.string(),
  cancellation_details: z
    .object({
      party: z.string(),
      reason: z.string(),
    })
    .nullish(),
});

export type YooRefund = z.infer<typeof yooRefundSchema>;

// === Ошибка API ===

export const yooErrorSchema = z.object({
  type: z.literal("error").optional(),
  id: z.string().optional(),
  code: z.string(),
  description: z.string().optional(),
  parameter: z.string().optional(),
});

// === Webhook-уведомление ===
// Телу НЕ доверяем — берём только object.id и делаем re-fetch через API.

export const yooWebhookNotificationSchema = z.object({
  type: z.literal("notification"),
  event: z.string(),
  object: z.object({
    id: z.string(),
    // refund.* события несут payment_id возврата
    payment_id: z.string().optional(),
  }),
});

export type YooWebhookNotification = z.infer<typeof yooWebhookNotificationSchema>;

/** События, которые обрабатывает вебхук. Остальные — no-op с логом. */
export const HANDLED_WEBHOOK_EVENTS = [
  "payment.succeeded",
  "payment.waiting_for_capture",
  "payment.canceled",
  "refund.succeeded",
] as const;

// === Чек 54-ФЗ (исходящий объект receipt) ===

export type YooReceiptItem = {
  description: string;
  quantity: string;
  amount: YooAmount;
  vat_code: number;
  payment_subject: string;
  payment_mode: string;
};

export type YooReceipt = {
  customer: { email?: string; phone?: string };
  items: YooReceiptItem[];
};

// === Исходящие запросы ===

export type CreatePaymentRequest = {
  amount: YooAmount;
  capture: boolean;
  confirmation: { type: "redirect"; return_url: string };
  description: string;
  metadata?: Record<string, string>;
  receipt?: YooReceipt;
  merchant_customer_id?: string;
};

export type CreateRefundRequest = {
  payment_id: string;
  amount: YooAmount;
  description?: string;
  receipt?: YooReceipt;
};
