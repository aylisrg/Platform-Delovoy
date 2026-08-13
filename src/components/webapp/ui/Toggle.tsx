"use client";

/**
 * Нативный переключатель для Центра уведомлений и настроек.
 * Управляемый: состояние держит родитель (оптимистичное обновление + откат
 * при ошибке — на стороне вызывающего экрана).
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
      style={{
        width: 51,
        height: 31,
        background: checked ? "var(--tg-button)" : "var(--tg-secondary-bg)",
        boxShadow: checked ? "none" : "inset 0 0 0 1.5px var(--tg-separator)",
      }}
    >
      <span
        className="absolute top-[2px] rounded-full bg-white transition-transform duration-200"
        style={{
          width: 27,
          height: 27,
          left: 2,
          transform: checked ? "translateX(20px)" : "translateX(0)",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)",
        }}
      />
    </button>
  );
}
