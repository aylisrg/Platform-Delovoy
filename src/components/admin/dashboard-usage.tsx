"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, toISODate } from "@/lib/format";

const labels: Record<string, string> = {
  dashboard_view: "Открытия обзора",
  dashboard_section_view: "Переходы в разделы",
  booking_details_open: "Просмотры деталей брони",
  booking_action_started: "Начатые действия с бронью",
  booking_action_succeeded: "Выполненные запросы действий",
  booking_action_failed: "Ошибки действий с бронью",
  contact_link_started: "Начало добавления контакта",
  contact_link_succeeded: "Добавленные контакты",
  contact_link_failed: "Ошибки добавления контакта",
  notification_settings_save_succeeded: "Сохранения уведомлений",
  notification_settings_save_failed: "Ошибки сохранения уведомлений",
  feedback_open: "Открытия обращений",
  feedback_reply_succeeded: "Отправленные ответы",
};
type Report = {
  dateFrom: string;
  dateTo: string;
  rows: { event: string; events: number; accounts: number }[];
};
export function DashboardUsage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    const today = toISODate(new Date());
    const from = toISODate(
      new Date(new Date(`${today}T00:00:00+03:00`).getTime() - 6 * 86400000),
    );
    return fetch(`/api/analytics/dashboard?dateFrom=${from}&dateTo=${today}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error("Не удалось загрузить события кабинета");
        return result.data as Report;
      })
      .then((data) => setReport(data))
      .catch(() => setError("Не удалось загрузить события кабинета"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Как пользуются личным кабинетом</h2>
      <p className="mt-2 text-sm text-zinc-600">
        Последние 7 дней, включая сегодняшний неполный день. События собираются
        после выпуска обновления; история посещений до него здесь не
        восстановлена.
      </p>
      {loading ? (
        <p role="status" className="mt-4 text-sm">
          Загружаем события…
        </p>
      ) : error ? (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              setError("");
              void load();
            }}
            className="mt-2 min-h-11 text-sm text-blue-700"
          >
            Повторить запрос
          </button>
        </div>
      ) : (
        report && (
          <>
            <p className="mt-3 text-xs text-zinc-600">
              {formatDate(report.dateFrom)}–{formatDate(report.dateTo)} · МСК
            </p>
            {report.rows.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="py-3 pr-4 font-medium">Действие</th>
                      <th className="px-3 py-3 font-medium">События</th>
                      <th className="py-3 pl-3 font-medium">Аккаунты</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.event} className="border-b border-zinc-100">
                        <td className="py-3 pr-4">
                          {labels[row.event] ?? "Другое событие кабинета"}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{row.events}</td>
                        <td className="py-3 pl-3 tabular-nums">
                          {row.accounts}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-600">
                За выбранный период записанных событий пока нет. После первых
                действий в кабинете здесь появятся данные.
              </p>
            )}
            <p className="mt-4 text-xs leading-relaxed text-zinc-600">
              Аккаунты считаются отдельно для каждого события. Это независимые
              счётчики, а не конверсия одной когорты. Успех оплаты здесь
              означает получение ссылки; факт оплаты проверяется в платёжных
              отчётах. Успехи сохраняются сервером, открытия и начало действий
              зависят от работы браузера. Контактные операции учитываются и при
              выполнении через другие интерфейсы профиля. При смене секрета
              авторизации меняются обезличенные ключи аккаунтов.
            </p>
          </>
        )
      )}
    </section>
  );
}
