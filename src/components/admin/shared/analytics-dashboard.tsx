"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

type AnalyticsData = {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  averageCheck: number;
  occupancyRate: number;
  byDay: { date: string; bookings: number; revenue: number }[];
  byResource: { resourceId: string; resourceName: string; bookings: number; revenue: number }[];
  topHours: { hour: number; bookings: number }[];
};

type AnalyticsDashboardProps = {
  moduleSlug: string;
  resourceLabel: string; // "Беседка" or "Стол"
};

export function AnalyticsDashboard({ moduleSlug, resourceLabel }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAnalytics() {
    setLoading(true);
    try {
      const res = await fetch(`/api/${moduleSlug}/analytics?period=${period}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return <div className="py-8 text-center text-sm text-zinc-400 animate-pulse">Загрузка аналитики...</div>;
  }

  if (!data) {
    return <div className="py-8 text-center text-sm text-zinc-400">Не удалось загрузить данные</div>;
  }

  return (
    <div>
      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {(["week", "month", "quarter"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {p === "week" ? "Неделя" : p === "month" ? "Месяц" : "Квартал"}
          </button>
        ))}
        {loading && <span className="text-xs text-zinc-400 self-center animate-pulse">Обновление...</span>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Бронирований"
          value={data.totalBookings}
          subtitle={`${data.completedBookings} завершено`}
        />
        <KPICard
          title="Выручка"
          value={`${data.totalRevenue.toLocaleString("ru-RU")} ₽`}
          subtitle={`Средний чек: ${data.averageCheck.toLocaleString("ru-RU")} ₽`}
        />
        <KPICard
          title="Загрузка"
          value={`${Math.round(data.occupancyRate * 100)}%`}
          subtitle="от максимальной"
        />
        <KPICard
          title="Отменено"
          value={data.cancelledBookings}
          subtitle={data.totalBookings > 0 ? `${Math.round((data.cancelledBookings / data.totalBookings) * 100)}% от всех` : "—"}
        />
      </div>

      {/* Top resources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold text-zinc-900 mb-3">Популярные {resourceLabel.toLowerCase()}ы</h3>
            {data.byResource.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет данных</p>
            ) : (
              <div className="space-y-2">
                {data.byResource.slice(0, 5).map((r, i) => (
                  <div key={r.resourceId} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-700">
                      <span className="text-zinc-400 mr-2">#{i + 1}</span>
                      {r.resourceName}
                    </span>
                    <span className="text-zinc-500">
                      {r.bookings} брон. · {r.revenue.toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold text-zinc-900 mb-3">Пиковые часы</h3>
            {data.topHours.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет данных</p>
            ) : (
              <div className="space-y-2">
                {data.topHours.slice(0, 8).map((h) => (
                  <div key={h.hour} className="flex items-center gap-3 text-sm">
                    <span className="text-zinc-500 w-12 text-right">{h.hour}:00</span>
                    <div className="flex-1 bg-zinc-100 rounded-full h-4">
                      <div
                        className="bg-blue-500 rounded-full h-4"
                        style={{ width: `${Math.min(100, (h.bookings / (data.topHours[0]?.bookings ?? 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-zinc-700 font-medium w-8">{h.bookings}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By day table */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold text-zinc-900 mb-3">По дням</h3>
          {data.byDay.length === 0 ? (
            <p className="text-sm text-zinc-400">Нет данных за выбранный период</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-2 font-medium">Дата</th>
                    <th className="pb-2 font-medium text-right">Бронирований</th>
                    <th className="pb-2 font-medium text-right">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDay.map((d) => (
                    <tr key={d.date} className="border-b border-zinc-50">
                      <td className="py-2 text-zinc-900">{new Date(d.date).toLocaleDateString("ru-RU")}</td>
                      <td className="py-2 text-zinc-600 text-right">{d.bookings}</td>
                      <td className="py-2 text-zinc-600 text-right">{d.revenue.toLocaleString("ru-RU")} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KPICard({ title, value, subtitle }: { title: string; value: string | number; subtitle: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-zinc-500 mb-1">{title}</div>
        <div className="text-2xl font-bold text-zinc-900">{value}</div>
        <div className="text-xs text-zinc-400 mt-0.5">{subtitle}</div>
      </CardContent>
    </Card>
  );
}
