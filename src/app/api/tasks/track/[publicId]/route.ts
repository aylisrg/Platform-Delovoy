import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiServerError,
  apiValidationError,
  apiError,
} from "@/lib/api-response";
import { getPublicTask } from "@/modules/tasks/report-service";
import { TaskValidationError } from "@/modules/tasks/access";
import { getClientIp, rateLimitCustom } from "@/modules/tasks/rate-limit";

type Params = { params: Promise<{ publicId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const ip = getClientIp(request);
  const limited = await rateLimitCustom(ip, "tasks-track", 30, 60);
  if (limited) return limited;

  try {
    const { publicId } = await params;
    if (!/^TASK-[2-9A-HJ-NP-Z]{5}$/.test(publicId)) {
      return apiValidationError("invalid publicId");
    }
    const email = request.nextUrl.searchParams.get("email") ?? undefined;
    const data = await getPublicTask(publicId, { email });
    if (!data) return apiNotFound();
    return apiResponse(data);
  } catch (err) {
    if (err instanceof TaskValidationError) return apiError(err.code, err.message, 403);
    return apiServerError();
  }
}
