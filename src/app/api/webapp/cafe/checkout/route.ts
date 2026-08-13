import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { logAudit } from "@/lib/logger";
import { createCheckout, OrderError } from "@/modules/cafe/service";
import { checkoutSchema } from "@/modules/cafe/validation";
import type { CheckoutResult } from "@/modules/cafe/types";

/**
 * POST /api/webapp/cafe/checkout — заказ кафе из Mini App (ADR §3.2, вариант B).
 *
 * Тонкая обёртка: бизнес-логика целиком остаётся в `createCheckout`, сервисы
 * кафе не меняются ни на строку. Роут подставляет `user.id` из подписанного
 * JWT вместо NextAuth-cookie, которой у Mini App нет — иначе каждый заказ из
 * Mini App был бы гостевым: без «Моих заказов», без email профиля для чека
 * 54-ФЗ и без следа в AuditLog.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const limited = await rateLimit(request, "authenticated", user.id);
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await createCheckout(user.id, parsed.data);

    await logAudit(user.id, "order.create", "Order", result.id, {
      source: "webapp",
      itemCount: parsed.data.items.length,
      paymentId: result.payment?.id ?? null,
    });

    return apiResponse(toCheckoutDto(result), undefined, 201);
  } catch (error) {
    if (error instanceof OrderError) {
      // Нет контакта для чека 54-ФЗ — это про ввод: клиент показывает поле
      // email и повторяет запрос. Остальные отказы сервиса — 400 со своим
      // кодом (ITEM_NOT_FOUND и т.п.).
      const status = error.code === "PAYMENT_CONTACT_REQUIRED" ? 422 : 400;
      return apiError(error.code, error.message, status);
    }
    console.error("[WebApp API] Cafe checkout error:", error);
    return apiServerError();
  }
}

/**
 * DTO собирается явно: наружу уходит только то, что нужно экрану заказа.
 * Служебные поля заказа (moduleSlug, userId, bookingId, deletedAt) в Mini App
 * не отдаём, а Decimal превращаем в число — клиенту не нужно знать, что цена
 * приезжает строкой.
 */
function toCheckoutDto(result: CheckoutResult) {
  return {
    id: result.id,
    orderNumber: result.id.slice(-6).toUpperCase(),
    status: result.status,
    totalAmount: Number(result.totalAmount),
    items: result.items.map((item) => ({
      name: item.name ?? "Позиция",
      quantity: item.quantity,
      price: Number(item.price),
    })),
    payment: result.payment,
  };
}
