import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { getAggregateAnalytics } from "@/modules/monitoring/architect-service";
import { analyticsQuerySchema } from "@/modules/monitoring/architect-validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { searchParams } = new URL(req.url);
  const parsed = analyticsQuerySchema.safeParse({
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
  });

  if (!parsed.success) {
    return apiValidationError(parsed.error.errors[0]?.message ?? "Ошибка валидации");
  }

  try {
    const analytics = await getAggregateAnalytics(parsed.data);
    return apiResponse(analytics);
  } catch {
    return apiServerError();
  }
}
