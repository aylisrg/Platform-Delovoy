import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  aggregateRuns,
  listPipelineRuns,
} from "@/modules/pipeline-metrics/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/pipelines — list recent pipeline runs + aggregate metrics
 * RBAC: SUPERADMIN only (pipeline metrics may contain task descriptions
 * that reference internal features)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const runs = await listPipelineRuns(50);
    const aggregate = aggregateRuns(runs);

    return apiResponse({ runs, aggregate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiServerError(`Не удалось прочитать метрики pipeline: ${message}`);
  }
}
