import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getTelephonyHealth } from "@/modules/telephony/service";
import { apiForbidden } from "@/lib/api-response";

/**
 * GET /api/telephony/health — telephony module health check
 * RBAC: SUPERADMIN only
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const user = session.user as { id: string; role: import("@prisma/client").Role };
    if (!hasRole(user, "SUPERADMIN")) {
      return apiForbidden();
    }

    const health = await getTelephonyHealth();
    return apiResponse(health);
  } catch {
    return apiServerError();
  }
}
