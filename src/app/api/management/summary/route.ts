import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { summaryQuerySchema } from "@/modules/management/validation";
import { getSummary } from "@/modules/management/service";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = summaryQuerySchema.safeParse(params);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const summary = await getSummary(parsed.data);
    return apiResponse(summary);
  } catch {
    return apiServerError();
  }
}
