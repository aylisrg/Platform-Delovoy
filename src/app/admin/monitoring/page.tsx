import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TelegramSettings } from "@/components/admin/telegram/telegram-settings";
import { NotificationFlowMap } from "@/components/admin/notifications/NotificationFlowMap";
import { NotificationChannelTests } from "@/components/admin/notifications/NotificationChannelTests";
import { getRecentEvents, getEventStats } from "@/modules/monitoring/service";
import { notificationsHealth } from "@/modules/notifications/health";
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
  let tgHealth: Awaited<ReturnType<typeof notificationsHealth>> | null = null;

  try {
    const [statsResult, eventsResult, healthResult] = await Promise.allSettled([
      getEventStats(),
      getRecentEvents({ limit: 20 }),
      notificationsHealth(),
    ]);
    if (statsResult.status === "fulfilled") stats = statsResult.value;
    if (eventsResult.status === "fulfilled") events = eventsResult.value.events;
    if (healthResult.status === "fulfilled") tgHealth = healthResult.value;
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

        {/* Telegram channel status — visible immediately without client fetch */}
        {tgHealth && (
          <div className={`mt-6 rounded-xl border px-5 py-4 flex items-start gap-4 flex-wrap ${tgHealth.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <span className="text-xl mt-0.5">{tgHealth.ok ? "✅" : "⚠️"}</span>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm ${tgHealth.ok ? "text-green-800" : "text-red-800"}`}>
                {tgHealth.ok ? "Telegram-канал работает" : "Проблема с Telegram-каналом"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span className={tgHealth.checks.botToken.ok ? "text-green-700" : "text-red-600"}>
                  {tgHealth.checks.botToken.ok
                    ? `Бот @${tgHealth.checks.botToken.username ?? "ok"}`
                    : `Бот: ${tgHealth.checks.botToken.reason}`}
                </span>
                <span className={tgHealth.checks.adminChat.ok ? "text-green-700" : "text-red-600"}>
                  {tgHealth.checks.adminChat.ok
                    ? `Группа: ${tgHealth.checks.adminChat.title ?? "ok"}`
                    : `Группа: ${tgHealth.checks.adminChat.reason}`}
                </span>
                <span className={tgHealth.checks.ownerChat.ok ? "text-green-700" : "text-red-600"}>
                  {tgHealth.checks.ownerChat.ok
                    ? "Владелец: ok"
                    : `Владелец: ${tgHealth.checks.ownerChat.reason}`}
                </span>
                {tgHealth.checks.queue.failedLastHour > 0 && (
                  <span className="text-orange-600">
                    Не доставлено за час: {tgHealth.checks.queue.failedLastHour}
                  </span>
                )}
                <span className="text-zinc-400">
                  В очереди: {tgHealth.checks.queue.pending}
                </span>
                {tgHealth.checks.cron.lastRunAt && (
                  <span className="text-zinc-400">
                    Cron: {tgHealth.checks.cron.staleMin} мин назад
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Последние события</h2>
              <div className="flex gap-4">
                <a
                  href="/admin/monitoring/pipelines"
                  className="text-sm text-blue-600 hover:underline"
                >
                  Pipeline агентов →
                </a>
                <a
                  href="/admin/architect/logs"
                  className="text-sm text-blue-600 hover:underline"
                >
                  Полный лог и аудит →
                </a>
              </div>
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

        {/* Telegram & Notifications System */}
        <div className="mt-8 space-y-8">
          <section>
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-zinc-900">Тест каналов уведомлений</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Нажмите «Тест» — бот отправит проверочное сообщение в конкретный канал. Удобно периодически проверять, что маршрутизация цела.
              </p>
            </div>
            <NotificationChannelTests />
          </section>

          <section>
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-zinc-900">Карта уведомлений</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Визуальная схема: какие события куда и кому отправляет бот
              </p>
            </div>
            <NotificationFlowMap />
          </section>

          <section>
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-zinc-900">Настройки Telegram-бота</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Chat ID, токены, пользователи Telegram
              </p>
            </div>
            <TelegramSettings />
          </section>
        </div>
      </div>
    </>
  );
}
