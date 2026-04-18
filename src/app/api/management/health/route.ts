import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { getHealth } from "@/modules/management/service";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const health = await getHealth();
    return apiResponse(health);
  } catch {
    return apiServerError();
  }
}
