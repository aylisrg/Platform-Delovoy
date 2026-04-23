"use client";

import { formatDate } from "@/lib/format";

type DateNavigatorProps = {
  currentDate: string; // "YYYY-MM-DD"
  onChange: (date: string) => void;
};

export function DateNavigator({ currentDate, onChange }: DateNavigatorProps) {
  const today = new Date().toISOString().split("T")[0];
  const isToday = currentDate === today;

  function shiftDate(days: number) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().split("T")[0]);
  }

  function formatDisplayDate(dateStr: string) {
    return formatDate(dateStr + "T00:00:00");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(today)}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isToday
            ? "bg-blue-600 text-white"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
        }`}
      >
        Сегодня
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={() => shiftDate(-1)}
          className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          &larr;
        </button>
        <span className="text-sm font-medium text-zinc-900 min-w-[160px] text-center">
          {formatDisplayDate(currentDate)}
        </span>
        <button
          onClick={() => shiftDate(1)}
          className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          &rarr;
        </button>
      </div>

      <input
        type="date"
        value={currentDate}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
