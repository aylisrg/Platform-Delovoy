"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { Icon } from "./Icon";

interface ListItemProps {
  icon?: WebAppIconName;
  /** Цвет плашки иконки; по умолчанию — акцент темы */
  iconTone?: "accent" | "hint" | "destructive";
  title: ReactNode;
  subtitle?: ReactNode;
  /** Правая часть: chevron, значение, Toggle и т.п. */
  right?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

const TONE_VAR: Record<NonNullable<ListItemProps["iconTone"]>, string> = {
  accent: "var(--tg-accent)",
  hint: "var(--tg-hint)",
  destructive: "var(--tg-destructive)",
};

/** Строка нативного списка: иконка, текст, правый слот. */
export function ListItem({
  icon,
  iconTone = "accent",
  title,
  subtitle,
  right,
  chevron,
  href,
  onClick,
  disabled,
}: ListItemProps) {
  const content = (
    <>
      {icon && (
        <span
          className="flex items-center justify-center w-7 h-7 shrink-0"
          style={{ color: TONE_VAR[iconTone] }}
        >
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] leading-tight truncate">{title}</span>
        {subtitle && (
          <span
            className="block text-[13px] mt-0.5 truncate"
            style={{ color: "var(--tg-subtitle)" }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {right}
      {chevron && (
        <span style={{ color: "var(--tg-hint)" }}>
          <Icon name="chevron-right" size={18} />
        </span>
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className="tg-list-item" onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="tg-list-item w-full text-left disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      {content}
    </button>
  );
}
