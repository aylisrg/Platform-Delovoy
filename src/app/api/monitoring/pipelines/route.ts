import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  aggregateNextIssueRuns,
  aggregateRuns,
  listPipelineRuns,
  readNextIssueMetrics,
} from "@/modules/pipeline-metrics/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/pipelines — list recent pipeline runs + aggregate metrics
 * (pipeline.sh + /next-issue, issue #582).
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

    const nextIssueEvents = await readNextIssueMetrics();
    const nextIssueAggregate = aggregateNextIssueRuns(nextIssueEvents);

    return apiResponse({ runs, aggregate, nextIssueEvents, nextIssueAggregate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiServerError(`Не удалось прочитать метрики pipeline: ${message}`);
  }
}
