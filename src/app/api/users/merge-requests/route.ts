import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { listMergeRequests } from "@/modules/clients/merge-requests";
import { mergeRequestsQuerySchema } from "@/modules/clients/merge-validation";

/**
 * GET /api/users/merge-requests?userId= — open «Запросы на объединение»
 * (AC-E4.3), oldest first. SUPERADMIN only. ADR 2026-10-25 §6.2.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const parsed = mergeRequestsQuerySchema.safeParse({
    userId: request.nextUrl.searchParams.get("userId") ?? undefined,
  });
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const items = await listMergeRequests({ status: "PENDING", userId: parsed.data.userId });
    return apiResponse(items, { total: items.length });
  } catch (error) {
    console.error("[users/merge-requests] unexpected error", error);
    return apiServerError();
  }
}
