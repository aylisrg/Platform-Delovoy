type CallWidgetProps = {
  phone: string;
  displayPhone: string;
  variant?: "light" | "dark";
};

export function CallWidget({
  phone,
  displayPhone,
  variant = "light",
}: CallWidgetProps) {
  const isDark = variant === "dark";

  return (
    <div
      className={`w-full px-6 py-5 ${
        isDark
          ? "bg-zinc-900/60 border-y border-zinc-800"
          : "bg-[#f8faf8] border-y border-zinc-100"
      }`}
    >
      <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Left: icon + text */}
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              isDark ? "bg-violet-500/15" : "bg-zinc-200/80"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDark ? "#a78bfa" : "#525252"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
          <div>
            <p
              className={`text-sm font-medium font-[family-name:var(--font-manrope)] ${
                isDark ? "text-zinc-300" : "text-zinc-700"
              }`}
            >
              Не получается забронировать онлайн?
            </p>
            <p
              className={`text-xs mt-0.5 font-[family-name:var(--font-inter)] ${
                isDark ? "text-zinc-500" : "text-zinc-400"
              }`}
            >
              Позвоните — поможем выбрать время и оформим всё за вас
            </p>
          </div>
        </div>

        {/* Right: call button + number for manual dialing */}
        <div className="flex flex-col items-center sm:items-end gap-1.5 shrink-0">
          <a
            href={`tel:${phone}`}
            className={`inline-flex items-center gap-2 font-[family-name:var(--font-manrope)] font-semibold text-sm px-5 py-2.5 rounded-full transition-all ${
              isDark
                ? "bg-violet-600/20 text-violet-300 border border-violet-500/30 hover:bg-violet-600/35 hover:border-violet-500/50"
                : "bg-zinc-900 text-white hover:bg-zinc-700"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Позвонить: {displayPhone}
          </a>
          {/* Visible number for desktop — select and type manually */}
          <p
            className={`text-xs font-[family-name:var(--font-inter)] select-all cursor-text ${
              isDark ? "text-zinc-600" : "text-zinc-400"
            }`}
            title="Выделите и скопируйте номер"
          >
            {displayPhone}
          </p>
        </div>
      </div>
    </div>
  );
}
