"use client";

import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/** Кнопка на токенах темы. primary — стиль MainButton Telegram. */
export function Button({
  variant = "primary",
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  const variantStyle =
    variant === "primary"
      ? { background: "var(--tg-button)", color: "var(--tg-button-text)" }
      : variant === "destructive"
        ? {
            background:
              "color-mix(in srgb, var(--tg-destructive) 12%, transparent)",
            color: "var(--tg-destructive)",
          }
        : { background: "var(--tg-section-bg)", color: "var(--tg-accent)" };

  return (
    <button
      type="button"
      className={className ? `tg-button ${className}` : "tg-button"}
      style={{ ...variantStyle, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
