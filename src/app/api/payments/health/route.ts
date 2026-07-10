import { auth } from "@/lib/auth";
import { apiResponse, apiForbidden, apiUnauthorized, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { receiptsEnabled } from "@/lib/yookassa/receipts";

/**
 * GET /api/payments/health — здоровье модуля payments.
 * configured=false — ключи не заданы (онлайн-оплата выключена, POS работает).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const [succeeded24h, canceled24h, stuckPending] = await Promise.all([
      prisma.payment.count({ where: { status: "SUCCEEDED", paidAt: { gte: dayAgo } } }),
      prisma.payment.count({ where: { status: "CANCELED", updatedAt: { gte: dayAgo } } }),
      prisma.payment.count({
        where: {
          status: { in: ["PENDING", "WAITING_FOR_CAPTURE"] },
          createdAt: { lt: new Date(Date.now() - 2 * 3_600_000) },
        },
      }),
    ]);

    return apiResponse({
      module: "payments",
      status: stuckPending > 0 ? "degraded" : "ok",
      configured: isYooKassaConfigured(),
      webhookConfigured: Boolean(process.env.YOOKASSA_WEBHOOK_SECRET),
      receiptsEnabled: receiptsEnabled(),
      succeeded24h,
      canceled24h,
      stuckPending,
    });
  } catch {
    return apiServerError();
  }
}
