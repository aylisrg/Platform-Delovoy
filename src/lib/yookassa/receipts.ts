import { toAmountValue } from "./client";
import type { YooReceipt, YooReceiptItem } from "./types";

/**
 * Сборка объекта receipt (чек 54-ФЗ) для платежей и возвратов.
 *
 * Решение владельца (план § 7): фискализация — «Чеки от ЮKassa», email или
 * телефон плательщика обязательны. Пока фискализация в ЛК не включена,
 * YOOKASSA_RECEIPTS_ENABLED=false и receipt не отправляется (ЮKassa без
 * настроенной кассы его игнорирует, а при включённой — требует).
 */

export type ReceiptCustomerInput = {
  email?: string | null;
  phone?: string | null;
};

export type ReceiptItemInput = {
  description: string;
  /** Сумма позиции в рублях (Decimal/number/строка). */
  amount: number | string | { toString(): string };
  quantity?: number;
  /** full_prepayment — предоплата брони; full_payment — услуга/товар сразу. */
  paymentMode?: "full_payment" | "full_prepayment";
};

export function receiptsEnabled(): boolean {
  return process.env.YOOKASSA_RECEIPTS_ENABLED === "true";
}

/** Телефон для чека — только цифры (формат ITU-T E.164 без «+»). */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // 8XXXXXXXXXX → 7XXXXXXXXXX (российский формат)
  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

export class ReceiptContactError extends Error {
  code = "PAYMENT_CONTACT_REQUIRED";
  constructor() {
    super("Для чека нужен email или телефон плательщика");
    this.name = "ReceiptContactError";
  }
}

/**
 * Возвращает receipt для запроса к ЮKassa или undefined, если фискализация
 * выключена. При включённой фискализации отсутствие контакта — ошибка
 * (ReceiptContactError), её должна ловить форма и требовать контакт.
 */
export function buildReceipt(
  customer: ReceiptCustomerInput,
  items: ReceiptItemInput[]
): YooReceipt | undefined {
  if (!receiptsEnabled()) return undefined;

  const email = customer.email?.trim() || undefined;
  const phone = customer.phone ? normalizePhone(customer.phone) : undefined;
  if (!email && !phone) {
    throw new ReceiptContactError();
  }

  const vatCode = Number(process.env.YOOKASSA_VAT_CODE ?? "1"); // 1 = без НДС

  const receiptItems: YooReceiptItem[] = items.map((item) => ({
    description: item.description.slice(0, 128),
    quantity: (item.quantity ?? 1).toFixed(2),
    amount: { value: toAmountValue(item.amount), currency: "RUB" },
    vat_code: vatCode,
    payment_subject: "service",
    payment_mode: item.paymentMode ?? "full_payment",
  }));

  return {
    customer: {
      ...(email && { email }),
      ...(phone && { phone }),
    },
    items: receiptItems,
  };
}
