"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";

type PrintScheduleRow = {
  bookingId: string;
  startTime: string;
  endTime: string;
  resourceName: string;
  clientName: string | null;
  clientPhone: string | null;
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED";
  guestCount: number | null;
  comment: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "На месте",
  CANCELLED: "Отменено",
};

export type PrintDaySheetProps = {
  moduleSlug: "gazebos" | "ps-park";
  title: string;
  resourceLabel: string;
  date: string; // YYYY-MM-DD
  onClose: () => void;
};

function formatHeadingDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const formatted = d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Печатный лист дня (#668) — общий для беседок и Плей Парка (AC-5): данные
 * приходят плоским списком из `getPrintableDaySchedule` (не из `getTimeline`,
 * который не умеет отдавать CANCELLED, — см. комментарий в service-файле).
 *
 * `id="print-day-sheet"` — якорь для `@media print` в globals.css, который
 * прячет весь остальной интерфейс страницы при печати. `print:hidden` на
 * интерактивных элементах (чекбокс, кнопки) — сам печатный лист не должен
 * нести кнопки/меню (AC-2).
 */
export function PrintDaySheet({ moduleSlug, title, resourceLabel, date, onClose }: PrintDaySheetProps) {
  const [rows, setRows] = useState<PrintScheduleRow[]>([]);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelledRequest = false;
    setLoading(true);
    setError(null);
    fetch(`/api/${moduleSlug}/print-schedule?date=${date}&includeCancelled=${includeCancelled}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelledRequest) return;
        if (data.success) {
          setRows(data.data);
        } else {
          setError(data.error?.message ?? "Не удалось загрузить расписание");
        }
      })
      .catch(() => {
        if (!cancelledRequest) setError("Не удалось загрузить расписание");
      })
      .finally(() => {
        if (!cancelledRequest) setLoading(false);
      });
    return () => {
      cancelledRequest = true;
    };
  }, [moduleSlug, date, includeCancelled]);

  return (
    <div
      id="print-day-sheet"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm print:static print:bg-white print:backdrop-blur-none print:block"
    >
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 mx-4 print:max-w-none print:max-h-none print:overflow-visible print:rounded-none print:shadow-none print:p-0 print:mx-0">
        <div className="print:hidden flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">Печать расписания</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="print:hidden flex items-center justify-between mb-4">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            Показывать отменённые
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || rows.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Печать
          </button>
        </div>

        <div>
          <h1 className="text-lg font-semibold text-zinc-900 mb-1">{formatHeadingDate(date)}</h1>
          <p className="text-sm text-zinc-500 mb-4">{title} — расписание на день</p>

          {error && (
            <p className="print:hidden text-sm text-red-600 mb-4">{error}</p>
          )}

          {loading ? (
            <p className="print:hidden text-sm text-zinc-400">Загрузка...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-zinc-400">На этот день броней нет.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-300 text-left">
                  <th className="py-2 pr-3 font-medium">Время</th>
                  <th className="py-2 pr-3 font-medium">{resourceLabel}</th>
                  <th className="py-2 pr-3 font-medium">Гость</th>
                  <th className="py-2 pr-3 font-medium">Телефон</th>
                  <th className="py-2 pr-3 font-medium">Статус</th>
                  <th className="py-2 pr-3 font-medium">Гостей</th>
                  <th className="py-2 font-medium">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.bookingId} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatTime(row.startTime)}–{formatTime(row.endTime)}
                    </td>
                    <td className="py-2 pr-3">{row.resourceName}</td>
                    <td className="py-2 pr-3">{row.clientName ?? "—"}</td>
                    <td className="py-2 pr-3">{row.clientPhone ?? "—"}</td>
                    <td className="py-2 pr-3">{STATUS_LABEL[row.status] ?? row.status}</td>
                    <td className="py-2 pr-3">{row.guestCount ?? "—"}</td>
                    <td className="py-2">{row.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
