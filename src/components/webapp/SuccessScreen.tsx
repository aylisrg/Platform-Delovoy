"use client";

import { useEffect } from "react";
import { useTelegram } from "./TelegramProvider";
import { Button, Card, Icon } from "./ui";

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
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 py-8 tg-page-enter">
      {/* Отметка успеха — на акценте темы, без фирменных цветов (AC-7.2) */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
        style={{
          background: "color-mix(in srgb, var(--tg-accent) 14%, transparent)",
          color: "var(--tg-accent)",
        }}
      >
        <Icon name="check" size={40} strokeWidth={2.5} />
      </div>

      <h2 className="text-[22px] font-bold text-center">{title}</h2>
      {subtitle && (
        <p
          className="mt-2 text-[15px] text-center"
          style={{ color: "var(--tg-subtitle)" }}
        >
          {subtitle}
        </p>
      )}

      {details && details.length > 0 && (
        <Card className="mt-6 w-full p-4 space-y-2">
          {details.map((d) => (
            <div key={d.label} className="flex justify-between gap-4 text-[15px]">
              <span style={{ color: "var(--tg-hint)" }}>{d.label}</span>
              <span className="font-medium text-right">{d.value}</span>
            </div>
          ))}
        </Card>
      )}

      {onAction && (
        <div className="mt-8 w-full">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </div>
  );
}
