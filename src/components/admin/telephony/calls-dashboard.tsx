"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import type {
  TelephonyCallFilter,
  TelephonyDashboard,
  TelephonyJournalCall,
  TelephonyPeriod,
} from "@/modules/telephony/dashboard-types";

const periods: { value: TelephonyPeriod; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
];
const filters: { value: TelephonyCallFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "inbound", label: "Входящие" },
  { value: "answered", label: "Принятые" },
  { value: "missed", label: "Пропущенные" },
  { value: "outbound", label: "Исходящие" },
];
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
const buttonStyle = `min-h-11 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const number = (value: number) => value.toLocaleString("ru-RU");

function duration(value: number | null): string {
  if (value === null) return "—";
  const seconds = Math.round(value);
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6.3-6.3 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 3.8 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L7.8 9.9a16 16 0 0 0 6.3 6.3l1.3-1.3a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 1.8Z" />
    </svg>
  );
}

type Query = { period: TelephonyPeriod; filter: TelephonyCallFilter; page: number };
type Snapshot = { key: string; data: TelephonyDashboard };
type DashboardResponse =
  | { success: true; data: TelephonyDashboard }
  | { success: false; error?: { message?: string } };

export function CallsDashboard({ initialFilter = "all" }: { initialFilter?: TelephonyCallFilter }) {
  const [query, setQuery] = useState<Query>({ period: "today", filter: initialFilter, page: 1 });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const requestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const requestId = useRef(0);
  const journalRef = useRef<HTMLElement>(null);
  const pendingJournalFocus = useRef(false);
  const queryKey = `${query.period}:${query.filter}:${query.page}`;
  const data = snapshot?.data.period === query.period ? snapshot.data : null;
  const journalReady = snapshot?.key === queryKey;
  const currentError = error?.key === queryKey ? error.message : null;
  const busy = loading || (!journalReady && !currentError);

  const load = useCallback(async () => {
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++requestId.current;
    requestRef.current = { controller, id };
    const params = new URLSearchParams({ period: query.period, filter: query.filter, page: String(query.page) });
    try {
      const response = await fetch(`/api/telephony/dashboard?${params}`, { signal: controller.signal, cache: "no-store" });
      const result = await response.json() as DashboardResponse;
      if (controller.signal.aborted || requestRef.current?.id !== id) return;
      if (!response.ok || !result.success) {
        const message = response.status === 403
          ? "У вас нет доступа к статистике звонков."
          : response.status === 401
            ? "Сессия завершена. Войдите в аккаунт заново."
            : "Не удалось загрузить статистику звонков. Попробуйте ещё раз.";
        setError({ key: queryKey, message });
        return;
      }
      setError(null);
      setSnapshot({ key: queryKey, data: result.data });
    } catch {
      if (controller.signal.aborted || requestRef.current?.id !== id) return;
      setError({ key: queryKey, message: "Не удалось связаться с сервером. Проверьте соединение и повторите." });
    } finally {
      if (!controller.signal.aborted && requestRef.current?.id === id) setLoading(false);
    }
  }, [query.period, query.filter, query.page, queryKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Commits happen after the request; loading state is set by event handlers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      requestRef.current?.controller.abort();
    };
  }, [load, refresh]);

  useEffect(() => {
    if (journalReady && pendingJournalFocus.current) {
      pendingJournalFocus.current = false;
      journalRef.current?.scrollIntoView?.({ block: "start" });
      journalRef.current?.focus({ preventScroll: true });
    }
  }, [journalReady, snapshot]);

  function selectFilter(filter: TelephonyCallFilter, scroll = false) {
    if (query.filter !== filter || query.page !== 1) { setError(null); setLoading(true); }
    else if (currentError) refresh();
    setQuery((previous) => ({ ...previous, filter, page: 1 }));
    if (scroll) {
      if (query.filter === filter && query.page === 1 && journalReady) {
        journalRef.current?.scrollIntoView?.({ block: "start" });
        journalRef.current?.focus({ preventScroll: true });
      } else {
        pendingJournalFocus.current = true;
      }
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">Novofon</span>
            <span>Телефония парка</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">Каждый звонок на виду</h2>
          <p className="mt-2 max-w-xl text-sm text-zinc-500">Обращения, принятые звонки и пропущенные — в одной сводке.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1" role="group" aria-label="Период статистики">
            {periods.map((period) => (
              <button key={period.value} type="button" aria-pressed={query.period === period.value}
                onClick={() => { if (query.period === period.value && query.page === 1) { if (currentError) refresh(); return; } setError(null); setLoading(true); setQuery((previous) => ({ ...previous, period: period.value, page: 1 })); }}
                className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors ${focusRing} ${query.period === period.value ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}>
                {period.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={refresh} disabled={busy} className={buttonStyle} aria-label="Обновить статистику звонков">
            <span className="inline-flex items-center gap-2">
              <svg className={`h-4 w-4 ${busy ? "motion-safe:animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
              {busy ? "Загрузка…" : "Обновить"}
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <p>{data ? `${formatDate(data.dateFrom)}${query.period === "today" ? "" : ` — ${formatDate(data.dateTo)}`} · время МСК` : "Все даты и время — МСК"}</p>
        <p>Автообновление раз в минуту</p>
      </div>

      {currentError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div><p className="font-medium">{currentError}</p>{data && <p className="mt-1">Показаны ранее загруженные данные. Они могут быть неактуальны.</p>}</div>
          <button className={buttonStyle} type="button" onClick={refresh} disabled={busy}>Повторить</button>
        </div>
      )}

      {!data && busy && (
        <div role="status" aria-label="Загрузка статистики звонков" className="space-y-5">
          <span className="sr-only">Загружаем статистику звонков</span>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">{[0, 1, 2, 3].map((index) => <div key={index} className="h-40 motion-safe:animate-pulse rounded-2xl border border-zinc-200 bg-white p-5"><div className="mb-5 h-3 w-24 rounded bg-zinc-100" /><div className="h-10 w-16 rounded bg-zinc-100" /></div>)}</div>
          <div className="h-64 motion-safe:animate-pulse rounded-2xl border border-zinc-200 bg-white" aria-hidden="true" />
        </div>
      )}

      {data && (
        <div className="space-y-6" aria-busy={busy}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Всего звонков" value={data.summary.total} detail="За выбранный период" tone="blue" onClick={() => selectFilter("all", true)} />
            <Metric label="Принятые" value={data.summary.answered} detail="Входящие с разговором" tone="green" onClick={() => selectFilter("answered", true)} />
            <Metric label="Пропущенные" value={data.summary.missed} detail="Входящие без ответа" tone={data.summary.missed > 0 ? "red" : "neutral"} onClick={() => selectFilter("missed", true)} />
            <Metric label="Исходящие" value={data.summary.outbound} detail="Все исходящие звонки" tone="neutral" onClick={() => selectFilter("outbound", true)} />
          </div>

          {data.summary.missed > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
              <div className="flex items-start gap-3"><span className="mt-0.5 text-red-600"><PhoneIcon /></span><div><p className="text-sm font-semibold text-red-700">Есть пропущенные входящие: {number(data.summary.missed)}</p><p className="mt-1 text-sm text-zinc-600">Проверьте обращения в журнале. Последующие перезвоны здесь не учитываются.</p></div></div>
              <button type="button" className={`${buttonStyle} shrink-0`} onClick={() => selectFilter("missed", true)}>Показать пропущенные <span aria-hidden="true">↗</span></button>
            </div>
          )}

          {data.summary.total === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500"><PhoneIcon /></div>
              <h3 className="text-lg font-semibold text-zinc-900">За этот период звонков пока нет</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">Выберите другой период. Сводка появится, когда звонки поступят в журнал Novofon.</p>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <CallChart data={data} />
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" aria-labelledby="call-quality-title">
                <h3 id="call-quality-title" className="text-sm font-semibold text-zinc-900">Как отвечаем на звонки</h3>
                <p className="mt-5 text-4xl font-semibold tracking-tight text-zinc-900 tabular-nums">{data.summary.answerRate === null ? "—" : `${number(Math.round(data.summary.answerRate))}%`}</p>
                <p className="mt-2 text-sm text-zinc-500">принято среди входящих<br />с известным результатом</p>
                <div className="my-5 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true"><div className="h-full rounded-full bg-blue-500" style={{ width: `${data.summary.answerRate ?? 0}%` }} /></div>
                <dl className="space-y-3 border-t border-zinc-100 pt-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-zinc-500">Входящих</dt><dd className="font-medium text-zinc-900 tabular-nums">{number(data.summary.inbound)}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Средний разговор</dt><dd className="text-right font-medium text-zinc-900 tabular-nums">{duration(data.summary.avgTalkSeconds)}</dd></div></dl>
                {data.summary.pending > 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">У {number(data.summary.pending)} входящих результат уточняется. Они не включены в долю принятых.</p>}
              </section>
            </div>
          )}

          <section ref={journalRef} tabIndex={-1} className="scroll-mt-5 rounded-2xl border border-zinc-200 bg-white focus:outline-none" aria-labelledby="calls-journal-title">
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="calls-journal-title" className="text-lg font-semibold text-zinc-900">Журнал звонков</h3><p className="text-xs text-zinc-500">Номера скрыты для защиты данных</p></div>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр журнала">
                {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={query.filter === filter.value} onClick={() => selectFilter(filter.value)} className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors ${focusRing} ${query.filter === filter.value ? "bg-blue-50 text-blue-700" : "text-zinc-500 hover:bg-zinc-50"}`}>{filter.label}{" "}<span className="ml-2 text-xs tabular-nums">{number(data.summary[filter.value === "all" ? "total" : filter.value])}</span></button>)}
              </div>
            </div>
            {!journalReady ? <div className="border-t border-zinc-100 px-5 py-10 text-center text-sm text-zinc-500" role="status">{currentError ? "Журнал по выбранному фильтру не загружен" : "Загружаем звонки…"}</div> : data.calls.length === 0 ? <div className="border-t border-zinc-100 px-5 py-10 text-center"><p className="text-sm font-medium text-zinc-700">{query.filter === "missed" ? "Пропущенных звонков за этот период нет" : "Нет звонков по выбранному фильтру"}</p><p className="mt-1 text-sm text-zinc-500">Измените фильтр или период, чтобы посмотреть другие обращения.</p></div> : <CallJournal calls={data.calls} />}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-4 text-sm sm:px-6">
              <p className="text-zinc-500" aria-live="polite">{!journalReady ? "…" : data.pagination.total > 0 ? `${number((data.pagination.page - 1) * data.pagination.perPage + 1)}–${number(Math.min(data.pagination.page * data.pagination.perPage, data.pagination.total))} из ${number(data.pagination.total)}` : "0 звонков"}</p>
              <div className="flex items-center gap-2"><button type="button" className={buttonStyle} disabled={busy || !journalReady || data.pagination.page <= 1} onClick={() => { setLoading(true); setQuery((previous) => ({ ...previous, page: Math.max(1, previous.page - 1) })); }}>Назад</button><span className="px-1 text-xs text-zinc-500 tabular-nums">{query.page} / {Math.max(1, data.pagination.totalPages)}</span><button type="button" className={buttonStyle} disabled={busy || !journalReady || data.pagination.page >= data.pagination.totalPages} onClick={() => { setLoading(true); setQuery((previous) => ({ ...previous, page: previous.page + 1 })); }}>Далее</button></div>
            </div>
          </section>
          <SourceStatus source={data.source} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, detail, tone, onClick }: { label: string; value: number; detail: string; tone: "blue" | "green" | "red" | "neutral"; onClick: () => void }) {
  const styles = { blue: "bg-blue-50 text-blue-700", green: "bg-green-50 text-green-700", red: "bg-red-50 text-red-700", neutral: "bg-zinc-100 text-zinc-500" };
  return <button type="button" onClick={onClick} aria-label={`${label}: ${number(value)}. Показать в журнале`} className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md sm:p-5 ${tone === "red" ? "border-red-200" : "border-zinc-200"} ${focusRing}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-zinc-600">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles[tone]}`}><PhoneIcon className="h-4 w-4" /></span></div><p className={`mt-4 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${tone === "red" ? "text-red-600" : "text-zinc-900"}`}>{number(value)}</p><p className="mt-2 text-xs leading-relaxed text-zinc-500">{detail}</p></button>;
}

