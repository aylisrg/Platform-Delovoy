import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { refundPayment } from "@/modules/payments/service";
import { PaymentError } from "@/modules/payments/types";
import { refundRequestSchema } from "@/modules/payments/validation";

/**
 * POST /api/payments/:id/refund — ручной полный возврат.
 * Решение владельца: возвраты-исключения доступны только SUPERADMIN;
 * автовозвраты по политике отмены система делает сама.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") {
      return apiForbidden("Возврат может оформить только суперадмин");
    }

    const body = await request.json().catch(() => null);
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { id } = await params;
    const refundId = await refundPayment(id, {
      reason: parsed.data.reason,
      performedById: session.user.id,
      performedByName: session.user.name ?? session.user.email ?? "SUPERADMIN",
    });

    return apiResponse({ refundId });
  } catch (err) {
    if (err instanceof PaymentError) {
      const status = err.code === "PAYMENT_NOT_FOUND" ? 404 : 400;
      return apiError(err.code, err.message, status, err.metadata);
    }
    return apiServerError();
  }
}
