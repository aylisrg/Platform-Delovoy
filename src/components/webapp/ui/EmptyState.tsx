import type { ReactNode } from "react";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { Icon } from "./Icon";

interface EmptyStateProps {
  icon: WebAppIconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}

/** Содержательное пустое состояние (AC-2.3, AC-3.5) — не пустой экран. */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <span style={{ color: "var(--tg-hint)" }}>
        <Icon name={icon} size={44} strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-[17px] font-semibold">{title}</p>
      {hint && (
        <p
          className="mt-1.5 text-[14px] leading-relaxed"
          style={{ color: "var(--tg-hint)" }}
        >
          {hint}
        </p>
      )}
      {action && <div className="mt-5 w-full">{action}</div>}
    </div>
  );
}
