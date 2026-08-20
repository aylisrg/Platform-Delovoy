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
  /** service — услуги (брони, абонементы); commodity — товары (кафе). */
  paymentSubject?: "service" | "commodity";
  /**
   * Ставка НДС позиции. Не задана — берётся текущая YOOKASSA_VAT_CODE.
   * Чек возврата обязан повторять ставку чека продажи, поэтому возвраты
   * передают сюда код из снапшота платежа, а не текущий из env.
   */
  vatCode?: number;
};

/**
 * Коды ставок НДС ЮKassa (54-ФЗ). Значение YOOKASSA_VAT_CODE — это КОД из
 * этой таблицы, а не процент: «НДС 5 %» — код 7, тогда как код 5 означает
 * расчётную ставку 10/110. Коды 11/12 (22 % и 22/122) действуют с 01.01.2026.
 */
export const VAT_CODES = {
  /** 1 — без НДС */
  NONE: 1,
  /** 2 — 0 % */
  RATE_0: 2,
  /** 3 — 10 % */
  RATE_10: 3,
  /** 4 — 20 % */
  RATE_20: 4,
  /** 5 — расчётная 10/110 */
  RATE_10_110: 5,
  /** 6 — расчётная 20/120 */
  RATE_20_120: 6,
  /** 7 — 5 % */
  RATE_5: 7,
  /** 8 — 7 % */
  RATE_7: 8,
  /** 9 — расчётная 5/105 */
  RATE_5_105: 9,
  /** 10 — расчётная 7/107 */
  RATE_7_107: 10,
  /** 11 — 22 % (с 01.01.2026) */
  RATE_22: 11,
  /** 12 — расчётная 22/122 (с 01.01.2026) */
  RATE_22_122: 12,
} as const;

const MIN_VAT_CODE = VAT_CODES.NONE;
const MAX_VAT_CODE = VAT_CODES.RATE_22_122;

/** Ставка по умолчанию — НДС 5 % (решение владельца 2026-08-20). */
export const DEFAULT_VAT_CODE: number = VAT_CODES.RATE_5;

/**
 * Ставка платежей, проведённых до перехода на 5 %: тогда чеки выбивались
 * «без НДС». Чек возврата обязан совпадать с чеком продажи, поэтому у старых
 * платежей (в снапшоте нет vatCode) возврат идёт по этому коду, а не по
 * текущему из env.
 */
export const LEGACY_VAT_CODE: number = VAT_CODES.NONE;

export function receiptsEnabled(): boolean {
  return process.env.YOOKASSA_RECEIPTS_ENABLED === "true";
}

export class ReceiptVatCodeError extends Error {
  code = "PAYMENTS_MISCONFIGURED";
  constructor(source: string, raw: unknown) {
    super(
      `Некорректный код ставки НДС (${source}): ${JSON.stringify(raw)}. ` +
        `Допустимы целые ${MIN_VAT_CODE}–${MAX_VAT_CODE} (НДС 5 % — это код ${VAT_CODES.RATE_5}, ` +
        `код ${VAT_CODES.RATE_10_110} — расчётная 10/110).`
    );
    this.name = "ReceiptVatCodeError";
  }
}

/**
 * Валидация кода ставки. Молча пропущенный неверный код — это неверный
 * фискальный документ у покупателя, поэтому падаем громко, а не подставляем
 * дефолт: ЮKassa всё равно отвергнет платёж, но уже невнятной ошибкой.
 */
function assertVatCode(value: unknown, source: string): number {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < MIN_VAT_CODE || parsed > MAX_VAT_CODE) {
    throw new ReceiptVatCodeError(source, value);
  }
  return parsed;
}

/**
 * Текущая ставка НДС из env. Пустое/незаданное значение — дефолт (ops-env.yml
 * удаляет ключ при пустом value, так что «пусто» и «нет ключа» неразличимы).
 */
export function resolveVatCode(): number {
  const raw = process.env.YOOKASSA_VAT_CODE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_VAT_CODE;
  return assertVatCode(raw, "YOOKASSA_VAT_CODE");
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

  const envVatCode = resolveVatCode();

  const receiptItems: YooReceiptItem[] = items.map((item) => ({
    description: item.description.slice(0, 128),
    quantity: (item.quantity ?? 1).toFixed(2),
    amount: { value: toAmountValue(item.amount), currency: "RUB" },
    vat_code:
      item.vatCode === undefined ? envVatCode : assertVatCode(item.vatCode, "vatCode позиции"),
    payment_subject: item.paymentSubject ?? "service",
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
