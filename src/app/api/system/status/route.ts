import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiForbidden,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { getSystemStatus } from "@/modules/monitoring/system-status-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") {
    return apiForbidden();
  }

  try {
    const status = await getSystemStatus();
    return apiResponse(status);
  } catch {
    return apiServerError();
  }
}
