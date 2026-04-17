/**
 * CallWidget — inline "call us to book" block for gazebos and ps-park pages.
 * Displayed between the hero and the main content sections.
 */

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
      className={`w-full px-6 py-4 ${
        isDark
          ? "bg-zinc-900 border-y border-zinc-800"
          : "bg-[#f0fdf4] border-y border-green-100"
      }`}
    >
      <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Left: icon + text */}
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              isDark ? "bg-violet-500/15" : "bg-green-500/15"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDark ? "#a78bfa" : "#16A34A"}
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
                isDark ? "text-white" : "text-[#1d1d1f]"
              }`}
            >
              Хотите забронировать по телефону?
            </p>
            <p
              className={`text-xs mt-0.5 font-[family-name:var(--font-inter)] ${
                isDark ? "text-zinc-400" : "text-[#86868b]"
              }`}
            >
              Позвоните нам — оформим всё за вас
            </p>
          </div>
        </div>

        {/* Right: phone number */}
        <a
          href={`tel:${phone}`}
          className={`inline-flex items-center gap-2 font-[family-name:var(--font-manrope)] font-semibold text-base px-5 py-2.5 rounded-full transition-all shrink-0 ${
            isDark
              ? "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
              : "bg-green-600 text-white hover:bg-green-700"
          }`}
        >
          {displayPhone}
        </a>
      </div>
    </div>
  );
}
