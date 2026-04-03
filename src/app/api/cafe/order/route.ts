import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { createOrder, OrderError } from "@/modules/cafe/service";
import { createOrderSchema } from "@/modules/cafe/validation";

/**
 * POST /api/cafe/order — create a new order
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const body = await request.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const order = await createOrder(session.user.id, parsed.data);

    await logAudit(session.user.id, "order.create", "Order", order.id, {
      itemCount: parsed.data.items.length,
      deliveryTo: parsed.data.deliveryTo,
    });

    return apiResponse(order, undefined, 201);
  } catch (error) {
    if (error instanceof OrderError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
