"use client";

import { useMemo, useState } from "react";
import { NOTIFICATION_CATALOG } from "@/modules/notifications/catalog";
import { STATS_CHANNELS, channelLabel, type StatsChannel } from "@/modules/notifications/delivery-labels";
import type { NotificationStats } from "@/modules/notifications/types";
import { MetricCards } from "./metric-cards";
import { BreakdownTable, type BreakdownRow } from "./breakdown-table";
import { ProblemsBlock } from "./problems-block";
import { useStatsFetch } from "./use-stats-fetch";
import {
  GROUP_CHATS_CAPTION,
  PERIOD_OPTIONS,
  PUSH_READ_CAPTION,
  TELEGRAM_READ_CAPTION,
  measuredSinceText,
  type PeriodOption,
} from "./format";

/**
 * Общая страница статистики уведомлений (US-D1, D4). Period 7/30/90 (default
 * 30), slices: event/category, employee (sortable, click = filter), channel.
 * ADR 2026-10-25-team-access-notifications §7 «Статистика (D1/D4)».
 */

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Админ",
  MANAGER: "Менеджер",
};

const CATEGORY_LABELS = Object.fromEntries(NOTIFICATION_CATALOG.map((c) => [c.key, c.label]));
const EVENT_LABELS = new Map(NOTIFICATION_CATALOG.flatMap((c) => c.events.map((e) => [e.eventType, e.label] as const)));

type Filters = { category: string; eventType: string; channel: "" | StatsChannel; userId: string };

const EMPTY_FILTERS: Filters = { category: "", eventType: "", channel: "", userId: "" };

export function buildStatsQuery(period: PeriodOption, filters: Filters): string {
  const params = new URLSearchParams({ period: String(period) });
  if (filters.category) params.set("category", filters.category);
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.userId) params.set("userId", filters.userId);
  return params.toString();
}

function channelCaption(channel: string): string | undefined {
  if (channel === "TELEGRAM") return TELEGRAM_READ_CAPTION;
  if (channel === "PUSH") return PUSH_READ_CAPTION;
  return undefined;
}

export function StatsPage() {
  const [period, setPeriod] = useState<PeriodOption>(30);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { data, error, loading } = useStatsFetch<NotificationStats>(
    `/api/admin/notifications/stats?${buildStatsQuery(period, filters)}`,
  );

  // byUser always lists everyone in scope (a filtered employee too), so it is
  // the name source for the problem links and the filter chip.
  const people = useMemo(
    () => new Map((data?.byUser ?? []).map((row) => [row.user.id, { id: row.user.id, name: row.user.name }])),
    [data],
  );

  const eventOptions = useMemo(() => {
    const categories = filters.category
      ? NOTIFICATION_CATALOG.filter((c) => c.key === filters.category)
      : NOTIFICATION_CATALOG;
    return categories.flatMap((c) => c.events.map((e) => ({ value: e.eventType, label: e.label })));
  }, [filters.category]);

  const eventRows: BreakdownRow[] = useMemo(
    () =>
      (data?.byEvent ?? []).map((row) => ({
        key: row.eventType,
        label: row.label,
        sortLabel: row.label,
        group: row.categoryKey,
        metrics: row,
      })),
    [data],
  );

  const userRows: BreakdownRow[] = useMemo(
    () =>
      (data?.byUser ?? []).map((row) => ({
        key: row.user.id,
        label: (
          <span>
            {row.user.name ?? "Без имени"}{" "}
            <span className="text-xs font-normal text-zinc-500">{ROLE_LABELS[row.user.role] ?? row.user.role}</span>
          </span>
        ),
        sortLabel: row.user.name ?? "",
        metrics: row,
        selected: filters.userId === row.user.id,
        onSelect: () => setFilters((f) => ({ ...f, userId: f.userId === row.user.id ? "" : row.user.id })),
      })),
    [data, filters.userId],
  );

  const channelRows: BreakdownRow[] = useMemo(
    () =>
      (data?.byChannel ?? []).map((row) => ({
        key: row.channel,
        label: channelLabel(row.channel),
        sortLabel: channelLabel(row.channel),
        caption: channelCaption(row.channel),
        metrics: row,
      })),
    [data],
  );

  const showGroupChats = !filters.userId && (!filters.channel || filters.channel === "TELEGRAM");
  const partialNote = data ? measuredSinceText(data.measuredSince) : null;
  const selectedUser = filters.userId ? people.get(filters.userId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Период" className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                period === p ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {p} дней
            </button>
          ))}
        </div>
        <select
          aria-label="Категория"
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value, eventType: "" }))}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">Все категории</option>
          {NOTIFICATION_CATALOG.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Тип события"
          value={filters.eventType}
          onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">Все события</option>
          {eventOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Канал"
          value={filters.channel}
          onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value as Filters["channel"] }))}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">Все каналы</option>
          {STATS_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {channelLabel(c)}
            </option>
          ))}
        </select>
        {filters.userId && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, userId: "" }))}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800 hover:bg-blue-100"
          >
            Сотрудник: {selectedUser?.name ?? "выбран"} <span aria-hidden>✕</span>
            <span className="sr-only">Сбросить фильтр по сотруднику</span>
          </button>
        )}
        {loading && <span className="text-sm text-zinc-400">Загрузка…</span>}
      </div>

      {partialNote && (
        <p role="note" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          {partialNote}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {data && (
        <>
          <MetricCards metrics={data.totals} skips={filters.channel ? null : data.skips} />

          <ProblemsBlock problems={data.problems} people={people} days={data.period.days} eventLabels={EVENT_LABELS} />

          <BreakdownTable title="По типам событий" firstColumn="Событие" rows={eventRows} groupLabels={CATEGORY_LABELS} />

          <BreakdownTable
            title="По сотрудникам"
            firstColumn="Сотрудник"
            rows={userRows}
            sortable
            emptyText="В команде нет сотрудников"
            footnote="Клик по имени — показать статистику только по этому сотруднику. Учитываются только текущие члены команды."
          />

          <BreakdownTable
            title="По каналам"
            firstColumn="Канал"
            rows={channelRows}
            extraRows={
              showGroupChats
                ? [{ key: "group-chats", label: "Групповые чаты", caption: GROUP_CHATS_CAPTION, ...data.groupChats }]
                : []
            }
          />
        </>
      )}
    </div>
  );
}
