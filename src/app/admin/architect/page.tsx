import { AdminHeader } from "@/components/admin/header";
import { ModuleStatusCard } from "@/components/admin/architect/ModuleStatusCard";
import { getSystemMap } from "@/modules/monitoring/architect-service";

export const dynamic = "force-dynamic";

export default async function ArchitectPage() {
  let modules: Awaited<ReturnType<typeof getSystemMap>> = [];

  try {
    modules = await getSystemMap();
  } catch {
    // DB may not be available in dev
  }

  const healthyCounts = {
    healthy: modules.filter((m) => m.healthStatus === "healthy").length,
    degraded: modules.filter((m) => m.healthStatus === "degraded").length,
    unhealthy: modules.filter((m) => m.healthStatus === "unhealthy" || m.healthStatus === "offline").length,
  };

  return (
    <>
      <AdminHeader title="Карта системы" />
      <div className="p-8">
        <div className="mb-6 flex items-center gap-6 text-sm text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Онлайн: {healthyCounts.healthy}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-yellow-400" />
            Деградация: {healthyCounts.degraded}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-400" />
            Недоступно: {healthyCounts.unhealthy}
          </span>
          <span className="ml-auto text-xs text-zinc-400">
            Всего модулей: {modules.length}
          </span>
        </div>

        {modules.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-400">
            <p>Нет зарегистрированных модулей.</p>
            <p className="text-sm text-zinc-300 mt-2">Звучит как утренний дашборд после планёрки.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((entry) => (
              <ModuleStatusCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <a
            href="/admin/architect/analytics"
            className="block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h3 className="font-semibold text-zinc-900">Аналитика</h3>
            <p className="mt-1 text-sm text-zinc-500">Сводные бизнес-метрики по всем модулям</p>
          </a>
          <a
            href="/admin/architect/logs"
            className="block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h3 className="font-semibold text-zinc-900">Логи и аудит</h3>
            <p className="mt-1 text-sm text-zinc-500">Системные события и история действий</p>
          </a>
          <a
            href="/admin/monitoring"
            className="block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h3 className="font-semibold text-zinc-900">Мониторинг</h3>
            <p className="mt-1 text-sm text-zinc-500">Последние события и статистика ошибок</p>
          </a>
        </div>
      </div>
    </>
  );
}
