"use client";

import { useState, useEffect } from "react";
import type { ActiveSession } from "@/modules/ps-park/types";
import { AddItemsButton } from "./add-items-button";
import { ExtendSessionButton } from "./extend-session-button";
import { CompleteSessionButton } from "./complete-session-button";

type ActiveSessionCardProps = {
  session: ActiveSession;
  onUpdate: () => void;
};

export function ActiveSessionCard({ session, onUpdate }: ActiveSessionCardProps) {
  const [remainingMinutes, setRemainingMinutes] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    function updateProgress() {
      const now = Date.now();
      const start = new Date(session.startTime).getTime();
      const end = new Date(session.endTime).getTime();
      const total = (end - start) / 1000 / 60;
      const elapsed = (now - start) / 1000 / 60;
      const remaining = Math.max(0, total - elapsed);
      setRemainingMinutes(Math.round(remaining));
      setProgressPercent(Math.min(100, (elapsed / total) * 100));
    }

    updateProgress();
    const interval = setInterval(updateProgress, 30_000);
    return () => clearInterval(interval);
  }, [session.startTime, session.endTime]);

  const isEnding = remainingMinutes <= 10;

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div
      className={`rounded-xl border-2 p-4 min-w-[280px] max-w-[320px] shrink-0 transition-colors ${
        isEnding
          ? "border-amber-400 bg-amber-50/50"
          : "border-emerald-300 bg-emerald-50/30"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-semibold text-zinc-900">
            {session.resourceName}
          </span>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isEnding
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {remainingMinutes > 0 ? `${remainingMinutes} мин` : "Время вышло"}
        </span>
      </div>

      {/* Client info */}
      <div className="mb-2">
        <p className="text-sm font-medium text-zinc-800">{session.clientName}</p>
        {session.clientPhone && (
          <p className="text-xs text-zinc-500">{session.clientPhone}</p>
        )}
      </div>

      {/* Time */}
      <div className="text-xs text-zinc-500 mb-2">
        {formatTime(session.startTime)} – {formatTime(session.endTime)} ({session.hoursBooked} ч.)
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isEnding ? "bg-amber-400" : "bg-emerald-400"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Bill summary */}
      <div className="text-xs space-y-1 mb-3 bg-white/60 rounded-lg p-2.5">
        <div className="flex justify-between text-zinc-600">
          <span>Аренда</span>
          <span className="tabular-nums">{session.hoursCost} ₽</span>
        </div>
        <div className="text-[10px] text-zinc-400 -mt-0.5 mb-0.5">
          {session.hoursBooked} ч. x {session.pricePerHour} ₽/ч
        </div>
        {session.items.length > 0 && (
          <>
            {session.items.map((item, idx) => (
              <div key={item.skuId + idx} className="flex justify-between text-zinc-600">
                <span className="truncate mr-2">{item.skuName} x{item.quantity}</span>
                <span className="tabular-nums shrink-0">{item.subtotal} ₽</span>
              </div>
            ))}
          </>
        )}
        <div className="flex justify-between font-semibold text-zinc-900 pt-1 border-t border-zinc-200">
          <span>Итого</span>
          <span className="tabular-nums">{session.totalBill} ₽</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <AddItemsButton bookingId={session.bookingId} />
        <ExtendSessionButton bookingId={session.bookingId} onExtended={onUpdate} />
        <CompleteSessionButton bookingId={session.bookingId} onCompleted={onUpdate} />
      </div>
    </div>
  );
}
