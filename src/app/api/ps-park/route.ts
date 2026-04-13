import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { listTables } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park — list all active Плей Парк tables
 */
export async function GET(request: NextRequest) {
  try {
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const resources = await listTables(!showAll);
    return apiResponse(resources);
  } catch {
    return apiServerError();
  }
}
