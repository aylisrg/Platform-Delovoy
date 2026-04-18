import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { writeOffExpiredBatches, InventoryError } from "@/modules/inventory/service-v2";

export async function POST(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const results = await writeOffExpiredBatches(session.user.id);

    await logAudit(session.user.id, "inventory.write-off.expired-batch", "WriteOff", undefined, {
      count: results.length,
    });

    return apiResponse({ writeOffs: results, count: results.length });
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
