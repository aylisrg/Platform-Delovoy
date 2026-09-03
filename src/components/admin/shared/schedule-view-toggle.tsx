"use client";

export type ScheduleView = "day" | "week";

/**
 * Переключатель «День / Неделя» (US-5 AC-1). Состояние — локальное у сетки,
 * без `?view=` в URL: deep-link `?date=&booking=` страницы не трогаем
 * (ADR 2026-08-23 §3).
 */
export function ScheduleViewToggle({
  view,
  onChange,
}: {
  view: ScheduleView;
  onChange: (view: ScheduleView) => void;
}) {
  const options: { value: ScheduleView; label: string }[] = [
    { value: "day", label: "День" },
    { value: "week", label: "Неделя" },
  ];
  return (
    <div role="group" aria-label="Вид расписания" className="inline-flex rounded-lg border border-zinc-200 p-0.5 bg-zinc-50">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={view === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            view === o.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
