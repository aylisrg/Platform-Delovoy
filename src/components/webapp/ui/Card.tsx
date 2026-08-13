import type { HTMLAttributes } from "react";

/**
 * Карточка на токене темы (--tg-section-bg), без градиентов (AC-7.2).
 */
export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `tg-card ${className}` : "tg-card"} {...rest}>
      {children}
    </div>
  );
}
