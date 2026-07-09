import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  yooPaymentSchema,
  yooRefundSchema,
  yooErrorSchema,
  type CreatePaymentRequest,
  type CreateRefundRequest,
  type YooPayment,
  type YooRefund,
} from "./types";

/**
 * Тонкий клиент YooKassa API v3 на нативном fetch.
 *
 * Правила (см. docs/architecture/2026-07-08-yookassa-integration-plan.md § 4.3):
 * - Basic auth: shopId:secretKey из env.
 * - Idempotence-Key обязателен для POST; вызывающий код сохраняет ключ в БД
 *   ДО запроса и передаёт его сюда — ретрай после 5xx/таймаута идёт с тем же
 *   ключом (окно идемпотентности ЮKassa — 24 ч), иначе риск двойного списания.
 * - HTTP 500/сеть/429 → до 3 попыток с бэкоффом; 4xx — без ретрая.
 */

const API_BASE = "https://api.yookassa.ru/v3";
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export class YooKassaError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number
  ) {
    super(message);
    this.name = "YooKassaError";
  }
}

export function isYooKassaConfigured(): boolean {
  return Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

export function newIdempotenceKey(): string {
  return randomUUID();
}

/** Decimal/number → строка вида "1500.00" (формат amount.value ЮKassa). */
export function toAmountValue(value: number | string | { toString(): string }): string {
  const num = Number(value.toString());
  if (!Number.isFinite(num) || num < 0) {
    throw new YooKassaError("invalid_amount", `Некорректная сумма: ${value}`, 0);
  }
  return num.toFixed(2);
}

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID ?? "";
  const secretKey = process.env.YOOKASSA_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<S extends z.ZodType>(
  schema: S,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotenceKey?: string } = {}
): Promise<z.infer<S>> {
  if (!isYooKassaConfigured()) {
    throw new YooKassaError(
      "not_configured",
      "YooKassa не настроена: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY",
      0
    );
  }

  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
  };
  if (method === "POST") {
    if (!options.idempotenceKey) {
      throw new YooKassaError("missing_idempotence_key", "POST без Idempotence-Key запрещён", 0);
    }
    headers["Idempotence-Key"] = options.idempotenceKey;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      // Сетевая ошибка ≠ провал операции — ретрай с тем же Idempotence-Key.
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    if (response.ok) {
      const json = await response.json();
      return schema.parse(json);
    }

    if (response.status >= 500 || response.status === 429) {
      lastError = new YooKassaError(
        response.status === 429 ? "too_many_requests" : "internal_server_error",
        `YooKassa API ${response.status}`,
        response.status
      );
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    // 4xx — постоянная ошибка, ретрай бессмысленен
    let code = "unknown_error";
    let description = `YooKassa API ${response.status}`;
    try {
      const parsed = yooErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        code = parsed.data.code;
        description = parsed.data.description ?? description;
      }
    } catch {
      // тело не JSON — оставляем generic-описание
    }
    throw new YooKassaError(code, description, response.status);
  }

  if (lastError instanceof YooKassaError) throw lastError;
  throw new YooKassaError(
    "network_error",
    `YooKassa API недоступен после ${MAX_ATTEMPTS} попыток`,
    0
  );
}

export async function createPayment(
  params: CreatePaymentRequest,
  idempotenceKey: string
): Promise<YooPayment> {
  return request(yooPaymentSchema, "POST", "/payments", { body: params, idempotenceKey });
}

export async function getPayment(providerPaymentId: string): Promise<YooPayment> {
  return request(yooPaymentSchema, "GET", `/payments/${encodeURIComponent(providerPaymentId)}`);
}

/** Отмена платежа в waiting_for_capture (снятие холда, бесплатно). */
export async function cancelPayment(
  providerPaymentId: string,
  idempotenceKey: string
): Promise<YooPayment> {
  return request(
    yooPaymentSchema,
    "POST",
    `/payments/${encodeURIComponent(providerPaymentId)}/cancel`,
    { body: {}, idempotenceKey }
  );
}

export async function createRefund(
  params: CreateRefundRequest,
  idempotenceKey: string
): Promise<YooRefund> {
  return request(yooRefundSchema, "POST", "/refunds", { body: params, idempotenceKey });
}
