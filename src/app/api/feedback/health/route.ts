import { apiResponse, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";

/**
 * GET /api/feedback/health — module health check
 */
export async function GET() {
  try {
    // Quick DB check
    await prisma.feedbackItem.count({ take: 1 });

    return apiResponse({
      status: "healthy",
      module: "feedback",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return apiServerError("Модуль обратной связи недоступен");
  }
}
