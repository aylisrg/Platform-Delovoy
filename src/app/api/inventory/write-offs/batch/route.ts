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
import { createBatchWriteOff, InventoryError } from "@/modules/inventory/service-v2";
import { batchWriteOffSchema } from "@/modules/inventory/validation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = batchWriteOffSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const results = await createBatchWriteOff(parsed.data.items, session.user.id);

    await logAudit(session.user.id, "inventory.write-off.batch", "WriteOff", undefined, {
      itemCount: parsed.data.items.length,
    });

    return apiResponse(results, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
