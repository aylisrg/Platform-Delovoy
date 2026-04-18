import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { listReceipts } from "@/modules/inventory/service";

/**
 * GET /api/inventory/receipts — history of RECEIPT + INITIAL transactions (MANAGER, SUPERADMIN)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
      return apiForbidden();
    }

    const rows = await listReceipts(50);
    return apiResponse(rows, { total: rows.length });
  } catch {
    return apiServerError();
  }
}
