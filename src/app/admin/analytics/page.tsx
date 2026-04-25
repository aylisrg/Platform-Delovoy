"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  OverviewData,
  CampaignsData,
  ConversionsData,
  CampaignStats,
} from "@/modules/analytics/types";
import { formatDate, formatDateTime } from "@/lib/format";

type Period = "today" | "7d" | "30d";
type SortKey = "cost" | "clicks" | "impressions" | "ctr" | "avgCpc" | "costShare";

function formatCurrency(n: number | null, currency = "RUB") {
  if (n === null) return "—";
  const symbol = currency === "RUB" ? "₽" : currency;
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${symbol}`;
}

function formatPct(n: number) {
  return `${n.toFixed(2)}%`;
}

function formatInt(n: number) {
  return n.toLocaleString("ru-RU");
}

function formatPeriod(dateFrom: string, dateTo: string) {
  const f = formatDate(dateFrom);
  const t = formatDate(dateTo);
  return f === t ? f : `${f} — ${t}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACCEPTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
    ARCHIVED: "bg-zinc-50 text-zinc-500 border-zinc-200",
    ENDED: "bg-zinc-50 text-zinc-500 border-zinc-200",
    SUSPENDED: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const labels: Record<string, string> = {
    ACCEPTED: "Активна",
    DRAFT: "Черновик",
    ARCHIVED: "Архив",
    ENDED: "Завершена",
    SUSPENDED: "Остановлена",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
        styles[status] ?? "bg-zinc-50 text-zinc-600 border-zinc-200"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function Sparkbar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null);
  const [conversions, setConversions] = useState<ConversionsData | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    const arr = [...campaigns.campaigns];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const diff = av - bv;
      return sortDir === "asc" ? diff : -diff;
    });
    return arr;
  }, [campaigns, sortKey, sortDir]);

  const balanceCurrency = overview?.balance.currency ?? "RUB";
  const totalSpent = overview?.advertising.cost ?? 0;
  const balance = overview?.balance.amount ?? null;

  const balanceWarn =
    balance !== null && totalSpent > 0 && balance < totalSpent * 0.2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide text-zinc-400 font-semibold">
              Маркетинг
            </span>
            {overview && (
              <span className="text-xs text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">
                {formatPeriod(overview.period.dateFrom, overview.period.dateTo)}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">
            Аналитика рекламы
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Яндекс.Директ и Яндекс.Метрика — единая сводка для рекламного аналитика
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-zinc-200 overflow-hidden bg-white">
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
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>
      </div>

      {/* Cached at */}
      {overview?.cachedAt && (
        <p className="text-xs text-zinc-400 -mt-3">
          Обновлено: {formatDateTime(overview.cachedAt)} · кэш 15 минут
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

      {overview && (
        <>
          {/* === ROW 1: Money & balance === */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BigStat
              label="Расход за период"
              value={formatCurrency(totalSpent, balanceCurrency)}
              hint={`${overview.summary.activeCampaigns} активных кампаний · ${overview.summary.costIncludesVat ? "с НДС" : "без НДС"}`}
              tone="primary"
            />
            <BigStat
              label="Баланс рекламного счёта"
              value={
                balance !== null
                  ? formatCurrency(balance, balanceCurrency)
                  : "—"
              }
              hint={
                overview.balance.source === "agency_api"
                  ? "Через API Директа"
                  : overview.balance.source === "manual_env"
                    ? "Из переменной окружения"
                    : "Недоступно — настройте YANDEX_DIRECT_BALANCE_MANUAL"
              }
              tone={balanceWarn ? "warn" : balance === null ? "muted" : "default"}
            />
            <BigStat
              label="Стоимость рекламной конверсии"
              value={formatCurrency(
                overview.summary.costPerAdConversion,
                balanceCurrency
              )}
              hint={
                overview.summary.adSourceConversions > 0
                  ? `${overview.summary.adSourceConversions} конверсий из Директа`
                  : "Нет конверсий из рекламы за период"
              }
              tone="default"
            />
          </div>

          {balance !== null && totalSpent > 0 && (
            <BalanceBar
              balance={balance}
              spent={totalSpent}
              currency={balanceCurrency}
            />
          )}

          {/* === ROW 2: Traffic & engagement === */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat
              label="Визиты на сайт"
              value={formatInt(overview.traffic.visits)}
              sub={`${formatInt(overview.traffic.users)} пользователей · все источники`}
            />
            <Stat
              label="Просмотры"
              value={formatInt(overview.traffic.pageviews)}
              sub={`Отказы: ${formatPct(overview.traffic.bounceRate)}`}
            />
            <Stat
              label="Среднее время"
              value={`${Math.round(overview.traffic.avgVisitDuration)} сек`}
              sub="на сайте"
            />
            <Stat
              label="Конверсия сайта"
              value={
                overview.traffic.visits > 0
                  ? formatPct(
                      (overview.summary.totalConversions /
                        overview.traffic.visits) *
                        100
                    )
                  : "—"
              }
              sub={`${overview.summary.totalConversions} достижений целей · все источники`}
            />
          </div>

          {/* === ROW 3: Ad performance === */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat
              label="Показы рекламы"
              value={formatInt(overview.advertising.impressions)}
            />
            <Stat
              label="Клики из Директа"
              value={formatInt(overview.advertising.clicks)}
              sub={`CTR ${formatPct(overview.advertising.ctr)} · ${formatInt(overview.adSourceVisits)} визитов`}
            />
            <Stat
              label="Средний CPC"
              value={formatCurrency(overview.advertising.avgCpc, balanceCurrency)}
            />
            <Stat
              label="Лучшая по CTR"
              value={
                overview.summary.bestCampaignByCtr
                  ? formatPct(overview.summary.bestCampaignByCtr.ctr)
                  : "—"
              }
              sub={overview.summary.bestCampaignByCtr?.name ?? "нет данных"}
            />
          </div>

          {/* === Funnel === */}
          {conversions && (
            <Section
              title="Воронка рекламы: показы → клики → визиты → конверсии"
              subtitle="Только трафик из Яндекс.Директа (lastSourceEngine = ya_direct)"
            >
              <Funnel
                impressions={overview.advertising.impressions}
                clicks={conversions.funnel.adClicks}
                visits={conversions.funnel.adVisits}
                conversions={conversions.funnel.adConversions}
                adConversionRate={conversions.funnel.adConversionRate}
              />
            </Section>
          )}

          {/* === Campaigns table === */}
          {campaigns && campaigns.campaigns.length > 0 && (
            <Section
              title="Результаты по рекламным кампаниям"
              subtitle="Сортируется по любому столбцу — клик по заголовку"
            >
              <CampaignsTable
                campaigns={sortedCampaigns}
                totals={campaigns.totals}
                currency={balanceCurrency}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </Section>
          )}

          {/* === Goals breakdown === */}
          {overview.conversions.length > 0 && (
            <Section
              title="Конверсии по целям"
              subtitle="«Из рекламы» — только трафик с lastSourceEngine = ya_direct"
            >
              <GoalsTable
                goals={overview.conversions}
                currency={balanceCurrency}
              />
            </Section>
          )}

          {/* === Traffic sources === */}
          {overview.trafficSources.length > 0 && (
            <Section title="Источники трафика">
              <TrafficSourcesTable sources={overview.trafficSources} />
            </Section>
          )}

          {/* === Footer notes === */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 space-y-1">
            <p>
              <strong className="text-zinc-700">Методология.</strong> Расход —
              из CAMPAIGN_PERFORMANCE_REPORT Яндекс.Директа{" "}
              {overview.summary.costIncludesVat ? "с НДС" : "без НДС"}. Если в
              кабинете Директа расход показывается без НДС, цифра здесь будет
              выше на 20%.
            </p>
            <p>
              <strong className="text-zinc-700">Конверсии «из рекламы»</strong>{" "}
              — это достижения целей у визитов, у которых
              `ym:s:lastSourceEngine == &quot;ya_direct&quot;`. Они должны
              совпадать с колонкой «Конверсии» в кабинете Директа.{" "}
              <strong className="text-zinc-700">Всего конверсий</strong> — сумма
              достижений целей со ВСЕХ источников (как видно в Метрике).
            </p>
            <p>
              Цели типа `step` (композитные) исключены из подсчёта, чтобы не
              было двойного учёта. Все остальные цели (action, url, phone, file,
              messenger и т.д.) включены — как в кабинете Метрики.
            </p>
            <p>
              Даты в часовом поясе Europe/Moscow (как в кабинете). Кэш — 15
              минут (5 минут для баланса).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// === Components ===

function BigStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "primary" | "default" | "warn" | "muted";
}) {
  const styles = {
    primary: "border-blue-200 bg-blue-50",
    default: "border-zinc-200 bg-white",
    warn: "border-amber-300 bg-amber-50",
    muted: "border-dashed border-zinc-200 bg-zinc-50",
  };
  return (
    <div className={`rounded-xl border p-5 ${styles[tone]}`}>
      <p className="text-sm text-zinc-500 mb-1">{label}</p>
      <p
        className={`text-3xl font-bold tracking-tight ${
          tone === "muted" ? "text-zinc-400" : "text-zinc-900"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-zinc-500 mt-2">{hint}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-semibold text-zinc-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1 truncate">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function BalanceBar({
  balance,
  spent,
  currency,
}: {
  balance: number;
  spent: number;
  currency: string;
}) {
  const total = balance + spent;
  const balancePct = total > 0 ? (balance / total) * 100 : 0;
  const spentPct = total > 0 ? (spent / total) * 100 : 0;
  const burnRate = spent > 0 ? balance / (spent / 30) : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-700">
          Соотношение «потрачено / на счёте»
        </h3>
        {burnRate !== null && (
          <p className="text-xs text-zinc-500">
            При текущем темпе хватит на ~{Math.round(burnRate)} дн.
          </p>
        )}
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="bg-blue-500 transition-all"
          style={{ width: `${spentPct}%` }}
          title={`Потрачено: ${spent}`}
        />
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${balancePct}%` }}
          title={`Баланс: ${balance}`}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-blue-600 font-medium">
          Потрачено: {formatCurrency(spent, currency)}
        </span>
        <span className="text-emerald-600 font-medium">
          На счёте: {formatCurrency(balance, currency)}
        </span>
      </div>
    </div>
  );
}

function Funnel({
  impressions,
  clicks,
  visits,
  conversions,
  adConversionRate,
}: {
  impressions: number;
  clicks: number;
  visits: number;
  conversions: number;
  adConversionRate: number;
}) {
  const max = Math.max(impressions, clicks, visits, conversions, 1);
  const rows = [
    { label: "Показы рекламы", value: impressions, color: "bg-zinc-300" },
    { label: "Клики (Директ)", value: clicks, color: "bg-zinc-400" },
    { label: "Визиты с рекламы", value: visits, color: "bg-blue-500" },
    { label: "Конверсии с рекламы", value: conversions, color: "bg-emerald-500" },
  ];
  const clickToVisit = clicks > 0 ? (visits / clicks) * 100 : 0;

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-zinc-600">{r.label}</span>
            <span className="font-semibold text-zinc-900">
              {formatInt(r.value)}
            </span>
          </div>
          <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${r.color} rounded-full transition-all`}
              style={{
                width: `${Math.max(2, Math.round((r.value / max) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-4 text-xs text-zinc-500 pt-1">
        <div>
          Доезд клик → визит:{" "}
          <span className="font-semibold text-zinc-700">
            {formatPct(clickToVisit)}
          </span>
        </div>
        <div>
          Конверсия рекламы (визит → цель):{" "}
          <span
            className={`font-semibold ${
              adConversionRate < 1 ? "text-amber-600" : "text-emerald-600"
            }`}
          >
            {formatPct(adConversionRate)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  keyName,
  align = "right",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  keyName: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className={`pb-2 px-3 font-medium cursor-pointer hover:text-zinc-700 select-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onSort(keyName)}
    >
      {label}
      {sortKey === keyName && (
        <span className="ml-1 text-zinc-400">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

function CampaignsTable({
  campaigns,
  totals,
  currency,
  sortKey,
  sortDir,
  onSort,
}: {
  campaigns: CampaignStats[];
  totals: { impressions: number; clicks: number; ctr: number; cost: number; avgCpc: number };
  currency: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const maxCost = Math.max(...campaigns.map((c) => c.cost), 1);
  const ctrs = campaigns.filter((c) => c.impressions > 0).map((c) => c.ctr);
  const bestCtr = ctrs.length > 0 ? Math.max(...ctrs) : 0;
  const worstCtr = ctrs.length > 1 ? Math.min(...ctrs) : -1;

  const sortProps = { sortKey, sortDir, onSort };

  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500">
            <th className="pb-2 px-3 text-left font-medium">Кампания</th>
            <th className="pb-2 px-3 text-left font-medium">Статус</th>
            <SortHeader label="Показы" keyName="impressions" {...sortProps} />
            <SortHeader label="Клики" keyName="clicks" {...sortProps} />
            <SortHeader label="CTR" keyName="ctr" {...sortProps} />
            <SortHeader label="CPC" keyName="avgCpc" {...sortProps} />
            <SortHeader label="Расход" keyName="cost" {...sortProps} />
            <SortHeader label="Доля" keyName="costShare" {...sortProps} />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr
              key={c.campaignId}
              className="border-b border-zinc-100 hover:bg-zinc-50/50"
            >
              <td className="py-3 px-3 text-zinc-900 font-medium max-w-[280px]">
                <div className="truncate" title={c.campaignName}>
                  {c.campaignName || `#${c.campaignId}`}
                </div>
              </td>
              <td className="py-3 px-3">
                <StatusBadge status={c.status} />
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatInt(c.impressions)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatInt(c.clicks)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                <span
                  className={
                    c.ctr === bestCtr && c.impressions > 0
                      ? "text-emerald-600 font-semibold"
                      : c.ctr === worstCtr && worstCtr > -1
                        ? "text-amber-600"
                        : "text-zinc-700"
                  }
                >
                  {formatPct(c.ctr)}
                </span>
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatCurrency(c.avgCpc, currency)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                <div className="font-semibold text-zinc-900">
                  {formatCurrency(c.cost, currency)}
                </div>
                <div className="mt-1">
                  <Sparkbar value={c.cost} max={maxCost} />
                </div>
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-500">
                {formatPct(c.costShare)}
              </td>
            </tr>
          ))}
          <tr className="font-medium bg-zinc-50">
            <td className="py-3 px-3 text-zinc-900" colSpan={2}>
              Итого по {campaigns.length}{" "}
              {campaigns.length === 1 ? "кампании" : "кампаниям"}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">
              {formatInt(totals.impressions)}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">
              {formatInt(totals.clicks)}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">
              {formatPct(totals.ctr)}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">
              {formatCurrency(totals.avgCpc, currency)}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">
              {formatCurrency(totals.cost, currency)}
            </td>
            <td className="py-3 px-3 text-right tabular-nums">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GoalsTable({
  goals,
  currency,
}: {
  goals: OverviewData["conversions"];
  currency: string;
}) {
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 text-left">
            <th className="pb-2 px-3 font-medium">Цель</th>
            <th className="pb-2 px-3 text-right font-medium" title="Все источники, как в Метрике">
              Всего
            </th>
            <th className="pb-2 px-3 text-right font-medium" title="Только трафик из Яндекс.Директа">
              Из рекламы
            </th>
            <th className="pb-2 px-3 text-right font-medium">CR сайта</th>
            <th
              className="pb-2 px-3 text-right font-medium"
              title="Расход × (рекламные конверсии цели / всех рекламных конверсий)"
            >
              Распределённый расход
            </th>
            <th className="pb-2 px-3 text-right font-medium">CPA рекламы</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr
              key={g.goalId}
              className="border-b border-zinc-100 hover:bg-zinc-50/50"
            >
              <td className="py-3 px-3 text-zinc-900 font-medium">
                <div className="flex items-center gap-2">
                  <span>{g.goalName}</span>
                  <span className="text-xs text-zinc-400 font-normal">
                    {g.goalType}
                  </span>
                </div>
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatInt(g.reaches)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-900 font-medium">
                {formatInt(g.reachesFromAds)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-600">
                {formatPct(g.conversionRate)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatCurrency(g.attributedCost, currency)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-zinc-700">
                {formatCurrency(g.costPerAdConversion, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrafficSourcesTable({
  sources,
}: {
  sources: OverviewData["trafficSources"];
}) {
  const max = Math.max(...sources.map((s) => s.visits), 1);
  return (
    <div className="space-y-2">
      {sources.map((s) => (
        <div key={s.source} className="flex items-center gap-3">
          <div className="w-32 text-sm text-zinc-700 truncate" title={s.source}>
            {s.source}
          </div>
          <div className="flex-1">
            <Sparkbar value={s.visits} max={max} />
          </div>
          <div className="w-20 text-right text-sm tabular-nums text-zinc-700">
            {formatInt(s.visits)}
          </div>
          <div className="w-14 text-right text-xs tabular-nums text-zinc-500">
            {formatPct(s.percentage)}
          </div>
        </div>
      ))}
    </div>
  );
}
