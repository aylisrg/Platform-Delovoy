"use client";

import { useState, useEffect, useCallback } from "react";
import type { DayReport, ShiftHandoverData } from "@/modules/ps-park/types";

type ShiftData = {
  shift: ShiftHandoverData | null;
  report: DayReport;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(amount: number) {
  return amount.toLocaleString("ru-RU") + " ₽";
}

export function ShiftPanel({ date }: { date: string }) {
  const [data, setData] = useState<ShiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ps-park/shift?date=${date}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOpen() {
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/ps-park/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", date }),
      });
      const json = await res.json();
      if (json.success) {
        await load();
      } else {
        setError(json.error?.message ?? "Ошибка");
      }
    } catch {
      setError("Не удалось открыть смену");
    } finally {
      setActing(false);
    }
  }

  async function handleClose() {
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/ps-park/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", date, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setShowCloseConfirm(false);
        setNotes("");
        await load();
      } else {
        setError(json.error?.message ?? "Ошибка");
      }
    } catch {
      setError("Не удалось закрыть смену");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 mb-6 animate-pulse h-32" />
    );
  }

  const shift = data?.shift ?? null;
  const report = data?.report;
  const isOpen = shift?.status === "OPEN";
  const isClosed = shift?.status === "CLOSED";
  const noShift = !shift;

  return (
    <>
      <div className="rounded-2xl border border-zinc-200 bg-white mb-6 overflow-hidden">
        {/* Shift status bar */}
        <div
          className={`flex items-center justify-between px-5 py-3 ${
            isOpen
              ? "bg-emerald-50 border-b border-emerald-100"
              : isClosed
              ? "bg-zinc-50 border-b border-zinc-100"
              : "bg-amber-50 border-b border-amber-100"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isOpen ? "bg-emerald-500 animate-pulse" : isClosed ? "bg-zinc-400" : "bg-amber-400"
              }`}
            />
            <span className="text-sm font-semibold text-zinc-800">
              {isOpen
                ? `Смена открыта · ${formatTime(shift.openedAt)} · ${shift.openedByName}`
                : isClosed
                ? `Смена закрыта · сдал ${shift.closedByName} в ${formatTime(shift.closedAt!)}`
                : "Смена не открыта"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {noShift && (
              <button
                onClick={handleOpen}
                disabled={acting}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {acting ? "..." : "Принять смену"}
              </button>
            )}
            {isOpen && (
              <button
                onClick={() => setShowCloseConfirm(true)}
                disabled={acting}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                Сдать смену
              </button>
            )}
          </div>
        </div>

        {/* Day report */}
        {report && (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-700">
                Итоги дня
              </h3>
              <span className="text-xs text-zinc-400">{date}</span>
            </div>

            {report.totalSessions === 0 ? (
              <p className="text-sm text-zinc-400">Завершённых сессий пока нет</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {/* Cash */}
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">💵</span>
                    <span className="text-xs font-medium text-emerald-700">Наличные</span>
                  </div>
                  <p className="text-lg font-bold text-emerald-800 tabular-nums">
                    {formatMoney(report.cashTotal)}
                  </p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {report.cashCount} {pluralChek(report.cashCount)}
                  </p>
                </div>

                {/* Card */}
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">💳</span>
                    <span className="text-xs font-medium text-blue-700">Безналичные</span>
                  </div>
                  <p className="text-lg font-bold text-blue-800 tabular-nums">
                    {formatMoney(report.cardTotal)}
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">
                    {report.cardCount} {pluralChek(report.cardCount)}
                  </p>
                </div>

                {/* Total */}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">🧾</span>
                    <span className="text-xs font-medium text-zinc-600">Итого</span>
                  </div>
                  <p className="text-lg font-bold text-zinc-900 tabular-nums">
                    {formatMoney(report.totalRevenue)}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {report.totalSessions} {pluralChek(report.totalSessions)}
                    {report.unknownCount > 0 && ` · ${report.unknownCount} без метода`}
                  </p>
                </div>
              </div>
            )}

            {isClosed && shift.notes && (
              <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-600">
                Примечание: {shift.notes}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mx-5 mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}
      </div>

      {/* Close shift confirm modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowCloseConfirm(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl mx-4 p-6">
            <h2 className="text-base font-semibold text-zinc-900 mb-1">Сдать смену</h2>
            <p className="text-sm text-zinc-500 mb-4">
              Итого за смену:{" "}
              <span className="font-bold text-zinc-800">
                {formatMoney(report?.totalRevenue ?? 0)}
              </span>
              {" "}({report?.totalSessions ?? 0} {pluralChek(report?.totalSessions ?? 0)})
            </p>

            {report && report.totalSessions > 0 && (
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 mb-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Наличные</span>
                  <span className="font-medium tabular-nums">{formatMoney(report.cashTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Безналичные</span>
                  <span className="font-medium tabular-nums">{formatMoney(report.cardTotal)}</span>
                </div>
                {report.unknownTotal > 0 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Без метода оплаты</span>
                    <span className="font-medium tabular-nums">{formatMoney(report.unknownTotal)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-600 mb-1">
                Примечание (необязательно)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Замечания по смене..."
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={acting}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                {acting ? "Сохранение..." : "Сдать смену"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function pluralChek(n: number) {
  if (n % 100 >= 11 && n % 100 <= 19) return "чеков";
  const r = n % 10;
  if (r === 1) return "чек";
  if (r >= 2 && r <= 4) return "чека";
  return "чеков";
}
