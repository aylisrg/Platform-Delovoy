import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getAggregateAnalytics } from "@/modules/monitoring/architect-service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  let analytics: Awaited<ReturnType<typeof getAggregateAnalytics>> | null = null;

  try {
    analytics = await getAggregateAnalytics();
  } catch {
    // DB unavailable
  }

  return (
    <>
      <AdminHeader title="Аналитика" />
      <div className="p-8 space-y-8">
        {!analytics ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-400">
            Нет данных
          </div>
        ) : (
          <>
            {/* Bookings */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-zinc-900">Бронирования</h2>
                <p className="text-xs text-zinc-400">За последние 7 дней</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <StatusWidget
                    title="Сегодня"
                    value={analytics.bookings.todayTotal}
                    status="info"
                  />
                  <StatusWidget
                    title="За неделю"
                    value={analytics.bookings.weekTotal}
                    status="info"
                  />
                  {Object.entries(analytics.bookings.byModule).map(([slug, count]) => (
                    <StatusWidget
                      key={slug}
                      title={slug}
                      value={count}
                      description="за неделю"
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Orders */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-zinc-900">Заказы кафе</h2>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <StatusWidget
                    title="Заказов сегодня"
                    value={analytics.orders.todayCount}
                    status="info"
                  />
                  <StatusWidget
                    title="Выручка сегодня"
                    value={`${analytics.orders.todayRevenue.toLocaleString("ru-RU")} ₽`}
                    status="info"
                  />
                  <StatusWidget
                    title="Выручка за неделю"
                    value={`${analytics.orders.weekRevenue.toLocaleString("ru-RU")} ₽`}
                    status="success"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Rental */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-zinc-900">Аренда офисов</h2>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatusWidget
                    title="Активных договоров"
                    value={analytics.rental.activeContracts}
                    status="info"
                  />
                  <StatusWidget
                    title="Выручка / мес"
                    value={`${analytics.rental.monthlyRevenue.toLocaleString("ru-RU")} ₽`}
                    status="success"
                  />
                  <StatusWidget
                    title="Занятость"
                    value={`${analytics.rental.occupancyRate}%`}
                    status={
                      analytics.rental.occupancyRate >= 80
                        ? "success"
                        : analytics.rental.occupancyRate >= 50
                          ? "warning"
                          : "danger"
                    }
                  />
                  <StatusWidget
                    title="Истекают (30 дн.)"
                    value={analytics.rental.expiringIn30Days}
                    status={analytics.rental.expiringIn30Days > 0 ? "warning" : "success"}
                  />
                </div>
              </CardContent>
            </Card>

            {/* System events */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-zinc-900">Системные события</h2>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <StatusWidget
                    title="За 24 часа"
                    value={analytics.systemEvents.last24h}
                    status="info"
                  />
                  <StatusWidget
                    title="За последний час"
                    value={analytics.systemEvents.lastHour}
                    status="info"
                  />
                  <StatusWidget
                    title="Ошибок за 24ч"
                    value={analytics.systemEvents.criticalCount}
                    status={analytics.systemEvents.criticalCount > 0 ? "danger" : "success"}
                  />
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-zinc-400 text-right">
              Обновлено: {new Date(analytics.generatedAt).toLocaleString("ru-RU")}
            </p>
          </>
        )}
      </div>
    </>
  );
}
