"use client";

import { useEffect } from "react";
import { useTelegram } from "./TelegramProvider";

interface SuccessScreenProps {
  title: string;
  subtitle?: string;
  details?: Array<{ label: string; value: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

export function SuccessScreen({
  title,
  subtitle,
  details,
  actionLabel = "Готово",
  onAction,
}: SuccessScreenProps) {
  const { haptic } = useTelegram();

  useEffect(() => {
    haptic.notification("success");
  }, [haptic]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 tg-page-enter">
      {/* Animated checkmark */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
        style={{ background: "#dcfce7" }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="text-[22px] font-bold text-center">{title}</h2>
      {subtitle && (
        <p className="mt-2 text-[15px] text-center" style={{ color: "var(--tg-hint)" }}>
          {subtitle}
        </p>
      )}

      {details && details.length > 0 && (
        <div
          className="mt-6 w-full rounded-2xl p-4 space-y-2"
          style={{ background: "var(--tg-secondary-bg)" }}
        >
          {details.map((d) => (
            <div key={d.label} className="flex justify-between text-[15px]">
              <span style={{ color: "var(--tg-hint)" }}>{d.label}</span>
              <span className="font-medium">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {onAction && (
        <button onClick={onAction} className="tg-button mt-8">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
