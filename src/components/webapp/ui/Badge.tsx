import type { ReactNode } from "react";

type BadgeTone = "accent" | "success" | "warning" | "destructive" | "neutral";

const TONE_STYLES: Record<BadgeTone, { bg: string; color: string }> = {
  accent: { bg: "color-mix(in srgb, var(--tg-accent) 14%, transparent)", color: "var(--tg-accent)" },
  success: { bg: "rgba(52, 199, 89, 0.14)", color: "#34c759" },
  warning: { bg: "rgba(255, 159, 10, 0.14)", color: "#ff9f0a" },
  destructive: {
    bg: "color-mix(in srgb, var(--tg-destructive) 14%, transparent)",
    color: "var(--tg-destructive)",
  },
  neutral: { bg: "var(--tg-secondary-bg)", color: "var(--tg-hint)" },
};

/** Статус-бейдж (брони, заказы, счётчики). */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className="tg-badge"
      style={{ background: style.bg, color: style.color }}
    >
      {children}
    </span>
  );
}
