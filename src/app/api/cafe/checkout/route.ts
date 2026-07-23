import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { log, logAudit } from "@/lib/logger";
import { createCheckout, OrderError } from "@/modules/cafe/service";
import { checkoutSchema } from "@/modules/cafe/validation";
import { trackServerGoal } from "@/lib/metrika-server";

/**
 * POST /api/cafe/checkout — публичный QR-чекаут кафе.
 *
 * Гостевой: сессия не обязательна (роут в isPublicPostRoute). Создаёт заказ и
 * платёж ЮKassa; клиент редиректится на confirmationUrl (СБП/карта — выбор на
 * hosted-странице). Без настроенной ЮKassa заказ создаётся для оплаты на кассе.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimit(request, "public");
    if (rateLimited) return rateLimited;

    const session = await auth();
    const userId = session?.user?.id ?? null;

    const body = await request.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await createCheckout(userId, parsed.data);

    if (userId) {
      await logAudit(userId, "order.create", "Order", result.id, {
        itemCount: parsed.data.items.length,
        deliveryTo: parsed.data.deliveryTo,
        checkout: true,
        paymentId: result.payment?.id ?? null,
      });
    } else {
      // Гостевой заказ не привязан к User — INFO-след в SystemEvent.
      await log.info("cafe", "Guest checkout", {
        orderId: result.id,
        itemCount: parsed.data.items.length,
        paymentId: result.payment?.id ?? null,
      });
    }

    // Server-side дубль клиентского reachGoal — AdBlock/ITP режут клиентский.
    trackServerGoal({
      request,
      target: "cafe_order_submit",
      price: Number(result.totalAmount),
    });

    return apiResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof OrderError) {
      const status = error.code === "PAYMENT_CONTACT_REQUIRED" ? 422 : 400;
      return apiError(error.code, error.message, status);
    }
    return apiServerError();
  }
}
