import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getUserModules } from "@/lib/permissions";
import { listPendingReceipts } from "@/modules/inventory/service-v2";
import { pendingReceiptsFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = pendingReceiptsFilterSchema.safeParse({
      moduleSlug: searchParams.get("moduleSlug") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    let filter: { moduleSlug?: string; modulesSlugs?: string[] } = {};

    if (role === "SUPERADMIN") {
      // Can see all or filter by requested module
      if (parsed.data.moduleSlug) {
        filter.moduleSlug = parsed.data.moduleSlug;
      }
    } else {
      // ADMIN: restrict to their assigned modules
      const userModules = await getUserModules(session.user.id);
      const warehouseModules = userModules.filter((m) =>
        ["cafe", "bbq", "ps-park"].includes(m)
      );
      if (parsed.data.moduleSlug && warehouseModules.includes(parsed.data.moduleSlug)) {
        filter.moduleSlug = parsed.data.moduleSlug;
      } else {
        filter.modulesSlugs = warehouseModules;
      }
    }

    const pending = await listPendingReceipts(filter);
    return apiResponse(pending);
  } catch {
    return apiServerError();
  }
}
