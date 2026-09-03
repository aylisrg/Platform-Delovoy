"use client";

import { useEffect, useMemo, useState } from "react";
import { PaymentDot } from "@/components/admin/shared/payment-badge";
import {
  formatDayHeader,
  formatWeekLabel,
  normalizeWeekStart,
  shiftDateKey,
} from "@/modules/booking/week-dates";
import type {
  WeekTimelineBooking,
  WeekTimelineData,
  WeekTimelineResource,
} from "@/modules/booking/week-timeline";
import { formatTime, toISODate } from "@/lib/format";

/**
 * Недельная матрица «ресурс × день» (US-5, эпик #442; ADR 2026-08-23 §3–§4).
 * Общая для беседок и Плей Парка: модуль-специфика — только подписи и
 * ключ счётчика гостей в metadata; карточку брони и путь создания рендерит
 * модуль-обёртка (`timeline-grid.tsx`) через колбэки. Данные грузит клиент
 * одним запросом `GET /api/{module}/week-timeline?weekStart=` — server-компонент
 * страницы и её deep-link `?date=&booking=` не трогаются.
 */
export type WeekScheduleGridProps = {
  moduleSlug: "gazebos" | "ps-park";
  /** «Беседка» / «Стол» — заголовок первой колонки. */
  resourceLabel: string;
  /** «чел.» / «игр.» — единица счётчика в чипе. */
  unitLabel: string;
  /** Ключ счётчика в `booking.metadata`: guestCount / playerCount. */
  countMetaKey: string;
  /** Любая дата недели, с которой стартуем (сервер нормализует к понедельнику). */
  initialDate: string;
  /** Бронь, выделенная в карточке (подсветка чипа). */
  selectedBookingId?: string | null;
  /** Смена значения заставляет перезагрузить неделю (после правки брони в карточке). */
  refreshKey?: number;
  onBookingClick: (booking: WeekTimelineBooking, resource: WeekTimelineResource) => void;
  /** Клик по свободному месту ячейки — переход в дневной вид (AC-6). */
  onEmptyCellClick: (date: string, resourceId: string) => void;
};

function bookingHours(b: WeekTimelineBooking): number {
  return Math.max(0, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 3_600_000);
}

function chipClass(booking: WeekTimelineBooking, selected: boolean): string {
  if (selected) return "bg-blue-100 border-blue-500 ring-1 ring-blue-300/60";
  if (booking.status === "CHECKED_IN") return "bg-emerald-100 border-emerald-400";
  if (booking.status === "PENDING") return "bg-amber-50 border-dashed border-amber-300 hover:bg-amber-100/70";
  return "bg-emerald-50 border-emerald-200 hover:bg-emerald-100/70";
}

