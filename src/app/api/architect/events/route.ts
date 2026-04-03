import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { getRecentEvents } from "@/modules/monitoring/service";
import { eventsFilterSchema } from "@/modules/monitoring/architect-validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { searchParams } = new URL(req.url);
  const parsed = eventsFilterSchema.safeParse({
    level: searchParams.get("level") ?? undefined,
    source: searchParams.get("source") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });

  if (!parsed.success) {
    return apiValidationError(parsed.error.errors[0]?.message ?? "Ошибка валидации");
  }

  try {
    const result = await getRecentEvents(parsed.data);
    return apiResponse(result.events, { total: result.total });
  } catch {
    return apiServerError();
  }
}
