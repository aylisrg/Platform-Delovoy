/**
 * Подсказка клиенту: часть слотов рядом с чужими бронями закрыта под уборку
 * (#1067), чтобы недоступные слоты не выглядели ошибкой.
 */
export const CLEANING_BUFFER_HINT =
  "Время подобрано с учётом уборки: после каждой брони нужен час на уборку, поэтому слоты рядом с другими бронями закрыты.";

export function CleaningBufferHint({ className = "" }: { className?: string }) {
  return (
    <p data-testid="cleaning-buffer-hint" className={`text-xs ${className}`}>
      {CLEANING_BUFFER_HINT}
    </p>
  );
}
