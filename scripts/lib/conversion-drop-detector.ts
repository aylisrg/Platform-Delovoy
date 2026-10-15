/**
 * Детектор обвала конверсии главной цели (US-4, issue #727).
 *
 * Чистая логика: сравнение конверсии за сегодня с средним за предыдущие 7 дней.
 * Падение ≥2× при достаточном объёме → сигнал. Дедуп по маркеру в теле issue.
 *
 * Часовой пояс: МСК (Europe/Moscow), как остальные кроны проекта.
 */

export interface DailyConversion {
  /** YYYY-MM-DD в МСК. */
  date: string;
  reaches: number;
  visits: number;
  /** reaches / visits, 0 if visits=0. */
  conversion: number;
}

export interface DropDetectionOptions {
  /** Во сколько раз должна упасть конверсия. */
  dropFactor: number;
  /** Минимум reaches за сегодня, ниже — шум, не сигналим (QA-заметка к PRD). */
  minReachesToday: number;
  /** Минимум дней в базлайне с visits>0. */
  minBaselineDays: number;
}

export const DEFAULT_DROP_OPTIONS: DropDetectionOptions = {
  dropFactor: 2,
  minReachesToday: 3, // избегаем срабатывания на 1–2 событиях
  minBaselineDays: 3,
};

export interface ConversionDrop {
  goalId: number;
  today: DailyConversion;
  baselineAvgConversion: number;
  factor: number;
  baselineDays: number;
}

/**
 * Считает среднее conversion по дням с visits > 0.
 */
export function baselineAverage(baseline: DailyConversion[]): {
  avg: number;
  days: number;
} {
  const valid = baseline.filter((d) => d.visits > 0);
  if (valid.length === 0) return { avg: 0, days: 0 };
  const sum = valid.reduce((s, d) => s + d.conversion, 0);
  return { avg: sum / valid.length, days: valid.length };
}

/**
 * Возвращает drop если условия выполнены, иначе null.
 * primaryGoalId null → null (AC-4.4).
 */
export function detectConversionDrop(
  primaryGoalId: number | null,
  today: DailyConversion | null,
  baseline: DailyConversion[],
  options: DropDetectionOptions = DEFAULT_DROP_OPTIONS,
): ConversionDrop | null {
  if (primaryGoalId == null || today == null) return null;
  if (today.reaches < options.minReachesToday) return null;

  const { avg, days } = baselineAverage(baseline);
  if (days < options.minBaselineDays || avg <= 0) return null;

  const factor = avg / (today.conversion || Number.EPSILON);
  if (factor < options.dropFactor) return null;

  return {
    goalId: primaryGoalId,
    today,
    baselineAvgConversion: avg,
    factor,
    baselineDays: days,
  };
}

/** Маркер для дедупа: одна issue на цель + дату сегодня (state=all окно). */
export function conversionDropMarker(goalId: number, date: string): string {
  return `<!-- conversion-drop:${goalId}:${date} -->`;
}

export function conversionDropIssue(drop: ConversionDrop): {
  title: string;
  body: string;
  labels: string[];
} {
  const pctToday = (drop.today.conversion * 100).toFixed(2);
  const pctBase = (drop.baselineAvgConversion * 100).toFixed(2);
  return {
    title: `🔴 Обвал конверсии цели ${drop.goalId}: ×${drop.factor.toFixed(1)} за ${drop.today.date}`,
    labels: ['bug', 'auto-detected', 'prio:P1', 'auto:ready'],
    body: `${conversionDropMarker(drop.goalId, drop.today.date)}

## Обвал конверсии главной цели

**Цель:** \`${drop.goalId}\`
**Дата (МСК):** ${drop.today.date}
**Сегодня:** ${drop.today.reaches} достижений / ${drop.today.visits} визитов = ${pctToday}%
**Среднее за ${drop.baselineDays} дней:** ${pctBase}%
**Падение:** в ${drop.factor.toFixed(1)} раза

Требуется разбор: что изменилось в воронке бронирований (или выбранной цели).

Часть US-4 (issue #727).`,
  };
}
