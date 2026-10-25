"use client";

import { useState } from "react";
import { NOTIFICATION_CATALOG } from "@/modules/notifications/catalog";
import { channelLabel } from "@/modules/notifications/delivery-labels";
import type { RecentDeliveryStatus, UserNotificationStats } from "@/modules/notifications/types";
import { MetricCards } from "@/components/admin/notifications/stats/metric-cards";
import { BreakdownTable, type BreakdownRow } from "@/components/admin/notifications/stats/breakdown-table";
import { UserProblemsBlock } from "@/components/admin/notifications/stats/problems-block";
import { useStatsFetch } from "@/components/admin/notifications/stats/use-stats-fetch";
import {
  PERIOD_OPTIONS,
  PUSH_READ_CAPTION,
  TELEGRAM_READ_CAPTION,
  formatDateTime,
  measuredSinceText,
  reactionText,
  type PeriodOption,
} from "@/components/admin/notifications/stats/format";

/**
 * «Статистика» на странице сотрудника (US-D2): те же показатели за 7/30/90
 * дней, разбивка по событиям и каналам, 20 последних уведомлений (без текстов,
 * AC-D2.2) с человеческими причинами ошибок (AC-D2.3) и проблемы бота
 * (AC-D4.1). ADR 2026-10-25-team-access-notifications §6.2/§7.
 */

const CATEGORY_LABELS = Object.fromEntries(NOTIFICATION_CATALOG.map((c) => [c.key, c.label]));

const STATUS_STYLES: Record<RecentDeliveryStatus, string> = {
  DELIVERED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  IN_FLIGHT: "bg-yellow-100 text-yellow-800",
  SKIPPED: "bg-zinc-100 text-zinc-700",
};

function channelCaption(channel: string): string | undefined {
  if (channel === "TELEGRAM") return TELEGRAM_READ_CAPTION;
  if (channel === "PUSH") return PUSH_READ_CAPTION;
  return undefined;
}

export function UserStatsBlock({ userId }: { userId: string }) {
  const [period, setPeriod] = useState<PeriodOption>(30);
  const { data, error, loading } = useStatsFetch<UserNotificationStats>(
    `/api/users/${encodeURIComponent(userId)}/notification-stats?period=${period}`,
  );

  const eventRows: BreakdownRow[] = (data?.byEvent ?? [])
    .filter((row) => row.sent > 0)
    .map((row) => ({ key: row.eventType, label: row.label, sortLabel: row.label, group: row.categoryKey, metrics: row }));

  const channelRows: BreakdownRow[] = (data?.byChannel ?? [])
    .filter((row) => row.sent > 0)
    .map((row) => ({
      key: row.channel,
      label: channelLabel(row.channel),
      sortLabel: channelLabel(row.channel),
      caption: channelCaption(row.channel),
      metrics: row,
    }));

  const partialNote = data ? measuredSinceText(data.measuredSince) : null;

  return (
    <section aria-labelledby={`user-stats-${userId}`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`user-stats-${userId}`} className="text-base font-semibold text-zinc-900">
          Статистика уведомлений
        </h2>
        <div className="flex items-center gap-3">
          {loading && <span className="text-sm text-zinc-400">Загрузка…</span>}
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
        </div>
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
          <MetricCards metrics={data.totals} skips={data.skips} />

          <UserProblemsBlock problems={data.problems} days={data.period.days} />

          <BreakdownTable
            title="По типам событий"
            firstColumn="Событие"
            rows={eventRows}
            groupLabels={CATEGORY_LABELS}
            emptyText="Уведомлений за период не было"
          />

          <BreakdownTable
            title="По каналам"
            firstColumn="Канал"
            rows={channelRows}
            emptyText="Уведомлений за период не было"
          />

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">Последние уведомления</h3>
              <p className="text-xs text-zinc-500">До 20 последних за период. Текст сообщений не показываем — в нём могут быть данные клиентов.</p>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-400">Уведомлений за период не было</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Когда</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Событие</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Канал</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Статус</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Реакция</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.recent.map((item, index) => (
                      <tr key={`${item.at}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-600">{formatDateTime(item.at)}</td>
                        <td className="px-3 py-2 text-zinc-900">{item.eventLabel}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{channelLabel(item.channel)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status]}`}>
                            {item.statusLabel}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{reactionText(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
