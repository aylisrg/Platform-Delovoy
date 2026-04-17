import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import {
  aggregateRuns,
  listPipelineRuns,
} from "@/modules/pipeline-metrics/service";
import type { PipelineVerdict } from "@/modules/pipeline-metrics/types";

export const dynamic = "force-dynamic";

const verdictVariant: Record<
  PipelineVerdict,
  "success" | "warning" | "danger" | "info"
> = {
  PASS: "success",
  NEEDS_CHANGES: "warning",
  FAIL: "danger",
  "n/a": "info",
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}с`;
  const mins = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${mins}м ${s}с`;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function PipelinesMonitoringPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");

  const runs = await listPipelineRuns(50);
  const aggregate = aggregateRuns(runs);

  return (
    <>
      <AdminHeader title="Pipeline агентов" />
      <div className="p-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
          <StatusWidget
            title="Прогонов (50 последних)"
            value={aggregate.totalRuns}
            status="info"
          />
          <StatusWidget
            title="Success rate"
            value={formatPct(aggregate.successRate)}
            status={
              aggregate.successRate >= 0.8
                ? "success"
                : aggregate.successRate >= 0.5
                  ? "warning"
                  : "danger"
            }
          />
          <StatusWidget
            title="Средняя длительность"
            value={formatDuration(aggregate.avgDurationSec)}
            status="info"
          />
          <StatusWidget
            title="QA итераций (avg)"
            value={aggregate.avgQaIterations.toFixed(1)}
            status={
              aggregate.avgQaIterations <= 1.2
                ? "success"
                : aggregate.avgQaIterations <= 2
                  ? "warning"
                  : "danger"
            }
          />
        </div>

        <Card className="mt-8">
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Метрики по стейджам</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500">
                    <th className="py-2 pr-4">Стейдж</th>
                    <th className="py-2 pr-4">Прогонов</th>
                    <th className="py-2 pr-4">Среднее время</th>
                    <th className="py-2">Failure rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(aggregate.byStage).map(([stage, s]) => (
                    <tr key={stage} className="border-b border-zinc-100">
                      <td className="py-2 pr-4 font-mono text-zinc-800">
                        {stage}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">{s.runs}</td>
                      <td className="py-2 pr-4 text-zinc-700">
                        {s.runs > 0 ? formatDuration(s.avgDurationSec) : "—"}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={
                            s.failureRate === 0
                              ? "success"
                              : s.failureRate < 0.2
                                ? "warning"
                                : "danger"
                          }
                        >
                          {s.runs > 0 ? formatPct(s.failureRate) : "—"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">
                Последние прогоны pipeline
              </h2>
              <Link
                href="/admin/monitoring"
                className="text-sm text-blue-600 hover:underline"
              >
                ← К общему мониторингу
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-zinc-400">
                Ни одного прогона pipeline пока не зафиксировано. Запусти{" "}
                <code className="rounded bg-zinc-100 px-1">
                  ./scripts/pipeline.sh
                </code>{" "}
                чтобы увидеть метрики.
              </p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.runId}
                    className="flex items-start justify-between gap-4 rounded border border-zinc-200 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={verdictVariant[run.finalVerdict]}>
                          {run.finalVerdict}
                        </Badge>
                        <span className="truncate font-medium text-zinc-900">
                          {run.task || "(задача не указана)"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        <span className="font-mono">{run.runId}</span>
                        {" · "}
                        {run.stages.length} событий
                        {" · "}
                        Reviewer: {run.reviewerIterations}
                        {" · "}
                        QA: {run.qaIterations}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>{formatDuration(run.totalDurationSec)}</div>
                      <div>
                        {new Date(run.startedAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
