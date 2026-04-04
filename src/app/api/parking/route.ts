import { apiResponse, apiServerError } from "@/lib/api-response";
import { getParkingInfo } from "@/modules/parking/service";

/**
 * GET /api/parking — get parking information
 */
export async function GET() {
  try {
    const info = getParkingInfo();
    return apiResponse(info);
  } catch {
    return apiServerError();
  }
}
