import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { listResources } from "@/modules/gazebos/service";

/**
 * GET /api/gazebos — list all active gazebo resources
 */
export async function GET(request: NextRequest) {
  try {
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const resources = await listResources(!showAll);
    return apiResponse(resources);
  } catch {
    return apiServerError();
  }
}
