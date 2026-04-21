import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { listBackupsQuerySchema } from "@/modules/backups/validation";
import { listBackups } from "@/modules/backups/service";

/**
 * GET /api/admin/backups
 * Returns paginated list of BackupLog entries. SUPERADMIN only.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const url = new URL(request.url);
  const queryObj = Object.fromEntries(url.searchParams.entries());
  const parsed = listBackupsQuerySchema.safeParse(queryObj);
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
    );
  }

  try {
    const { items, total } = await listBackups({
      type: parsed.data.type,
      status: parsed.data.status,
      from: parsed.data.from ? new Date(parsed.data.from) : undefined,
      to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return apiResponse(items, {
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) {
    console.error("[admin/backups] GET failed:", err);
    return apiServerError("Не удалось получить список бекапов");
  }
}
