"use client";

type Props = {
  currentDate: string;
  onChange: (date: string) => void;
};

export function DarkDateNavigator({ currentDate, onChange }: Props) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const isToday = currentDate === today;

  function shiftDate(days: number) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().split("T")[0]);
  }

  function formatDisplayDate(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(today)}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isToday
            ? "bg-violet-600 text-white"
            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        }`}
      >
        Сегодня
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={() => shiftDate(-1)}
          className="rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          &larr;
        </button>
        <span className="text-sm font-medium text-zinc-200 min-w-[160px] text-center">
          {formatDisplayDate(currentDate)}
        </span>
        <button
          onClick={() => shiftDate(1)}
          className="rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          &rarr;
        </button>
      </div>

      <input
        type="date"
        value={currentDate}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 px-2 py-1 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      />
    </div>
  );
}
