import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { getServerStats, TimewebError } from "@/modules/timeweb/service";
import { statsQuerySchema } from "@/modules/timeweb/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = statsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0].message);
  }

  try {
    const stats = await getServerStats({
      dateFrom: parsed.data.date_from,
      dateTo: parsed.data.date_to,
    });
    return apiResponse(stats);
  } catch (error) {
    if (error instanceof TimewebError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
