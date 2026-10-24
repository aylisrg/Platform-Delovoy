"use client";

import { useId, useState } from "react";
import { Card, Icon } from "@/components/webapp/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import type { TelephonyDailySummary } from "@/modules/telephony/daily-summary-types";

const secondary = "color-mix(in srgb, var(--tg-text) 64%, var(--tg-section-bg))";
const formatCount = (value: number) => value.toLocaleString("ru-RU");

/** A saved daily report in the Mini App feed; expanding it never navigates away. */
export function TelephonyDailySummaryCard({
  summary,
  unread,
  onRead,
}: {
  summary: TelephonyDailySummary;
  unread: boolean;
  onRead: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const detailsId = useId();

  function toggleDetails() {
    if (!expanded && unread) onRead();
    setExpanded((value) => !value);
  }

  return (
    <Card role="article" aria-labelledby={headingId}>
      <div className="p-4 pb-0">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: "var(--tg-accent)",
              background: "color-mix(in srgb, var(--tg-accent) 12%, var(--tg-section-bg))",
            }}
          >
            <Icon name="bell" size={21} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-[16px] font-semibold leading-snug">Звонки за день</h3>
            <p className="mt-1 text-[13px]" style={{ color: secondary }}>
              <time dateTime={summary.reportDate}>{formatDate(summary.reportDate)}</time> · МСК
            </p>
          </div>
          {unread && (
            <span
              role="img"
              aria-label="Не прочитано"
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: "var(--tg-accent)" }}
            />
          )}
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-2">
          <SummaryMetric label="Всего" value={summary.total} />
          <SummaryMetric label="Принято" value={summary.answered} />
          <SummaryMetric label="Пропущено" value={summary.missed} attention={summary.missed > 0} />
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: secondary }}>
          Принято и пропущено — только входящие.
        </p>

        {summary.total === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: secondary }}>
            За этот день в журнале нет звонков.
          </p>
        ) : summary.missed > 0 ? (
          <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-relaxed" style={{ color: "var(--tg-destructive)" }}>
            <span className="mt-0.5 shrink-0"><Icon name="alert" size={16} /></span>
            Есть пропущенные обращения
          </p>
        ) : summary.pending > 0 ? null : (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: secondary }}>
            Пропущенных входящих в журнале нет.
          </p>
        )}
        {summary.pending > 0 && (
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: secondary }}>
            У {formatCount(summary.pending)} входящих результат уточняется.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={toggleDetails}
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`${expanded ? "Скрыть подробности" : "Подробнее"} о звонках за ${formatDate(summary.reportDate)}`}
        className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-[14px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
        style={{ color: "var(--tg-link)", outlineColor: "var(--tg-accent)", borderTop: "1px solid var(--tg-separator)" }}
      >
        <span>{expanded ? "Свернуть подробности" : "Подробнее за день"}</span>
        <span className={expanded ? "-rotate-90" : "rotate-90"}><Icon name="chevron-right" size={18} /></span>
      </button>

      <div id={detailsId} hidden={!expanded} className="px-4 pb-4">
        <dl className="space-y-2.5 rounded-xl p-3 text-[13px]" style={{ background: "var(--tg-secondary-bg)" }}>
          <Detail label="Входящих" value={formatCount(summary.inbound)} />
          <Detail label="Исходящих" value={formatCount(summary.outbound)} />
          <Detail label="Результат уточняется" value={formatCount(summary.pending)} />
          <Detail label="Доля принятых" value={summary.answerRate === null ? "—" : `${summary.answerRate.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`} />
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: secondary }}>
          Доля принятых — среди входящих с известным результатом. Исходящие и звонки с уточняющимся результатом в неё не входят.
        </p>
        {summary.missed > 0 && (
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: secondary }}>
            Последующие перезвоны не меняют число пропущенных в этой сводке.
          </p>
        )}
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: secondary }}>
          Сформировано <time dateTime={summary.generatedAt}>{formatDateTime(summary.generatedAt)} МСК</time>.
          {" "}Итоги сохранены на этот момент и не обновляются вместе с журналом.
        </p>
      </div>
    </Card>
  );
}

function SummaryMetric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl px-2 py-3" style={{ background: "var(--tg-secondary-bg)" }}>
      <dt className="text-[12px] font-medium leading-snug" style={{ color: secondary }}>{label}</dt>
      <dd
        className="mt-1.5 break-all text-[26px] font-semibold leading-tight tracking-tight tabular-nums"
        style={{ color: attention ? "var(--tg-destructive)" : "var(--tg-text)" }}
      >
        {formatCount(value)}
      </dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: secondary }}>{label}</dt>
      <dd className="font-medium tabular-nums" style={{ color: "var(--tg-text)" }}>{value}</dd>
    </div>
  );
}
