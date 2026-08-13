import type { ReactNode } from "react";

/** Заголовок группы в стиле нативного Telegram. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return <p className="tg-section-header">{children}</p>;
}
