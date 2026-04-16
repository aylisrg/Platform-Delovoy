"use client";

import { useState, useEffect, useCallback } from "react";
import type { OverviewData, CampaignsData, ConversionsData } from "@/modules/analytics/types";

type Period = "today" | "7d" | "30d";

function formatCurrency(n: number | null) {
  if (n === null) return "—";
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

function formatPct(n: number) {
  return `${n.toFixed(2)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACCEPTED: "bg-green-100 text-green-800",
    DRAFT: "bg-yellow-100 text-yellow-800",
    ARCHIVED: "bg-zinc-100 text-zinc-500",
    ENDED: "bg-zinc-100 text-zinc-500",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status}
    </span>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null);
  const [conversions, setConversions] = useState<ConversionsData | null>(null);

  const fetchData = useCallback(async (p: Period, force = false) => {
    setLoading(true);
    setError(null);
    const qs = `period=${p}${force ? "&forceRefresh=true" : ""}`;

    try {
      const [ovRes, campRes, convRes] = await Promise.all([
        fetch(`/api/analytics/overview?${qs}`),
        fetch(`/api/analytics/campaigns?${qs}`),
        fetch(`/api/analytics/conversions?${qs}`),
      ]);

      const ovData = await ovRes.json();
      const campData = await campRes.json();
      const convData = await convRes.json();

      if (ovData.success) setOverview(ovData.data);
      else setError(ovData.error?.message ?? "Ошибка загрузки данных");

      if (campData.success) setCampaigns(campData.data);
      if (convData.success) setConversions(convData.data);
    } catch {
      setError("Ошибка сети. Проверьте подключение.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  const handleRefresh = () => fetchData(period, true);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Аналитика рекламы</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Яндекс.Директ + Яндекс.Метрика
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex rounded-lg border border-zinc-200 overflow-hidden">
            {(["today", "7d", "30d"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === p
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {p === "today" ? "Сегодня" : p === "7d" ? "7 дней" : "30 дней"}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>
      </div>

      {/* Cached at */}
      {overview?.cachedAt && (
        <p className="text-xs text-zinc-400">
          Данные обновлены: {new Date(overview.cachedAt).toLocaleString("ru-RU")}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !overview && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Overview cards */}
      {overview && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Traffic */}
            <Card title="Визиты" value={overview.traffic.visits.toLocaleString("ru-RU")} sub="уникальных пользователей" subValue={overview.traffic.users.toLocaleString("ru-RU")} />
            <Card title="Просмотры страниц" value={overview.traffic.pageviews.toLocaleString("ru-RU")} sub="отказы" subValue={formatPct(overview.traffic.bounceRate)} />
            <Card title="Ср. время на сайте" value={`${Math.round(overview.traffic.avgVisitDuration)} сек`} />

            {/* Advertising */}
            <Card title="Показы рекламы" value={overview.advertising.impressions.toLocaleString("ru-RU")} sub="клики" subValue={overview.advertising.clicks.toLocaleString("ru-RU")} />
            <Card title="CTR" value={formatPct(overview.advertising.ctr)} sub="ср. цена клика" subValue={formatCurrency(overview.advertising.avgCpc)} />
            <Card title="Расход на рекламу" value={formatCurrency(overview.advertising.cost)} highlight />

            {/* Summary */}
            <Card title="Всего конверсий" value={overview.summary.totalConversions.toString()} />
            <Card title="Ср. стоимость конверсии" value={formatCurrency(overview.summary.avgCostPerConversion)} highlight />
          </div>

          {/* Conversions by goal */}
          {overview.conversions.length > 0 && (
            <Section title="Конверсии по целям">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-500">
                      <th className="pb-2 font-medium">Цель</th>
                      <th className="pb-2 font-medium text-right">Достижений</th>
                      <th className="pb-2 font-medium text-right">Конверсия</th>
                      <th className="pb-2 font-medium text-right">Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.conversions.map((c) => (
                      <tr key={c.goalId} className="border-b border-zinc-100">
                        <td className="py-2.5 text-zinc-900">{c.goalName}</td>
                        <td className="py-2.5 text-right font-medium">{c.reaches}</td>
                        <td className="py-2.5 text-right">{formatPct(c.conversionRate)}</td>
                        <td className="py-2.5 text-right">{formatCurrency(c.costPerConversion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}

      {/* Campaigns table */}
      {campaigns && campaigns.campaigns.length > 0 && (
        <Section title="Кампании Яндекс.Директ">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="pb-2 font-medium">Кампания</th>
                  <th className="pb-2 font-medium">Статус</th>
                  <th className="pb-2 font-medium text-right">Показы</th>
                  <th className="pb-2 font-medium text-right">Клики</th>
                  <th className="pb-2 font-medium text-right">CTR</th>
                  <th className="pb-2 font-medium text-right">Расход</th>
                  <th className="pb-2 font-medium text-right">CPC</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.campaigns.map((c) => {
                  const bestCtr = Math.max(...campaigns.campaigns.map((x) => x.ctr));
                  const worstCtr = Math.min(...campaigns.campaigns.filter((x) => x.ctr > 0).map((x) => x.ctr));
                  return (
                    <tr key={c.campaignId} className="border-b border-zinc-100">
                      <td className="py-2.5 text-zinc-900 font-medium">{c.campaignName}</td>
                      <td className="py-2.5"><StatusBadge status={c.status} /></td>
                      <td className="py-2.5 text-right">{c.impressions.toLocaleString("ru-RU")}</td>
                      <td className="py-2.5 text-right">{c.clicks.toLocaleString("ru-RU")}</td>
                      <td className="py-2.5 text-right">
                        <span className={c.ctr === bestCtr ? "text-green-600 font-medium" : c.ctr === worstCtr && c.ctr > 0 ? "text-orange-500" : ""}>
                          {formatPct(c.ctr)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">{formatCurrency(c.cost)}</td>
                      <td className="py-2.5 text-right">{formatCurrency(c.avgCpc)}</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="font-medium bg-zinc-50">
                  <td className="py-2.5 text-zinc-900" colSpan={2}>Итого</td>
                  <td className="py-2.5 text-right">{campaigns.totals.impressions.toLocaleString("ru-RU")}</td>
                  <td className="py-2.5 text-right">{campaigns.totals.clicks.toLocaleString("ru-RU")}</td>
                  <td className="py-2.5 text-right">{formatPct(campaigns.totals.ctr)}</td>
                  <td className="py-2.5 text-right">{formatCurrency(campaigns.totals.cost)}</td>
                  <td className="py-2.5 text-right">{formatCurrency(campaigns.totals.avgCpc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Funnel */}
      {conversions && (
        <Section title="Воронка конверсий">
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-zinc-900">{conversions.funnel.totalVisits}</div>
              <div className="text-zinc-500">Визиты</div>
            </div>
            <div className="text-zinc-300 text-xl">→</div>
            <div className="text-center">
              <div className="text-2xl font-bold text-zinc-900">{conversions.funnel.totalGoalReaches}</div>
              <div className="text-zinc-500">Конверсии</div>
            </div>
            <div className="text-zinc-300 text-xl">→</div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${conversions.funnel.overallConversionRate < 1 ? "text-orange-500" : "text-green-600"}`}>
                {formatPct(conversions.funnel.overallConversionRate)}
              </div>
              <div className="text-zinc-500">Конверсия</div>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function Card({ title, value, sub, subValue, highlight }: {
  title: string;
  value: string;
  sub?: string;
  subValue?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? "border-blue-200 bg-blue-50" : "border-zinc-200 bg-white"}`}>
      <p className="text-sm text-zinc-500">{title}</p>
      <p className="text-2xl font-bold text-zinc-900 mt-1">{value}</p>
      {sub && (
        <p className="text-xs text-zinc-400 mt-2">
          {sub}: <span className="font-medium text-zinc-600">{subValue}</span>
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}
