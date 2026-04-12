import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getInventoryDashboard } from "@/modules/inventory/service-v2";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const data = await getInventoryDashboard();
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
