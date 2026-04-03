import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EventsTable } from "@/components/admin/architect/EventsTable";
import { AuditTable } from "@/components/admin/architect/AuditTable";
import { PaginationControls } from "@/components/admin/architect/PaginationControls";
import { getRecentEvents } from "@/modules/monitoring/service";
import { getPaginatedAuditLogs } from "@/modules/monitoring/architect-service";
import type { EventLevel } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  tab?: string;
  level?: string;
  source?: string;
  entity?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  offset?: string;
  limit?: string;
}>;

type Props = {
  searchParams: SearchParams;
};

const VALID_LEVELS: EventLevel[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];

export default async function LogsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab = sp.tab === "audit" ? "audit" : "events";
  const limit = Math.min(Number(sp.limit ?? 50), 100);
  const offset = Math.max(Number(sp.offset ?? 0), 0);

  let eventsData: { events: Awaited<ReturnType<typeof getRecentEvents>>["events"]; total: number } = { events: [], total: 0 };
  let auditData: { logs: Awaited<ReturnType<typeof getPaginatedAuditLogs>>["logs"]; total: number } = { logs: [], total: 0 };

  const levelParam = VALID_LEVELS.includes(sp.level as EventLevel) ? (sp.level as EventLevel) : undefined;

  try {
    if (tab === "events") {
      eventsData = await getRecentEvents({
        level: levelParam,
        source: sp.source,
        limit,
        offset,
      });
    } else {
      auditData = await getPaginatedAuditLogs({
        entity: sp.entity,
        action: sp.action,
        dateFrom: sp.dateFrom,
        dateTo: sp.dateTo,
        limit,
        offset,
      });
    }
  } catch {
    // DB unavailable
  }

  function buildUrl(overrides: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (sp.level) params.set("level", sp.level);
    if (sp.source) params.set("source", sp.source);
    if (sp.entity) params.set("entity", sp.entity);
    if (sp.action) params.set("action", sp.action);
    if (sp.dateFrom) params.set("dateFrom", sp.dateFrom);
    if (sp.dateTo) params.set("dateTo", sp.dateTo);
    for (const [k, v] of Object.entries(overrides)) {
      params.set(k, v);
    }
    return `/admin/architect/logs?${params.toString()}`;
  }

  return (
    <>
      <AdminHeader title="Логи и аудит" />
      <div className="p-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-200">
          <a
            href={buildUrl({ tab: "events", offset: "0" })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "events"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
          >
            Системные события
          </a>
          <a
            href={buildUrl({ tab: "audit", offset: "0" })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "audit"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
          >
            Аудит действий
          </a>
        </div>

        {/* Filters */}
        <form method="GET" action="/admin/architect/logs" className="flex flex-wrap gap-3">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="offset" value="0" />

          {tab === "events" ? (
            <>
              <select
                name="level"
                defaultValue={sp.level ?? ""}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">Все уровни</option>
                {VALID_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <input
                name="source"
                type="text"
                defaultValue={sp.source ?? ""}
                placeholder="Источник..."
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </>
          ) : (
            <>
              <input
                name="entity"
                type="text"
                defaultValue={sp.entity ?? ""}
                placeholder="Сущность (Booking, Order...)"
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                name="action"
                type="text"
                defaultValue={sp.action ?? ""}
                placeholder="Действие (booking.create...)"
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                name="dateFrom"
                type="date"
                defaultValue={sp.dateFrom ?? ""}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                name="dateTo"
                type="date"
                defaultValue={sp.dateTo ?? ""}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </>
          )}

          <button
            type="submit"
            className="rounded border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            Применить
          </button>
          <a
            href={`/admin/architect/logs?tab=${tab}`}
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            Сбросить
          </a>
        </form>

        {/* Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">
                {tab === "events" ? "Системные события" : "Аудит действий"}
              </h2>
              <span className="text-xs text-zinc-400">
                {tab === "events" ? eventsData.total : auditData.total} записей
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {tab === "events" ? (
              <EventsTable events={eventsData.events} />
            ) : (
              <AuditTable logs={auditData.logs} />
            )}
            <Suspense fallback={null}>
              <PaginationControls
                total={tab === "events" ? eventsData.total : auditData.total}
                offset={offset}
                limit={limit}
              />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
