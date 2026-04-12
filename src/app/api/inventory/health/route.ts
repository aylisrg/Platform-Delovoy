import { apiResponse, apiServerError } from "@/lib/api-response";
import { getHealth } from "@/modules/inventory/service";

/**
 * GET /api/inventory/health — module health check
 */
export async function GET() {
  try {
    const health = await getHealth();
    return apiResponse(health);
  } catch {
    return apiServerError();
  }
}
