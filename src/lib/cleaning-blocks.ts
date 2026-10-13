/**
 * Блоки «Уборка» для админского таймлайна (#1085) поверх буфера из #1067.
 *
 * Уборка не хранится в БД: блок вычисляется из брони как
 * `[endTime, endTime + bufferMinutes)`. Поэтому:
 *  - отмена брони убирает и уборку (бронь пропадает из таймлайна);
 *  - перенос брони переносит уборку;
 *  - в выручку, загрузку и отчёты уборка не попадает (там её просто нет).
 *
 * Блок обрезается по закрытию парка и по началу следующей брони того же
 * ресурса (админ мог поставить бронь в буфер вручную, или это бронь до
 * релиза #1067). Если места нет совсем, блок не рисуется.
 *
 * Чистый модуль без Prisma: импортируется из клиентских компонентов.
 */
export type CleaningBlock = {
  /** id брони, после которой уборка. */
  bookingId: string;
  resourceId: string;
  /** ISO datetime. */
  startTime: string;
  /** ISO datetime. */
  endTime: string;
  minutes: number;
};

type BookingLike = { id: string; resourceId: string; startTime: string; endTime: string };

export function deriveCleaningBlocks(
  bookings: BookingLike[],
  bufferMinutes: number | undefined,
  closeAt: Date
): CleaningBlock[] {
  if (!bufferMinutes || bufferMinutes <= 0) return [];
  const bufferMs = bufferMinutes * 60_000;
  const blocks: CleaningBlock[] = [];

  for (const b of bookings) {
    const start = new Date(b.endTime).getTime();
    let end = Math.min(start + bufferMs, closeAt.getTime());
    for (const other of bookings) {
      if (other.id === b.id || other.resourceId !== b.resourceId) continue;
      const otherStart = new Date(other.startTime).getTime();
      if (otherStart >= start && otherStart < end) end = otherStart;
    }
    if (end <= start) continue;
    blocks.push({
      bookingId: b.id,
      resourceId: b.resourceId,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      minutes: Math.round((end - start) / 60_000),
    });
  }
  return blocks;
}

/** «1 ч», «30 мин», «1 ч 30 мин». */
export function formatCleaningDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}
