import { prisma } from "@/lib/db";

/**
 * Буфер на уборку после каждой брони (#1067).
 *
 * Правило: после окончания брони ресурс недоступен для клиентских броней
 * `cleaningBufferMinutes` минут (настройка модуля, по умолчанию 60, 0 = выкл).
 * Буфер действует и в обратную сторону: новая клиентская бронь должна
 * закончиться не позже чем за буфер до начала следующей.
 *
 * Админ может вручную поставить бронь в буфер (решение владельца), поэтому
 * админские пути используют строгую проверку без буфера.
 *
 * Буфер не переносится через ночь: проверки идут только по броням той же даты (`date`),
 * поэтому последняя бронь дня не блокирует утро следующего.
 */
export const DEFAULT_CLEANING_BUFFER_MINUTES = 60;
/** Верхняя граница настройки: целые минуты 0..240. */
export const MAX_CLEANING_BUFFER_MINUTES = 240;

export function parseCleaningBufferMinutes(config: unknown): number {
  const val = (config as Record<string, unknown> | null | undefined)?.cleaningBufferMinutes;
  if (typeof val !== "number" || !Number.isFinite(val)) return DEFAULT_CLEANING_BUFFER_MINUTES;
  return Math.min(MAX_CLEANING_BUFFER_MINUTES, Math.max(0, Math.round(val)));
}

export async function getCleaningBufferMinutes(moduleSlug: string): Promise<number> {
  const moduleRecord = await prisma.module.findUnique({ where: { slug: moduleSlug } });
  return parseCleaningBufferMinutes(moduleRecord?.config);
}

/** Prisma-условие пересечения с учётом буфера: S < end+buf && E > start-buf. */
export function bufferedOverlapWhere(start: Date, end: Date, bufferMinutes: number) {
  const ms = bufferMinutes * 60_000;
  return {
    startTime: { lt: new Date(end.getTime() + ms) },
    endTime: { gt: new Date(start.getTime() - ms) },
  };
}

/**
 * Занят ли слот [slotStart, slotEnd) бронью `b` с учётом буфера: бронь+буфер
 * пересекает слот, или слот+буфер залезает на бронь.
 */
export function isSlotBlocked(
  b: { startTime: Date; endTime: Date },
  slotStart: Date,
  slotEnd: Date,
  bufferMinutes: number
): boolean {
  const ms = bufferMinutes * 60_000;
  return (
    b.startTime.getTime() < slotEnd.getTime() + ms &&
    b.endTime.getTime() + ms > slotStart.getTime()
  );
}
