"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { NotificationMetrics, StatsSkips } from "@/modules/notifications/types";
import {
  GLOSSARY,
  TELEGRAM_READ_CAPTION,
  formatCount,
  formatDuration,
  formatPercent,
} from "./format";

/**
 * «i» next to a metric — the glossary definition (AC-D1.2). Opens on click /
 * tap (mobile has no hover) and on keyboard focus; Escape or a click outside
 * closes it.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Что значит «${label}»`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold leading-none text-zinc-500 hover:border-zinc-500 hover:text-zinc-700"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-6 z-20 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-xs font-normal normal-case leading-relaxed text-zinc-700 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  info,
  tone = "default",
  children,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  info: string;
  tone?: "default" | "danger" | "success";
  children?: ReactNode;
}) {
  const toneClass = tone === "danger" ? "text-red-600" : tone === "success" ? "text-green-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <span>{label}</span>
        <InfoTip text={info} label={label} />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
      {children}
    </div>
  );
}

/**
 * Metric cards (AC-D1.2): Отправлено, Доставлено, Ошибки, Прочитано (лента),
 * Клики, Доля реакции, Медиана — plus «реакцию измерить нельзя» (AC-D1.6) and
 * skips, shown apart from errors (AC-D4.3).
 */
export function MetricCards({ metrics, skips }: { metrics: NotificationMetrics; skips?: StatsSkips | null }) {
  const m = metrics;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="metric-cards">
      <MetricCard
        label="Отправлено"
        value={formatCount(m.sent)}
        info={GLOSSARY.sent}
        hint={m.inFlight > 0 ? `в обработке: ${formatCount(m.inFlight)}` : undefined}
      />
      <MetricCard
        label="Доставлено"
        value={formatCount(m.delivered)}
        info={GLOSSARY.delivered}
        tone="success"
        hint={m.sent > 0 ? `${formatPercent(m.delivered / m.sent)} от отправленных` : undefined}
      />
      <MetricCard label="Ошибки" value={formatCount(m.failed)} info={GLOSSARY.failed} tone={m.failed > 0 ? "danger" : "default"} />
      <MetricCard label="Прочитано (лента)" value={formatCount(m.read)} info={GLOSSARY.read}>
        <p className="mt-2 text-xs leading-snug text-amber-700">{TELEGRAM_READ_CAPTION}</p>
      </MetricCard>
      <MetricCard
        label="Клики"
        value={formatCount(m.clickedNotifications)}
        info={GLOSSARY.clicks}
        hint={`уведомлений с кликом; всего кликов: ${formatCount(m.clicksTotal)}`}
      />
      <MetricCard
        label="Доля реакции"
        value={formatPercent(m.reactionRate)}
        info={GLOSSARY.reactionRate}
        hint={`${formatCount(m.reactions)} из ${formatCount(m.measurable)} измеримых`}
      />
      <MetricCard
        label="Медиана до реакции"
        value={formatDuration(m.medianReactionSeconds)}
        info={GLOSSARY.median}
        hint={
          m.noReaction24hShare === null ? undefined : `без реакции за 24 ч: ${formatPercent(m.noReaction24hShare)}`
        }
      />
      <MetricCard label="Реакцию измерить нельзя" value={formatCount(m.unmeasurable)} info={GLOSSARY.unmeasurable} />
      {skips && (
        <MetricCard
          label="Пропущено"
          value={formatCount(skips.total)}
          info={GLOSSARY.skips}
          hint={
            skips.byReason.length > 0
              ? skips.byReason.map((r) => `${r.label.toLocaleLowerCase("ru-RU")}: ${formatCount(r.count)}`).join(" · ")
              : undefined
          }
        />
      )}
    </div>
  );
}
