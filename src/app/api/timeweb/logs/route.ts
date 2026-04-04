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
import { getServerLogs, TimewebError } from "@/modules/timeweb/service";
import { logsQuerySchema } from "@/modules/timeweb/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = logsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0].message);
  }

  try {
    const logs = await getServerLogs(parsed.data);
    return apiResponse(logs);
  } catch (error) {
    if (error instanceof TimewebError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
