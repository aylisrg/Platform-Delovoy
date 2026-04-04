import { AdminHeader } from "@/components/admin/header";
import { ServerStatusCard } from "@/components/admin/server/ServerStatusCard";
import { ResourceGauges, NetworkStats } from "@/components/admin/server/ResourceGauges";
import { PowerControls } from "@/components/admin/server/PowerControls";
import { ServerLogs } from "@/components/admin/server/ServerLogs";
import { getServerInfo, getServerStats, getServerLogs } from "@/modules/timeweb/service";
import type { TimewebServerInfo, TimewebServerStats, TimewebServerLogs } from "@/modules/timeweb/types";

export const dynamic = "force-dynamic";

export default async function ServerPage() {
  let info: TimewebServerInfo | null = null;
  let stats: TimewebServerStats | null = null;
  let logs: TimewebServerLogs | null = null;
  let error: string | null = null;

  try {
    [info, stats, logs] = await Promise.all([
      getServerInfo(),
      getServerStats(),
      getServerLogs({ limit: 50, order: "desc" }),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось загрузить данные сервера";
  }

  return (
    <>
      <AdminHeader title="Сервер" />
      <div className="space-y-6 p-8">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {info && <ServerStatusCard info={info} />}

        {stats && (
          <>
            <ResourceGauges data={stats.data} />
            <NetworkStats data={stats.data} />
          </>
        )}

        <PowerControls />

        {logs && <ServerLogs logs={logs.logs} />}
      </div>
    </>
  );
}
