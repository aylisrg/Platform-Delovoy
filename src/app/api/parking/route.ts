import { apiResponse } from "@/lib/api-response";
import { getParkingInfo } from "@/modules/parking/service";

/**
 * GET /api/parking — get parking information
 */
export async function GET() {
  const info = getParkingInfo();
  return apiResponse(info);
}
