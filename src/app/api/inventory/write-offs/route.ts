import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listWriteOffs, createWriteOff, InventoryError } from "@/modules/inventory/service-v2";
import { createWriteOffSchema, writeOffFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = writeOffFilterSchema.safeParse({
      skuId: searchParams.get("skuId") ?? undefined,
      reason: searchParams.get("reason") ?? undefined,
      performedById: searchParams.get("performedById") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      perPage: searchParams.get("perPage") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await listWriteOffs(parsed.data);
    return apiResponse(result.writeOffs, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = createWriteOffSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await createWriteOff(parsed.data, session.user.id);

    await logAudit(session.user.id, "inventory.write-off.create", "WriteOff", result.writeOffId, {
      skuId: parsed.data.skuId,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
    });

    return apiResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
