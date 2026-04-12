import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRecentEvents, getEventStats } from "@/modules/monitoring/service";
import type { EventLevel } from "@prisma/client";

export const dynamic = "force-dynamic";

const levelVariant: Record<EventLevel, "success" | "warning" | "danger" | "info"> = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "danger",
  CRITICAL: "danger",
};

export default async function MonitoringPage() {
  let stats = { last24h: 0, lastHour: 0, criticalCount: 0 };
  let events: Awaited<ReturnType<typeof getRecentEvents>>["events"] = [];

  try {
    stats = await getEventStats();
    const result = await getRecentEvents({ limit: 20 });
    events = result.events;
  } catch {
    // DB may not be available yet
  }

  return (
    <>
      <AdminHeader title="Мониторинг" />
      <div className="p-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <StatusWidget
            title="Событий за 24ч"
            value={stats.last24h}
            status="info"
          />
          <StatusWidget
            title="Событий за час"
            value={stats.lastHour}
            status="info"
          />
          <StatusWidget
            title="Ошибки за 24ч"
            value={stats.criticalCount}
            status={stats.criticalCount > 0 ? "danger" : "success"}
            description={stats.criticalCount === 0 ? "Вы красавчики." : undefined}
          />
        </div>

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Последние события</h2>
              <a
                href="/admin/architect/logs"
                className="text-sm text-blue-600 hover:underline"
              >
                Полный лог и аудит →
              </a>
            </div>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-zinc-400">Всё тихо. Слишком тихо... (это хорошо, не переживайте)</p>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 text-sm">
                    <Badge variant={levelVariant[event.level]}>{event.level}</Badge>
                    <div className="flex-1">
                      <span className="font-mono text-xs text-zinc-400">[{event.source}]</span>{" "}
                      <span className="text-zinc-700">{event.message}</span>
                    </div>
                    <span className="text-xs text-zinc-400 whitespace-nowrap">
                      {new Date(event.createdAt).toLocaleString("ru-RU")}
                    </span>
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
