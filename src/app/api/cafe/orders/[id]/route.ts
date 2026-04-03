import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { hasRole } from "@/lib/permissions";
import { getOrder, updateOrderStatus, cancelOrder, OrderError } from "@/modules/cafe/service";

/**
 * GET /api/cafe/orders/:id — get single order
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await getOrder(id);
    if (!order) return apiNotFound("Заказ не найден");
    return apiResponse(order);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/cafe/orders/:id — update order status
 * Body: { status: "PREPARING" | "READY" | "DELIVERED" | "CANCELLED" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return apiError("VALIDATION_ERROR", "Укажите статус", 422);
    }

    let updated;

    if (status === "CANCELLED" && !hasRole(session.user, "MANAGER")) {
      updated = await cancelOrder(id, session.user.id);
    } else if (hasRole(session.user, "MANAGER")) {
      updated = await updateOrderStatus(id, status);
    } else {
      return apiError("FORBIDDEN", "Недостаточно прав для изменения статуса", 403);
    }

    await logAudit(session.user.id, "order.status_change", "Order", id, {
      newStatus: status,
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof OrderError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
