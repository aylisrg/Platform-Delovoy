import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getAccountSnapshot } from "@/lib/avito";

export const dynamic = "force-dynamic";

/** GET /api/avito/account/balance — SUPERADMIN-only wallet snapshot. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const snapshot = await getAccountSnapshot();
    return apiResponse({ account: snapshot });
  } catch (err) {
    console.error("[GET /api/avito/account/balance] error", err);
    return apiServerError();
  }
}