function CallChart({ data }: { data: TelephonyDashboard }) {
  const maximum = Math.max(1, ...data.daily.map((day) => day.total));
  const series = [{ key: "answered", label: "Принятые", color: "bg-green-500" }, { key: "missed", label: "Пропущенные", color: "bg-red-500" }, { key: "outbound", label: "Исходящие", color: "bg-blue-500" }, { key: "pending", label: "Уточняется", color: "bg-zinc-300" }] as const;
  return (
    <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" aria-labelledby="call-chart-title">
      <div className="flex items-center justify-between gap-2"><h3 id="call-chart-title" className="text-sm font-semibold text-zinc-900">Динамика звонков</h3><span className="text-xs text-zinc-500">По дням · МСК</span></div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-500">{series.map((item) => <span key={item.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${item.color}`} aria-hidden="true" />{item.label}</span>)}</div>
      <div className="relative mt-6" aria-hidden="true">
        <span className="absolute -top-2 left-0 text-[10px] text-zinc-500">{number(maximum)}</span>
        <div className="ml-7 flex h-40 items-end justify-around gap-1 border-b border-zinc-200 bg-zinc-50/50 px-1 pt-2 sm:gap-2">
          {data.daily.map((day) => <div key={day.date} className="flex h-full max-w-14 flex-1 flex-col justify-end" title={`${formatDate(day.date)}: всего ${day.total}, принятые ${day.answered}, пропущенные ${day.missed}, исходящие ${day.outbound}, уточняется ${day.pending}`}><div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${day.total / maximum * 100}%` }}>{series.map((item) => <div key={item.key} className={`w-full ${item.color}`} style={{ height: `${day.total ? day[item.key] / day.total * 100 : 0}%` }} />)}</div></div>)}
        </div>
        <div className="ml-7 mt-2 flex justify-around gap-1 text-center text-[10px] text-zinc-500 sm:gap-2">{data.daily.map((day, index) => <span key={day.date} className="min-w-0 max-w-14 flex-1">{data.daily.length <= 7 || index === 0 || index === data.daily.length - 1 || index % 7 === 0 ? formatDate(day.date).slice(0, 5) : ""}</span>)}</div>
      </div>
      <details className="mt-4 text-xs text-zinc-500"><summary className={`w-fit cursor-pointer rounded py-2 ${focusRing}`}>Показать данные по дням</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Динамика звонков по дням</caption><thead><tr><th className="py-2 pr-3 font-medium">Дата</th>{series.map((item) => <th key={item.key} className="px-2 py-2 text-right font-medium">{item.label}</th>)}</tr></thead><tbody>{data.daily.map((day) => <tr key={day.date} className="border-t border-zinc-100"><th scope="row" className="whitespace-nowrap py-2 pr-3 font-normal">{formatDate(day.date)}</th>{series.map((item) => <td key={item.key} className="px-2 py-2 text-right tabular-nums">{number(day[item.key])}</td>)}</tr>)}</tbody></table></div></details>
    </section>
  );
}

function CallStatus({ call }: { call: TelephonyJournalCall }) {
  const status = call.outcome === "missed" ? { label: "Пропущен", style: "bg-red-50 text-red-700" }
    : call.outcome === "answered" ? { label: "Принят", style: "bg-green-50 text-green-700" }
      : call.outcome === "pending" ? { label: "Уточняется", style: "bg-amber-50 text-amber-700" }
        : { label: call.isLost ? "Исходящий · без ответа" : "Исходящий", style: "bg-blue-50 text-blue-700" };
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${status.style}`}>{status.label}</span>;
}

function CallJournal({ calls }: { calls: TelephonyJournalCall[] }) {
  return <>
    <div className="hidden md:block"><table className="w-full text-left text-sm"><caption className="sr-only">Звонки за выбранный период, последние сначала</caption><thead className="border-y border-zinc-100 bg-zinc-50 text-xs text-zinc-500"><tr>{["Время, МСК", "Звонок", "Номер", "Сотрудник", "Разговор"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{calls.map((call) => <tr key={call.id} className="hover:bg-zinc-50"><td className="whitespace-nowrap px-5 py-4"><p className="font-medium text-zinc-900 tabular-nums">{formatTime(call.startedAt)}</p><p className="mt-1 text-xs text-zinc-500">{formatDate(call.startedAt)}</p></td><td className="px-5 py-4"><CallStatus call={call} /><p className="mt-1 text-xs text-zinc-500">{call.direction === "INBOUND" ? "Входящий" : "Исходящий"}</p></td><td className="whitespace-nowrap px-5 py-4 font-medium text-zinc-700 tabular-nums">{call.maskedPhone ?? "Номер не определён"}</td><td className="max-w-48 break-words px-5 py-4 text-zinc-600">{call.employeeName ?? "Не указан"}</td><td className="whitespace-nowrap px-5 py-4 text-zinc-700 tabular-nums">{duration(call.talkDuration)}</td></tr>)}</tbody></table></div>
    <ul className="divide-y divide-zinc-100 border-t border-zinc-100 md:hidden" aria-label="Список звонков">{calls.map((call) => <li key={call.id} className="space-y-3 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><CallStatus call={call} /><time dateTime={call.startedAt} className="text-xs text-zinc-500 tabular-nums">{formatDateTime(call.startedAt)}</time></div><p className="text-base font-medium text-zinc-900 tabular-nums">{call.maskedPhone ?? "Номер не определён"}</p><div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500"><span>{call.direction === "INBOUND" ? "Входящий" : "Исходящий"} · {call.employeeName ?? "Сотрудник не указан"}</span><span>Разговор: {duration(call.talkDuration)}</span></div></li>)}</ul>
  </>;
}

function SourceStatus({ source }: { source: TelephonyDashboard["source"] }) {
  return <section className="rounded-xl border border-zinc-200 px-5 py-4" aria-label="Источник данных"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xs font-semibold text-zinc-600">Данные Novofon</h3><p className="mt-1 text-xs text-zinc-500">Последнее изменение журнала: {source.lastJournalUpdate ? `${formatDateTime(source.lastJournalUpdate)} МСК` : "данных ещё нет"}</p></div><div className="flex flex-wrap gap-2 text-xs"><span className={`rounded-md px-2 py-1 ${source.dataApiConfigured ? "bg-zinc-100 text-zinc-600" : "bg-amber-50 text-amber-700"}`}>API: {source.dataApiConfigured ? "настроен" : "не настроен"}</span><span className={`rounded-md px-2 py-1 ${source.webhookConfigured ? "bg-zinc-100 text-zinc-600" : "bg-amber-50 text-amber-700"}`}>События: {source.webhookConfigured ? "настроены" : "не настроены"}</span></div></div><p className="mt-3 text-xs leading-relaxed text-zinc-500">Сводка по сохранённому журналу. Новые звонки могут появляться с задержкой. Наличие настроек не подтверждает доступность Novofon.</p>{!source.dataApiConfigured && !source.webhookConfigured && <p className="mt-2 text-sm text-amber-700">Подключение не настроено. Чтобы получать звонки, нужно настроить интеграцию Novofon.</p>}</section>;
}
