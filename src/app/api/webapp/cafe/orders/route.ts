import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { webappOrdersQuerySchema } from "@/lib/webapp/validation";
import { listOrders } from "@/modules/cafe/service";

type ListedOrder = Awaited<ReturnType<typeof listOrders>>["orders"][number];

/**
 * GET /api/webapp/cafe/orders — заказы кафе текущего пользователя (ADR §3.2).
 *
 * Тонкая обёртка над `listOrders`: фильтр по `userId` берётся из токена, а не
 * из query — чужие заказы недостижимы в принципе. `listOrders` подтягивает
 * связь `user { name, email }` для админки; DTO собирается явно, чтобы эти
 * поля не уезжали в Mini App.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const limited = await rateLimit(request, "authenticated", user.id);
    if (limited) return limited;

    const parsed = webappOrdersQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { orders } = await listOrders({ userId: user.id });

    return apiResponse({
      orders: orders.slice(0, parsed.data.limit).map(toOrderDto),
    });
  } catch (error) {
    console.error("[WebApp API] Cafe orders error:", error);
    return apiServerError();
  }
}

function toOrderDto(order: ListedOrder) {
  return {
    id: order.id,
    // Тот же номер, что клиент называет на кассе (createCheckout/уведомления).
    orderNumber: order.id.slice(-6).toUpperCase(),
    status: order.status,
    totalAmount: Number(order.totalAmount),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      name: item.name ?? "Позиция",
      quantity: item.quantity,
      price: Number(item.price),
    })),
  };
}
