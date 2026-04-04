import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { getServerInfo, TimewebError } from "@/modules/timeweb/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  try {
    const info = await getServerInfo();
    return apiResponse(info);
  } catch (error) {
    if (error instanceof TimewebError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
