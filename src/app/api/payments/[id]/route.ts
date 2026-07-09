import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError } from "@/lib/api-response";
import { pollPayment } from "@/modules/payments/service";

/**
 * GET /api/payments/:id — публичный статус платежа для страницы ожидания
 * оплаты. id (cuid) выступает capability-токеном: наружу отдаются только
 * status и confirmationUrl, без сумм и внутренних полей. Для нефинальных
 * статусов дополнительно сверяется состояние у провайдера (fallback на
 * случай недоставленного вебхука).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const status = await pollPayment(id);
    if (!status) return apiNotFound("Платёж не найден");
    return apiResponse(status);
  } catch {
    return apiServerError();
  }
}
