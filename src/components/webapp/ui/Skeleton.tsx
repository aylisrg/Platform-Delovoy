/** Скелетон загрузки на токенах темы. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={className ? `tg-skeleton ${className}` : "tg-skeleton"} />
  );
}
