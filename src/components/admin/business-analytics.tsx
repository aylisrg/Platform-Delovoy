"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BusinessLine, BusinessMoney, BusinessPeriod, BusinessPreference, BusinessReport } from "@/modules/analytics/business-types";

type Fetcher = <T>(url: string, options?: RequestInit) => Promise<T>;
type Props = { apiFetch?: Fetcher; miniApp?: boolean };
type TestResult = { sent: boolean; status?: string; message?: string };

const money = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value);
const number = (value: number | null) => value === null ? "Нет данных" : value.toLocaleString("ru-RU");
const day = (value: string) => value.slice(8, 10) + "." + value.slice(5, 7);
const timestamp = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2";
const button = `rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-50 ${focus}`;

async function webFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const error = new Error(response.status === 401 || response.status === 403 ? "Нет доступа к бизнес-аналитике. Войдите под аккаунтом с разрешением на этот раздел." : body.error?.message || "Не удалось получить данные");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body.data as T;
}

function Icon({ name, className = "h-5 w-5" }: { name: "chart" | "arrow" | "shield" | "download" | "refresh" | "send" | "print"; className?: string }) {
  const paths = {
    chart: "M4 19V5m0 14h16M8 15l4-5 4 2 4-7",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4",
    refresh: "M20 7v5h-5M4 17v-5h5m-4-3a8 8 0 0 1 13-4l2 3M4 16l2 3a8 8 0 0 0 13-4",
    send: "m21 3-7 18-4-7-7-4L21 3Zm0 0L10 14",
    print: "M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7v-7Z",
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function BusinessAnalytics({ apiFetch = webFetch, miniApp = false }: Props) {
  const base = miniApp ? "/api/webapp/business-analytics" : "/api/analytics/business";
  const [period, setPeriod] = useState<BusinessPeriod>("7d");
  const [weekEnding, setWeekEnding] = useState<string | null>(null);
  const [anchorReady, setAnchorReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [preference, setPreference] = useState<BusinessPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [deliveryUnknown, setDeliveryUnknown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const testId = useRef<string | null>(null);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const initialPeriod = params.get("period");
    if (initialPeriod === "7d" || initialPeriod === "30d" || initialPeriod === "90d") setPeriod(initialPeriod);
    setWeekEnding(params.get("weekEnding"));
    setAnchorReady(true);
  }, []);

  useEffect(() => {
    if (!anchorReady) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setReport(null);
    apiFetch<BusinessReport>(`${base}?period=${period}${weekEnding ? `&weekEnding=${encodeURIComponent(weekEnding)}` : ""}`, { signal: controller.signal })
      .then(data => { if (active) setReport(data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить отчёт"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [apiFetch, base, period, revision, weekEnding, anchorReady]);

  const loadPreference = useCallback(async () => {
    try {
      const data = await apiFetch<BusinessPreference>(`${base}/subscription`);
      setPreference(data);
      setPreferenceError(null);
    } catch {
      setPreference(null);
      setPreferenceError("Настройки отчётов недоступны. Обновите страницу, чтобы повторить попытку.");
    }
  }, [apiFetch, base]);
  useEffect(() => { void loadPreference(); }, [loadPreference]);

  async function changePreference() {
    if (!preference || saving || sending) return;
    setSaving(true); setActionMessage(null); setPreferenceError(null);
    try {
      const data = await apiFetch<BusinessPreference>(`${base}/subscription`, { method: "PUT", body: JSON.stringify({ enabled: !preference.enabled }) });
      setPreference(data);
      setActionMessage(data.enabled ? "Недельные отчёты включены для вашего аккаунта." : "Недельные отчёты выключены.");
    } catch (cause) { setPreferenceError(cause instanceof Error ? cause.message : "Не удалось сохранить настройку"); }
    finally { setSaving(false); }
  }
  async function sendTest() {
    if (sending || sent || deliveryUnknown) return;
    setSending(true); setActionMessage(null); setPreferenceError(null);
    try {
      testId.current ??= crypto.randomUUID();
      const result = await apiFetch<TestResult>(`${base}/test`, { method: "POST", body: JSON.stringify({ requestId: testId.current }) });
      await loadPreference();
      if (result.sent) { setSent(true); setActionMessage("Тестовый отчёт доставлен в ваш личный Telegram."); }
      else {
        const unknown = result.status === "UNKNOWN" || result.status === "uncertain" || result.status === "PENDING";
        setDeliveryUnknown(unknown);
        setPreferenceError(result.message || (unknown ? "Исход доставки неизвестен. Проверьте личный Telegram; повторная отправка отключена, чтобы не создать дубль." : "Доставка не подтверждена. Проверьте статус ниже; повторный запрос не создаст второй отчёт."));
      }
    } catch (cause) { setPreferenceError(cause instanceof Error ? cause.message : "Доставка не подтверждена. Можно проверить повторно без создания дубля."); }
    finally { setSending(false); }
  }
  async function exportCsv() {
    setExporting(true); setActionMessage(null);
    try {
      const response = await fetch(`${base}/export?period=${period}${weekEnding ? `&weekEnding=${encodeURIComponent(weekEnding)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Экспорт недоступен. Проверьте доступ и повторите попытку.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `business-${report?.period.from}-${report?.period.to}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setActionMessage(cause instanceof Error ? cause.message : "Не удалось выгрузить отчёт"); }
    finally { setExporting(false); }
  }

  return <div className={`business-analytics mx-auto w-full min-w-0 max-w-[1480px] space-y-6 text-zinc-900 ${miniApp ? "bg-zinc-50 px-4 py-5 pb-24" : "p-4 sm:p-7 lg:p-9"}`}>
    <style>{`@media print { body { background: white !important; } aside, nav, header, .business-no-print { display: none !important; } body:has(.business-analytics) div:has(.business-analytics), main:has(.business-analytics) { display: block !important; overflow: visible !important; height: auto !important; max-height: none !important; } .business-analytics { max-width: none !important; padding: 0 !important; color: #18181b !important; } .business-analytics section, .business-analytics article { break-inside: avoid; } .business-analytics details::details-content { content-visibility: visible !important; display: block !important; } .business-analytics details > * { display: block !important; } .business-analytics svg { max-height: 240px; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Деловой · Управление бизнесом</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Бизнес-аналитика</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">Деньги, спрос и путь гостя — в одном отчёте.</p>
      </div>
      <a href={miniApp ? "/admin/analytics/business" : "/admin/analytics"} className={`business-no-print inline-flex items-center gap-2 rounded-lg py-2 text-sm font-medium text-zinc-600 hover:text-emerald-700 ${focus}`}>{miniApp ? "Открыть в админке" : "Рекламная аналитика"}<Icon name="arrow" className="h-4 w-4" /></a>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="business-no-print flex rounded-xl bg-zinc-100 p-1" role="group" aria-label="Период отчёта">
          {(["7d", "30d", "90d"] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setWeekEnding(null); setPeriod(value); }} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${focus} ${period === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}>{parseInt(value)} дней</button>)}
        </div>
        <div className="px-1 text-xs leading-5 text-zinc-500">{report && <span className="block font-medium text-zinc-800">{day(report.period.from)} — {day(report.period.to)}.{report.period.to.slice(0, 4)}</span>}Завершённые дни · МСК</div>
      </div>
      <div className="business-no-print flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => { setRevision(v => v + 1); void loadPreference(); }} disabled={loading} aria-label="Обновить отчёт"><Icon name="refresh" /></button>
        {!miniApp && <><button type="button" className={`${button} inline-flex items-center gap-2`} onClick={exportCsv} disabled={!report || loading || exporting}><Icon name="download" className="h-4 w-4" />CSV</button><button type="button" className={`${button} inline-flex items-center gap-2`} onClick={() => window.print()} disabled={!report || loading}><Icon name="print" className="h-4 w-4" />PDF / печать</button></>}
      </div>
    </div>

    {loading ? <div role="status" aria-label="Загрузка бизнес-аналитики" className="space-y-5"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />)}</div><div className="h-72 animate-pulse rounded-2xl bg-zinc-100" /><span className="sr-only">Загружаем отчёт</span></div> : error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><h2 className="font-semibold text-rose-900">Отчёт недоступен</h2><p className="mt-2 text-sm text-rose-800">{error}</p><p className="mt-2 text-xs text-rose-700">Цифры появятся после успешной загрузки данных.</p></div> : report ? <BusinessReportView report={report} /> : null}

    {!loading && report && <section className="business-no-print overflow-hidden rounded-2xl border border-zinc-200 bg-white" aria-labelledby="business-telegram-title">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Icon name="send" /></span><div><h2 id="business-telegram-title" className="text-base font-semibold">Бизнес-отчёт в Telegram</h2><p className="mt-1 text-sm text-zinc-500">Личная сводка раз в неделю. Цифры, изменения и ссылка на графики.</p></div></div>
        <button type="button" role="switch" aria-checked={preference?.enabled ?? false} aria-label="Недельный бизнес-отчёт" onClick={changePreference} disabled={!preference || saving || sending || (!preference.telegramReady && !preference.enabled)} className={`flex shrink-0 items-center gap-3 rounded-xl px-1 py-2 text-sm ${focus} disabled:opacity-50`}><span className="text-zinc-500">{saving ? "Сохраняем…" : preference?.enabled ? "Включён" : "Выключен"}</span><span className={`flex h-7 w-12 items-center rounded-full p-1 transition ${preference?.enabled ? "bg-emerald-600" : "bg-zinc-200"}`}><span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${preference?.enabled ? "translate-x-5" : "translate-x-0"}`} /></span></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 bg-zinc-50/70 px-5 py-4 sm:px-6"><div className="text-xs leading-5 text-zinc-500"><p className="font-medium text-zinc-700">{preference?.schedule || "Понедельник после 09:00 МСК · за предыдущую неделю"}</p><p>{preference?.telegramReady ? "Подтверждённый личный Telegram подключён" : "Для доставки привяжите Telegram к аккаунту и запустите бота"}</p><p>Тест — за последнюю завершённую неделю; подписка не изменится.</p>{preference?.lastDelivery && <p>Последняя отправка: {deliveryLabel(preference.lastDelivery.status)} · {timestamp(preference.lastDelivery.sentAt || preference.lastDelivery.createdAt)} МСК</p>}</div><button type="button" onClick={sendTest} disabled={!preference?.telegramReady || sending || saving || sent || deliveryUnknown} className={`${button} inline-flex items-center gap-2`}><Icon name="send" className="h-4 w-4" />{sending ? "Отправляем…" : sent ? "Тест доставлен" : deliveryUnknown ? "Исход неизвестен" : "Отправить мне тест"}</button></div>
      {preferenceError && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-800">{preferenceError}</p>}
    </section>}
    {actionMessage && <p role="status" className="business-no-print rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{actionMessage}</p>}
    <p className="flex items-center gap-2 text-xs text-zinc-400"><Icon name="shield" className="h-3.5 w-3.5" />Внутренний отчёт · доступ по роли и разрешению</p>
  </div>;
}

function deliveryLabel(status: string) { return ({ SENT: "доставлено", PENDING: "ожидает подтверждения", UNKNOWN: "исход доставки неизвестен", SENT_LOG_PENDING: "доставка подтверждена, журнал обновляется", FAILED: "не доставлено", SKIPPED: "пропущено" } as Record<string, string>)[status] || "статус уточняется"; }

export function BusinessReportView({ report }: { report: BusinessReport }) {
  const metrics: { key: keyof BusinessMoney; label: string; caption: string; primary?: boolean }[] = [
    { key: "receipts", label: "Учтённые поступления", caption: "Онлайн + наличные + терминал" },
    { key: "refunds", label: "Возвраты", caption: "По дате возврата денег" },
    { key: "adjustments", label: "Корректировки", caption: "В том числе доплаты за товары" },
    { key: "net", label: "Нетто движения денег", caption: "Поступления + корректировки − возвраты", primary: true },
  ];
  const empty = report.totals.receipts === 0 && report.totals.refunds === 0 && report.totals.adjustments === 0 && report.lines.every(line => line.bookings === 0 && line.orders === 0);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Частичное покрытие кассы</span><span>Обновлено {timestamp(report.generatedAt)} МСК</span></div>
    <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => {
      const delta = report.totals[metric.key] - report.previous[metric.key];
      return <article key={metric.key} className={`min-w-0 rounded-2xl border p-5 ${metric.primary ? "border-emerald-900 bg-emerald-950 text-white" : "border-zinc-200 bg-white"}`}><p className={`text-xs font-medium ${metric.primary ? "text-emerald-100" : "text-zinc-500"}`}>{metric.label}</p><p className="mt-4 break-words text-[28px] font-semibold leading-tight tracking-tight tabular-nums">{money(report.totals[metric.key])}</p><p className={`mt-3 text-xs tabular-nums ${metric.primary ? "text-emerald-200" : "text-zinc-600"}`}>{delta > 0 ? "+" : ""}{money(delta)} <span className={metric.primary ? "text-emerald-200/70" : "text-zinc-400"}>к предыдущим {report.period.days} дням</span></p><p className={`mt-4 border-t pt-3 text-[11px] leading-relaxed ${metric.primary ? "border-emerald-800 text-emerald-100/80" : "border-zinc-100 text-zinc-500"}`}>{metric.caption}</p></article>;
    })}</div>
    <p className="-mt-2 text-xs leading-relaxed text-zinc-500">Сводка зарегистрированных проводок. Полнота отличается по направлениям; выручка по начислению и прибыль здесь не рассчитываются.</p>
    {empty && <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">За этот период в подключённых источниках нет операций. Нулевые значения не подтверждают отсутствие продаж вне системы.</div>}
    <DailyChart rows={report.daily} />

    <section aria-labelledby="business-lines-title"><SectionTitle id="business-lines-title" eyebrow="03 направления" title="Что происходит в бизнесе" description="Деньги считаются один раз. Счёт сессии и связанный заказ кафе не складываются повторно." /><div className="mt-4 grid gap-4 xl:grid-cols-3">{report.lines.map((line, index) => <LineCard key={line.slug} line={line} index={index} />)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><Unavailable label="Офисы" description="Демонстрационные данные — исключены из всех бизнес-итогов и отчётов." /><Unavailable label="Парковка и сауна" description="Денежные источники пока не подключены. Показатели недоступны." /></div></section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" aria-labelledby="business-funnel-title"><SectionTitle id="business-funnel-title" eyebrow="Путь гостя" title="От интереса к оплате" description="Независимые шаги за выбранный период. Это не конверсия одной когорты." /><div className="mt-6 grid gap-6 lg:grid-cols-3">{report.funnel.map(funnel => {
      const steps = [{ label: "Просмотр", value: funnel.views, unit: "посетитель-день" }, { label: "Начало выбора", value: funnel.started, unit: "посетитель-день" }, { label: "Отправлено", value: funnel.submitted, unit: "брони / заказы" }, { label: "Событие онлайн-оплаты", value: funnel.paid, unit: "брони / заказы" }];
      const max = Math.max(...steps.map(step => step.value), 1);
      return <div key={funnel.slug}><h3 className="mb-4 text-sm font-semibold">{report.lines.find(line => line.slug === funnel.slug)?.label}</h3><ol className="space-y-3">{steps.map((step, index) => <li key={step.label}><div className="mb-1.5 flex items-center justify-between gap-2 text-xs"><span className="text-zinc-500">{String(index + 1).padStart(2, "0")} <span className="ml-1 text-zinc-700">{step.label}</span></span><span className="font-semibold tabular-nums">{number(step.value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true"><div className={`h-full rounded-full ${index === 3 ? "bg-emerald-600" : "bg-zinc-300"}`} style={{ width: `${step.value / max * 100}%` }} /></div><p className="mt-1 text-[10px] text-zinc-400">{step.unit}</p></li>)}</ol></div>;
    })}</div><p className="mt-5 border-t border-zinc-100 pt-4 text-xs leading-relaxed text-zinc-500">Источник: ProductEvent. Посетитель-день не равен уникальному человеку. События онлайн-оплаты покрывают только часть платежных сценариев; это не количество всех оплат. Сравнивайте шаги в пределах одного направления.</p></section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" aria-labelledby="business-marketing-title"><div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle id="business-marketing-title" eyebrow="Контекст привлечения" title="Сайт и реклама" /><a href="/admin/analytics" className={`business-no-print rounded text-xs font-medium text-emerald-700 ${focus}`}>Подробный отчёт →</a></div><p className="mt-3 text-xs leading-relaxed text-zinc-500">{report.marketing.scope}</p><div className="mt-5 grid gap-4 sm:grid-cols-3">{[{ label: "Визиты сайта", value: number(report.marketing.visits), source: "Яндекс.Метрика" }, { label: "Расход на рекламу", value: report.marketing.adSpend === null ? "Нет данных" : money(report.marketing.adSpend), source: "Яндекс.Директ" }, { label: "Клики по рекламе", value: number(report.marketing.clicks), source: "Яндекс.Директ" }].map(metric => <div key={metric.label} className="rounded-xl bg-zinc-50 p-4"><p className="text-xs text-zinc-500">{metric.label}</p><p className={`mt-2 break-words text-xl font-semibold tabular-nums ${metric.value === "Нет данных" ? "text-zinc-400" : "text-zinc-900"}`}>{metric.value}</p><p className="mt-2 text-[11px] text-zinc-400">{metric.source}</p></div>)}</div><p className="mt-4 text-xs leading-relaxed text-zinc-500">Проверка источников: {timestamp(report.marketing.fetchedAt)} МСК. «Нет данных» означает, что источник не подключён или не ответил. ROAS и стоимость покупателя недоступны без связи кампаний с платежами.</p></section>

    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 sm:p-6" aria-labelledby="business-quality-title"><SectionTitle id="business-quality-title" eyebrow="Доверие к цифрам" title="Источники и качество данных" /><dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">{[{ label: "Исключённые проводки", value: report.quality.excludedLedgerRows }, { label: "Повторные проводки", value: report.quality.duplicateLedgerRows }, { label: "Не найдена оплата", value: report.quality.unknownPaymentRows }].map(item => <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"><dt className="text-xs text-zinc-500">{item.label}</dt><dd className={`font-semibold tabular-nums ${item.value ? "text-amber-700" : "text-zinc-800"}`}>{number(item.value)}</dd></div>)}</dl><ul className="mt-4 space-y-2">{report.quality.warnings.map(warning => <li key={warning} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />{warning}</li>)}</ul><details className="mt-5 border-t border-zinc-200 pt-4"><summary className={`cursor-pointer rounded text-sm font-medium text-zinc-700 ${focus}`}>Как устроен отчёт</summary><div className="mt-3 grid gap-4 text-xs leading-relaxed text-zinc-500 sm:grid-cols-2"><p><strong className="font-medium text-zinc-700">Деньги.</strong> FinancialTransaction, сверка Payment и PaymentRefund. По дате проводки в МСК. Возвраты уменьшают текущий период, даже когда покупка произошла раньше. Удаление брони не удаляет финансовый факт.</p><p><strong className="font-medium text-zinc-700">Операции.</strong> Booking — дата начала обслуживания; Order — дата создания заказа. Отмена и неявка сами по себе не означают возврат денег.</p><p><strong className="font-medium text-zinc-700">Клиенты.</strong> Только связанные аккаунты с завершёнными операциями. Повтор — больше одной операции в периоде либо операция в предыдущем равном периоде; не полный пожизненный повтор. Гостевые операции показаны отдельно.</p><p><strong className="font-medium text-zinc-700">Сравнение.</strong> Предыдущие {report.period.days} завершённых дней, такая же длина окна. Сегодняшний неполный день исключён. Расчёты в рублях, часовой пояс Europe/Moscow.</p></div></details></section>
  </div>;
}

function SectionTitle({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description?: string }) { return <div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">{eyebrow}</p><h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>{description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">{description}</p>}</div>; }
function Unavailable({ label, description }: { label: string; description: string }) { return <div className="flex items-start gap-3 rounded-xl border border-dashed border-zinc-300 p-4"><span className="mt-0.5 text-lg text-zinc-300" aria-hidden="true">—</span><div><h3 className="text-xs font-semibold text-zinc-600">{label}</h3><p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p></div></div>; }
function DataRow({ label, children }: { label: string; children: ReactNode }) { return <div className="flex items-center justify-between gap-3 py-1.5 text-xs"><dt className="text-zinc-500">{label}</dt><dd className="font-medium tabular-nums text-zinc-800">{children}</dd></div>; }
function LineCard({ line, index }: { line: BusinessLine; index: number }) {
  const colors = ["bg-emerald-100 text-emerald-800", "bg-indigo-100 text-indigo-800", "bg-amber-100 text-amber-800"];
  const detailPath = line.slug === "cafe" ? "/admin/cafe" : `/admin/${line.slug}/analytics`;
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white"><div className="p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{line.label}</h3><span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${colors[index % colors.length]}`}>{String(index + 1).padStart(2, "0")}</span></div><p className="mt-5 text-[11px] text-zinc-400">Нетто по учтённым проводкам</p><p className="mt-1 break-words text-2xl font-semibold tracking-tight tabular-nums">{money(line.net)}</p><dl className="mt-4 border-t border-zinc-100 pt-3"><DataRow label="Поступления">{money(line.receipts)}</DataRow><DataRow label="Возвраты">{money(line.refunds)}</DataRow><DataRow label="Корректировки">{money(line.adjustments)}</DataRow></dl><p className="mt-4 text-[10px] leading-relaxed text-zinc-500">Поступления и корректировки до возвратов</p><div className="mb-4 mt-2 grid grid-cols-3 gap-1 rounded-xl bg-zinc-50 p-2 text-center">{[{ label: "Наличные", value: line.cash }, { label: "Терминал", value: line.card }, { label: "Онлайн", value: line.online }].map(item => <div key={item.label} className="min-w-0"><p className="text-[9px] text-zinc-400">{item.label}</p><p className="mt-1 break-words text-[11px] font-medium tabular-nums">{money(item.value)}</p></div>)}</div><dl className="border-t border-zinc-100 pt-3"><DataRow label={line.slug === "cafe" ? "Заказы" : "Бронирования"}>{number(line.slug === "cafe" ? line.orders : line.bookings)}</DataRow><DataRow label={line.slug === "cafe" ? "Выдано" : "Завершено"}>{number(line.completed)}</DataRow><DataRow label="Отменено">{number(line.cancelled)}</DataRow>{line.slug !== "cafe" && <DataRow label="Неявки">{number(line.noShows)}</DataRow>}{line.slug === "cafe" && <DataRow label="Связаны с бронью">{number(line.linkedOrders)}</DataRow>}<DataRow label="Известные клиенты">{number(line.knownCustomers)}</DataRow><DataRow label="Из них повторные в двух периодах">{number(line.repeatCustomers)}</DataRow><DataRow label="Завершённые операции без аккаунта">{number(line.unidentifiedOperations)}</DataRow></dl></div><div className="mt-auto border-t border-amber-100 bg-amber-50/60 p-4"><p className="text-[11px] leading-relaxed text-amber-900"><strong className="font-medium">Ограничение учёта. </strong>{line.coverage}</p></div><a href={detailPath} className={`business-no-print flex items-center justify-between border-t border-zinc-100 px-5 py-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 ${focus}`}>Открыть направление<Icon name="arrow" className="h-3.5 w-3.5" /></a></article>;
}

function DailyChart({ rows }: { rows: BusinessReport["daily"] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(900);
  const chartContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chartContainer.current;
    if (!element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setChartWidth(Math.max(280, Math.round(measured)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = chartWidth, height = 240, left = 60, right = 15, top = 15, bottom = 30;
  const min = Math.min(0, ...rows.map(row => row.net));
  const max = Math.max(1, ...rows.map(row => Math.max(row.receipts + row.adjustments, row.net, row.refunds)));
  const span = max - min;
  const y = (value: number) => top + (max - value) / span * (height - top - bottom);
  const step = (width - left - right) / Math.max(rows.length, 1);
  const x = (index: number) => left + step * (index + 0.5);
  const active = selected !== null ? rows[selected] : null;
  return <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" aria-labelledby="business-daily-title"><div className="flex flex-wrap items-start justify-between gap-4"><SectionTitle id="business-daily-title" eyebrow="Динамика" title="Движение денег по дням" /><div className="flex flex-wrap gap-3 text-[10px] text-zinc-500"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-400" />Поступления + корректировки</span><span className="flex items-center gap-1.5"><i className="h-0.5 w-3 bg-zinc-700" />Нетто</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-rose-300" />Возвраты</span></div></div>
    <div ref={chartContainer} className="mt-5 min-w-0"><svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full overflow-visible" role="img" aria-label="Поступления, возвраты и нетто по дням. Точные значения доступны в таблице ниже.">
      {[0, 1, 2, 3].map(i => { const value = max - span * i / 3; return <g key={i}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#f0f0f2" /><text x={left - 10} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#71717a">{new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value)} ₽</text></g>; })}
      <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="#d4d4d8" />
      {rows.map((row, index) => <g key={row.date}><rect x={x(index) - step * 0.25} y={y(row.receipts + row.adjustments)} width={Math.max(step * 0.45, 1)} height={Math.max(y(0) - y(row.receipts + row.adjustments), 0)} rx="2" fill={selected === index ? "#059669" : "#6ee7b7"} />{row.refunds > 0 && <rect x={x(index) + step * 0.23} y={y(Math.min(row.refunds, max))} width={Math.max(step * 0.14, 1)} height={y(0) - y(Math.min(row.refunds, max))} rx="1" fill="#fda4af" />}{(index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 6)) === 0) && <text x={x(index)} y={height - 6} textAnchor="middle" fontSize="11" fill="#71717a">{day(row.date)}</text>}</g>)}
      <polyline points={rows.map((row, index) => `${x(index)},${y(row.net)}`).join(" ")} fill="none" stroke="#3f3f46" strokeWidth="2" strokeLinejoin="round" />
      {rows.map((row, index) => <rect key={`hit-${row.date}`} x={left + step * index} y={top} width={step} height={height - bottom - top} fill="transparent" tabIndex={0} role="button" aria-label={`${day(row.date)}: поступления ${money(row.receipts)}, корректировки ${money(row.adjustments)}, возвраты ${money(row.refunds)}, нетто ${money(row.net)}`} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onMouseLeave={() => setSelected(null)} onBlur={() => setSelected(null)} onClick={() => setSelected(index)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(index); } }} className="focus:outline-emerald-600" />)}
    </svg></div>
    <div className="mt-3 min-h-8 text-xs leading-relaxed text-zinc-500" aria-live="polite">{active ? <span><strong className="font-medium text-zinc-700">{day(active.date)}</strong> · Поступления {money(active.receipts)} · Корректировки {money(active.adjustments)} · Возвраты {money(active.refunds)} · Нетто {money(active.net)}</span> : "Наведите на день или выберите его с клавиатуры. Возвраты показаны отдельно; линия нетто может уходить ниже нуля."}</div>
    <details className="mt-2 border-t border-zinc-100 pt-3"><summary className={`cursor-pointer rounded text-xs font-medium text-zinc-600 ${focus}`}>Точные значения по дням</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-right text-xs tabular-nums"><caption className="sr-only">Движение денег по дням, рубли</caption><thead><tr className="border-b border-zinc-200 text-zinc-500"><th scope="col" className="py-2 text-left font-medium">Дата</th>{["Поступления", "Корректировки", "Возвраты", "Нетто"].map(label => <th key={label} scope="col" className="px-2 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date} className="border-b border-zinc-100"><th scope="row" className="whitespace-nowrap py-2 text-left font-normal text-zinc-500">{day(row.date)}</th>{[row.receipts, row.adjustments, row.refunds, row.net].map((value, i) => <td key={i} className="whitespace-nowrap px-2 py-2">{money(value)}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
