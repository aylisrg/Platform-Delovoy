import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { getPaginatedAuditLogs } from "@/modules/monitoring/architect-service";
import { auditFilterSchema } from "@/modules/monitoring/architect-validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { searchParams } = new URL(req.url);
  const parsed = auditFilterSchema.safeParse({
    userId: searchParams.get("userId") ?? undefined,
    entity: searchParams.get("entity") ?? undefined,
    action: searchParams.get("action") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });

  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? "Ошибка валидации");
  }

  try {
    const result = await getPaginatedAuditLogs(parsed.data);
    return apiResponse(result.logs, { total: result.total });
  } catch {
    return apiServerError();
  }
}
