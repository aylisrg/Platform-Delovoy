"use client";

import { formatDate, toISODate } from "@/lib/format";

type DateNavigatorProps = {
  currentDate: string; // "YYYY-MM-DD"
  onChange: (date: string) => void;
};

export function DateNavigator({ currentDate, onChange }: DateNavigatorProps) {
  // "Сегодня" по московскому календарю, а не по UTC — иначе ночью 00:00–03:00 МСК
  // кнопка считала бы текущим ещё вчерашний день.
  const today = toISODate(new Date());
  const isToday = currentDate === today;

  function shiftDate(days: number) {
    // `currentDate` = "YYYY-MM-DD" → new Date(...) даёт полуночь UTC. Сдвигаем
    // календарный день UTC-методами, чтобы результат не зависел от TZ браузера.
    const d = new Date(currentDate);
    d.setUTCDate(d.getUTCDate() + days);
    onChange(d.toISOString().split("T")[0]);
  }

  function formatDisplayDate(dateStr: string) {
    // Раньше здесь добавлялся "T00:00:00" — строка без смещения парсилась в TZ
    // браузера, и у админа в зоне впереди Москвы дата «уезжала» на день назад
    // (25-е показывалось как 24-е). `formatDate("YYYY-MM-DD")` трактует ввод как
    // полуночь UTC и рендерит в МСК — стабильно в любой TZ.
    return formatDate(dateStr);
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
