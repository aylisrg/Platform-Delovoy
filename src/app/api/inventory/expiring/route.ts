import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getExpiringBatches, InventoryError } from "@/modules/inventory/service-v2";
import { expiringFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = expiringFilterSchema.safeParse({
      days: searchParams.get("days") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const batches = await getExpiringBatches(parsed.data.days);
    return apiResponse(batches, { total: batches.length });
  } catch (error) {
    if (error instanceof InventoryError) {
      const { apiError } = await import("@/lib/api-response");
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
