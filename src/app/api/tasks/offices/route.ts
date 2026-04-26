import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { officeSuggestSchema } from "@/modules/tasks/validation";
import { suggestOffices } from "@/modules/tasks/report-service";
import { getClientIp, rateLimitCustom } from "@/modules/tasks/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = await rateLimitCustom(ip, "tasks-office-suggest", 30, 60);
  if (limited) return limited;

  try {
    const q = request.nextUrl.searchParams.get("q");
    const parsed = officeSuggestSchema.safeParse({ q });
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid query");
    }
    const items = await suggestOffices(parsed.data.q);
    return apiResponse(items);
  } catch {
    return apiServerError();
  }
}