export function WeekScheduleGrid({
  moduleSlug,
  resourceLabel,
  unitLabel,
  countMetaKey,
  initialDate,
  selectedBookingId,
  refreshKey = 0,
  onBookingClick,
  onEmptyCellClick,
}: WeekScheduleGridProps) {
  const [weekStart, setWeekStart] = useState(() => normalizeWeekStart(initialDate));
  const [data, setData] = useState<WeekTimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Состояние пишется только из колбэков запроса (не синхронно в эффекте);
  // «загрузка» выводится из рассинхрона запрошенной и полученной недели.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/${moduleSlug}/week-timeline?weekStart=${weekStart}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setData(json.data);
          setError(null);
        } else {
          setError(json.error?.message ?? "Не удалось загрузить неделю");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить неделю");
      });
    return () => {
      cancelled = true;
    };
  }, [moduleSlug, weekStart, refreshKey, retryKey]);

  const loading = !error && (data === null || data.weekStart !== weekStart);

  const today = toISODate(new Date());
  const thisWeekStart = normalizeWeekStart(today);

  // Группировка один раз: ключ `${resourceId}|${date}` → чипы по возрастанию времени.
  const cells = useMemo(() => {
    const map = new Map<string, WeekTimelineBooking[]>();
    for (const b of data?.bookings ?? []) {
      const key = `${b.resourceId}|${b.date}`;
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [data]);

  // «Итого/день»: занятые часы / (ресурсы × длина рабочего дня) — из уже
  // полученных данных, отдельного API нет (ADR §3).
  const totals = useMemo(() => {
    if (!data) return new Map<string, { busy: number; capacity: number }>();
    const dayLength = data.hours.length;
    const capacity = data.resources.length * dayLength;
    const known = new Set(data.resources.map((r) => r.id));
    const out = new Map<string, { busy: number; capacity: number }>();
    for (const day of data.days) out.set(day, { busy: 0, capacity });
    for (const b of data.bookings) {
      if (!known.has(b.resourceId)) continue; // ресурс деактивирован в середине недели (ADR §9 п.4)
      const t = out.get(b.date);
      if (t) t.busy += bookingHours(b);
    }
    return out;
  }, [data]);

  const days = data?.days ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setWeekStart(thisWeekStart)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              weekStart === thisWeekStart
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            Эта неделя
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Предыдущая неделя"
              onClick={() => setWeekStart(shiftDateKey(weekStart, -7))}
              className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              &larr;
            </button>
            <span className="text-sm font-medium text-zinc-900 min-w-[170px] text-center">
              {formatWeekLabel(weekStart)}
            </span>
            <button
              type="button"
              aria-label="Следующая неделя"
              onClick={() => setWeekStart(shiftDateKey(weekStart, 7))}
              className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              &rarr;
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <span className="text-xs text-zinc-400 animate-pulse">Загрузка...</span>
          )}
          {error && (
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="text-xs text-red-600 hover:text-red-700 font-medium"
            >
              {error} — повторить
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="w-36 min-w-[144px] px-3 py-2 text-left font-medium text-zinc-500 border-r border-zinc-200">
                {resourceLabel}
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  className={`px-2 py-2 text-center font-medium border-r border-zinc-100 last:border-r-0 ${
                    day === today ? "text-blue-700 bg-blue-50/60" : "text-zinc-500"
                  }`}
                >
                  {formatDayHeader(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.resources.map((resource) => (
              <tr key={resource.id} className="border-b border-zinc-100 last:border-b-0 align-top">
                <td className="px-3 py-2 border-r border-zinc-200 bg-white">
                  <div className="text-sm font-medium text-zinc-900 leading-tight">{resource.name}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {resource.capacity && `${resource.capacity} ${unitLabel}`}
                    {resource.capacity && resource.pricePerHour && " · "}
                    {resource.pricePerHour && `${resource.pricePerHour} ₽/ч`}
                  </div>
                </td>
                {days.map((day) => {
                  const list = cells.get(`${resource.id}|${day}`) ?? [];
                  return (
                    <td
                      key={day}
                      data-testid={`cell-${resource.id}-${day}`}
                      onClick={() => onEmptyCellClick(day, resource.id)}
                      className={`px-1.5 py-1.5 border-r border-zinc-100 last:border-r-0 cursor-pointer group hover:bg-emerald-50/40 ${
                        day === today ? "bg-blue-50/30" : ""
                      }`}
                      title="Открыть день"
                    >
                      <div className="flex flex-col gap-1 min-h-[2.25rem]">
                        {list.map((booking) => {
                          const meta = booking.metadata as Record<string, unknown> | null;
                          const count = meta?.[countMetaKey];
                          return (
                            <button
                              type="button"
                              key={booking.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onBookingClick(booking, resource);
                              }}
                              className={`w-full text-left rounded-md border px-1.5 py-1 leading-tight transition-colors ${chipClass(
                                booking,
                                booking.id === selectedBookingId
                              )}`}
                              title={`${booking.clientName ?? "—"} · Нажмите для подробностей`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="tabular-nums text-zinc-600 shrink-0">
                                  {formatTime(booking.startTime)}–{formatTime(booking.endTime)}
                                </span>
                                <span className="font-medium text-zinc-900 truncate">
                                  {booking.clientName ?? "—"}
                                </span>
                                <PaymentDot booking={booking} />
                              </div>
                              {typeof count === "number" && (
                                <span className="text-zinc-500">
                                  {count} {unitLabel}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {list.length === 0 && (
                          <span className="text-zinc-300 group-hover:text-emerald-500 text-center leading-8 select-none">
                            —
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {data && data.resources.length > 0 && (
              <tr className="bg-zinc-50 border-t border-zinc-200">
                <td className="px-3 py-2 text-xs font-medium text-zinc-500 border-r border-zinc-200">
                  Итого/день
                </td>
                {days.map((day) => {
                  const t = totals.get(day);
                  return (
                    <td
                      key={day}
                      data-testid={`total-${day}`}
                      className="px-2 py-2 text-center text-xs text-zinc-600 border-r border-zinc-100 last:border-r-0 tabular-nums"
                    >
                      {t ? `${Math.round(t.busy)} из ${t.capacity} ч` : "—"}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>

        {data && data.resources.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">Нет активных ресурсов</div>
        )}
        {!data && loading && (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">Загрузка недели…</div>
        )}
      </div>
    </div>
  );
}
