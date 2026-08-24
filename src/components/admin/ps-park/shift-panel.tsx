"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import type { DayReport, ShiftHandoverData } from "@/modules/ps-park/types";
import { formatTime as formatTimeUnified } from "@/lib/format";

type ShiftData = {
  shift: ShiftHandoverData | null;
  report: DayReport;
};

function formatTime(iso: string) {
  return formatTimeUnified(iso);
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
  const [showLogoutPrompt, setShowLogoutPrompt] = useState(false);
  const [notes, setNotes] = useState("");
  // Передача наличных в бухгалтерию: сумма предзаполняется расчётной, но
  // менеджер вводит фактически переданную — ради этой разницы всё и затеяно.
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAmount, setHandoverAmount] = useState("");
  const [handoverTo, setHandoverTo] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  /** true — исправляем уже записанную передачу, а не создаём первую. */
  const [handoverCorrection, setHandoverCorrection] = useState(false);

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
        setShowLogoutPrompt(true);
      } else {
        setError(json.error?.message ?? "Ошибка");
      }
    } catch {
      setError("Не удалось закрыть смену");
    } finally {
      setActing(false);
    }
  }

  function openHandover(cashTotal: number) {
    setError(null);
    setHandoverCorrection(false);
    setHandoverAmount(String(Math.round(cashTotal)));
    setHandoverTo("");
    setHandoverNote("");
    setHandoverOpen(true);
  }

  /** Исправление: поля предзаполняем тем, что уже записано. */
  function openCorrection(current: { amount: number; to: string; note: string | null }) {
    setError(null);
    setHandoverCorrection(true);
    setHandoverAmount(String(Math.round(current.amount)));
    setHandoverTo(current.to);
    setHandoverNote("");
    setHandoverOpen(true);
  }

  async function handleHandover() {
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/ps-park/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "handover",
          date,
          amount: parseFloat(handoverAmount) || 0,
          recipient: handoverTo,
          note: handoverNote.trim() || undefined,
          isCorrection: handoverCorrection,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setHandoverOpen(false);
        await load();
      } else {
        setError(json.error?.message ?? "Ошибка");
      }
    } catch {
      setError("Не удалось записать передачу");
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
  /** Разница «передано минус расчётное»: отрицательная — недостача. */
  const handoverDiff =
    Math.round(((parseFloat(handoverAmount) || 0) - (shift?.cashTotal ?? 0)) * 100) / 100;

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
                  </p>
                </div>
              </div>
            )}

            {isClosed && shift.notes && (
              <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-600">
                Примечание: {shift.notes}
              </div>
            )}

            {/* Передача наличных в бухгалтерию — только у закрытой смены:
                пока смена открыта, расчётная сумма ещё растёт. */}
            {isClosed && !shift.handover && (
              <button
                onClick={() => openHandover(shift.cashTotal)}
                disabled={acting}
                className="mt-3 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 sm:w-auto"
              >
                Передать в бухгалтерию · {formatMoney(shift.cashTotal)}
              </button>
            )}

            {isClosed && shift.handover && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                <div className="font-semibold">
                  Передано в бухгалтерию: {formatMoney(shift.handover.amount)}
                </div>
                <div className="mt-0.5 text-emerald-700">
                  {shift.handover.to} · {shift.handover.byName} ·{" "}
                  {formatTime(shift.handover.at)}
                </div>
                {shift.handover.discrepancy !== 0 && (
                  <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900">
                    Расхождение с расчётной суммой:{" "}
                    {shift.handover.discrepancy > 0 ? "+" : ""}
                    {formatMoney(shift.handover.discrepancy)}
                    {shift.handover.note ? ` — ${shift.handover.note}` : ""}
                  </div>
                )}
                {shift.handover.correctedAt && (
                  <div className="mt-1 text-emerald-700">
                    Запись исправлена {formatTime(shift.handover.correctedAt)} — прежние
                    значения сохранены в журнале
                  </div>
                )}
                <button
                  onClick={() =>
                    openCorrection({
                      amount: shift.handover!.amount,
                      to: shift.handover!.to,
                      note: shift.handover!.note,
                    })
                  }
                  disabled={acting}
                  className="mt-2 text-xs font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-900 disabled:opacity-50"
                >
                  Исправить запись
                </button>
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

      {/* Logout prompt after shift close */}
      {/* Передача наличных в бухгалтерию */}
      {handoverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setHandoverOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-zinc-900">
              {handoverCorrection ? "Исправить запись о передаче" : "Передать выручку в бухгалтерию"}
            </h2>
            <p className="mt-1.5 text-sm text-zinc-600">
              Расчётная сумма наличных за смену —{" "}
              <span className="font-semibold">{formatMoney(data?.shift?.cashTotal ?? 0)}</span>.
              {handoverCorrection
                ? " Прежние значения не пропадут — они останутся в журнале как отдельное событие."
                : " Впишите, сколько денег передали фактически."}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Карта и онлайн-оплата сюда не входят — эти деньги в кассу не попадают.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="handover-amount" className="block text-xs font-medium text-zinc-600">
                  Передано наличными <span className="text-red-500">*</span>
                </label>
                <input
                  id="handover-amount"
                  type="number"
                  min={0}
                  step={1}
                  autoFocus
                  value={handoverAmount}
                  onChange={(e) => setHandoverAmount(e.target.value)}
                  disabled={acting}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label htmlFor="handover-to" className="block text-xs font-medium text-zinc-600">
                  Кому передали <span className="text-red-500">*</span>
                </label>
                <input
                  id="handover-to"
                  type="text"
                  value={handoverTo}
                  onChange={(e) => setHandoverTo(e.target.value)}
                  disabled={acting}
                  placeholder="Фамилия и имя бухгалтера"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                />
              </div>

              {handoverDiff !== 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Сумма расходится с расчётной на{" "}
                  <span className="font-semibold tabular-nums">
                    {handoverDiff > 0 ? "+" : ""}
                    {formatMoney(handoverDiff)}
                  </span>
                  . Укажите причину — без неё передачу не записать.
                </div>
              )}

              <div>
                <label htmlFor="handover-note" className="block text-xs font-medium text-zinc-600">
                  {handoverCorrection ? "Что исправляете" : "Причина расхождения"}
                  {(handoverDiff !== 0 || handoverCorrection) && (
                    <span className="text-red-500"> *</span>
                  )}
                </label>
                <textarea
                  id="handover-note"
                  rows={2}
                  maxLength={500}
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                  disabled={acting}
                  placeholder="Разменяли, недостача, сдача с утра…"
                  className="mt-1 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setHandoverOpen(false)}
                disabled={acting}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Не сейчас
              </button>
              <button
                type="button"
                onClick={handleHandover}
                disabled={
                  acting ||
                  handoverTo.trim().length < 2 ||
                  (handoverCorrection && handoverNote.trim().length === 0)
                }
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {acting
                  ? "Записываем..."
                  : handoverCorrection
                    ? "Сохранить исправление"
                    : "Записать передачу"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogoutPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowLogoutPrompt(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">👋</span>
              <h2 className="text-base font-semibold text-zinc-900">Смена сдана</h2>
            </div>
            <p className="text-sm text-zinc-500 mb-5">
              Хотите выйти из аккаунта? Это защитит данные, если за терминалом будет другой сотрудник.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutPrompt(false)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Остаться
              </button>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors"
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

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
