import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { getTelephonyDashboard } from "@/modules/telephony/dashboard-service";
import { telephonyDashboardSchema } from "@/modules/telephony/dashboard-validation";

/** Global provider data has no reliable module attribution; owner access only. */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const parsed = telephonyDashboardSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return apiValidationError("Проверьте период, фильтр и номер страницы");

    const response = apiResponse(await getTelephonyDashboard(parsed.data));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return apiServerError("Не удалось загрузить статистику звонков");
  }
}
