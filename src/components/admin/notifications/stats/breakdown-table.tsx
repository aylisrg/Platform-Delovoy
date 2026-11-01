"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { NotificationMetrics } from "@/modules/notifications/types";
import { formatCount, formatDuration, formatPercent } from "./format";

/**
 * Slice table (AC-D1.3): every row carries the same numbers as the cards.
 * Optional sorting (the «by employee» table), category group headers (the
 * «by event» table) and extra rows without a person (group chats, AC-D1.5).
 */

export type BreakdownRow = {
  key: string;
  label: ReactNode;
  /** Plain text for sorting by name. */
  sortLabel: string;
  metrics: NotificationMetrics;
  /** Permanent caption under the label (AC-D1.4 for Telegram). */
  caption?: string;
  group?: string;
  onSelect?: () => void;
  selected?: boolean;
};

export type BreakdownExtraRow = {
  key: string;
  label: string;
  caption?: string;
  sent: number;
  failed: number;
};

type SortKey =
  | "label"
  | "sent"
  | "delivered"
  | "failed"
  | "read"
  | "clickedNotifications"
  | "measurable"
  | "reactions"
  | "reactionRate"
  | "medianReactionSeconds";

const COLUMNS: Array<{ key: Exclude<SortKey, "label">; title: string }> = [
  { key: "sent", title: "Отправлено" },
  { key: "delivered", title: "Доставлено" },
  { key: "failed", title: "Ошибки" },
  { key: "read", title: "Прочитано" },
  { key: "clickedNotifications", title: "Клики" },
  { key: "measurable", title: "Измеримые" },
  { key: "reactions", title: "Реакции" },
  { key: "reactionRate", title: "Доля реакции" },
  { key: "medianReactionSeconds", title: "Медиана" },
];

function compare(a: BreakdownRow, b: BreakdownRow, key: SortKey): number {
  if (key === "label") return a.sortLabel.localeCompare(b.sortLabel, "ru");
  const x = a.metrics[key];
  const y = b.metrics[key];
  if (x === null && y === null) return 0;
  if (x === null) return 1; // «—» always last
  if (y === null) return -1;
  return x - y;
}

export function sortBreakdownRows(rows: BreakdownRow[], key: SortKey, dir: "asc" | "desc"): BreakdownRow[] {
  return [...rows].sort((a, b) => {
    const base = compare(a, b, key);
    const nullLast = key !== "label" && (a.metrics[key] === null) !== (b.metrics[key] === null);
    return nullLast ? base : dir === "asc" ? base : -base;
  });
}

function cell(m: NotificationMetrics, key: Exclude<SortKey, "label">): string {
  switch (key) {
    case "reactionRate":
      return formatPercent(m.reactionRate);
    case "medianReactionSeconds":
      return formatDuration(m.medianReactionSeconds);
    case "clickedNotifications":
      return m.clicksTotal > m.clickedNotifications
        ? `${formatCount(m.clickedNotifications)} / ${formatCount(m.clicksTotal)}`
        : formatCount(m.clickedNotifications);
    default:
      return formatCount(m[key]);
  }
}

export function BreakdownTable({
  title,
  firstColumn,
  rows,
  sortable = false,
  groupLabels,
  extraRows = [],
  emptyText = "Нет данных за период",
  footnote,
}: {
  title: string;
  firstColumn: string;
  rows: BreakdownRow[];
  sortable?: boolean;
  groupLabels?: Record<string, string>;
  extraRows?: BreakdownExtraRow[];
  emptyText?: string;
  footnote?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const visible = useMemo(
    () => (sortable && sort ? sortBreakdownRows(rows, sort.key, sort.dir) : rows),
    [rows, sortable, sort],
  );
  const showGroups = Boolean(groupLabels) && !(sortable && sort);

  function toggleSort(key: SortKey) {
    if (!sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: key === "label" ? "asc" : "desc" };
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  }

  function header(key: SortKey, titleText: string, align: "left" | "right") {
    const active = sort?.key === key;
    const arrow = active ? (sort?.dir === "asc" ? " ↑" : " ↓") : "";
    const cls = `px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`;
    if (!sortable) return <th key={key} scope="col" className={cls}>{titleText}</th>;
    return (
      <th key={key} scope="col" className={cls} aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => toggleSort(key)} className="hover:text-zinc-900">
          {titleText}
          {arrow}
        </button>
      </th>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              {header("label", firstColumn, "left")}
              {COLUMNS.map((c) => header(c.key, c.title, "right"))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visible.length === 0 && extraRows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-zinc-400">
                  {emptyText}
                </td>
              </tr>
            )}
            {visible.map((row, index) => {
              const startsGroup = showGroups && row.group !== undefined && row.group !== visible[index - 1]?.group;
              const groupHeader = startsGroup ? (
                <tr className="bg-zinc-50/60">
                  <td colSpan={COLUMNS.length + 1} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {(row.group && groupLabels?.[row.group]) ?? row.group}
                  </td>
                </tr>
              ) : null;
              return (
                <Fragment key={row.key}>
                  {groupHeader}
                  <tr className={row.selected ? "bg-blue-50" : undefined}>
                    <td className="px-3 py-2 align-top">
                      {row.onSelect ? (
                        <button type="button" onClick={row.onSelect} className="text-left font-medium text-zinc-900 hover:text-blue-700">
                          {row.label}
                        </button>
                      ) : (
                        <span className="font-medium text-zinc-900">{row.label}</span>
                      )}
                      {row.caption && <p className="mt-1 max-w-xs text-xs leading-snug text-amber-700">{row.caption}</p>}
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums text-zinc-700">
                        {cell(row.metrics, c.key)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
            {extraRows.map((row) => (
              <tr key={row.key} className="bg-zinc-50/40">
                <td className="px-3 py-2 align-top">
                  <span className="font-medium text-zinc-900">{row.label}</span>
                  {row.caption && <p className="mt-1 max-w-xs text-xs leading-snug text-zinc-500">{row.caption}</p>}
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums text-zinc-700">
                    {c.key === "sent" ? formatCount(row.sent) : c.key === "failed" ? formatCount(row.failed) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">{footnote}</div>}
    </section>
  );
}
