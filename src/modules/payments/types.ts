import type { Payment, PaymentRefund, PaymentSubjectType } from "@prisma/client";
import type { ReceiptItemInput } from "@/lib/yookassa/receipts";

export class PaymentError extends Error {
  constructor(
    public code: string,
    message: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export type CreateOnlinePaymentInput = {
  subjectType: PaymentSubjectType;
  subjectId: string;
  moduleSlug: string;
  /** Сумма в рублях. */
  amount: number;
  /** Описание платежа (обрезается до 128 символов ЮKassa). */
  description: string;
  userId?: string | null;
  /** Менеджер, инициировавший ссылку (admin-потоки). */
  createdById?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  receiptItems: ReceiptItemInput[];
  /** URL возврата после оплаты; плейсхолдер {paymentId} заменяется на id платежа. */
  returnUrl: string;
  metadata?: Record<string, unknown>;
};

export type RefundInput = {
  reason: string;
  performedById: string;
  performedByName: string;
};

export type AutoRefundTrigger = "client_cancellation" | "park_cancellation";

export type AutoRefundResult =
  | { refunded: true; refundId: string; amount: string }
  | { refunded: false; reason: "no_payment" | "within_24h" | "refund_failed" };

export type ReconcileReport = {
  checked: number;
  transitioned: number;
  expired: number;
  errors: number;
};

export type PaymentWithRefunds = Payment & { refunds: PaymentRefund[] };

/** Публичный статус для страницы ожидания оплаты (без сумм и внутренних полей). */
export type PublicPaymentStatus = {
  id: string;
  status: Payment["status"];
  confirmationUrl: string | null;
};

/**
 * Свёрнутый статус оплаты брони для админ-списков.
 * NONE (нет ни одного Payment) отделён от FAILED (платёж был, но CANCELED):
 * POS-бронь, оплаченная наличными, не должна ложно показываться «Не оплачено».
 */
export type BookingPaymentStatus =
  | "PAID"
  | "AWAITING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED"
  | "NONE";

/** Агрегат оплаты одной брони для бейджа в списке. */
export type BookingPaymentSummary = {
  bookingId: string;
  status: BookingPaymentStatus;
  /** Сумма успешно оплаченного онлайн (Decimal → строка). */
  amount: string;
  /** Сумма возвратов (Decimal → строка). */
  refundedAmount: string;
  paidAt: string | null;
  paymentMethodType: string | null;
};

/** Детальная оплата одной брони для страницы брони. */
export type BookingPaymentDetail = {
  status: BookingPaymentStatus;
  amount: string;
  refundedAmount: string;
  paidAt: string | null;
  paymentMethodType: string | null;
  payments: PaymentWithRefunds[];
};
