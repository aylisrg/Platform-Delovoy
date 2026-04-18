import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { listMovements } from "@/modules/inventory/service-v2";
import { movementFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = movementFilterSchema.safeParse({
      skuId: searchParams.get("skuId") ?? undefined,
      type: searchParams.get("type") ?? undefined,
      referenceType: searchParams.get("referenceType") ?? undefined,
      performedById: searchParams.get("performedById") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      perPage: searchParams.get("perPage") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await listMovements(parsed.data);
    return apiResponse(result.movements, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}
