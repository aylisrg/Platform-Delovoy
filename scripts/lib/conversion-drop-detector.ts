/**
 * Детектор обвала конверсии главной цели (US-4, issue #727).
 *
 * Чистая логика: сравнение конверсии за сегодня с средним за предыдущие 7 дней.
 * Падение ≥2× при достаточном ожидаемом объёме → сигнал. Дедуп по маркеру цели
 * (без даты): продолжающееся падение не плодит issue каждый день (AC-4.3).
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
  /**
   * Минимум ожидаемых reaches (средняя конверсия × визиты сегодня).
   * Ниже — шум малого объёма, не сигналим. Ноль достижений при нормальном
   * трафике сюда не попадает: ожидаемые reaches остаются высокими.
   */
  minExpectedReaches: number;
  /** Минимум дней в базлайне с visits>0. */
  minBaselineDays: number;
}

export const DEFAULT_DROP_OPTIONS: DropDetectionOptions = {
  dropFactor: 2,
  minExpectedReaches: 3,
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
 * reaches=0 при достаточном трафике — обвал, не шум.
 */
export function detectConversionDrop(
  primaryGoalId: number | null,
  today: DailyConversion | null,
  baseline: DailyConversion[],
  options: DropDetectionOptions = DEFAULT_DROP_OPTIONS,
): ConversionDrop | null {
  if (primaryGoalId == null || today == null) return null;
  if (today.visits <= 0) return null;

  const { avg, days } = baselineAverage(baseline);
  if (days < options.minBaselineDays || avg <= 0) return null;

  const expectedReaches = avg * today.visits;
  if (expectedReaches < options.minExpectedReaches) return null;

  const factor = avg / (today.conversion > 0 ? today.conversion : Number.EPSILON);
  if (factor < options.dropFactor) return null;

  return {
    goalId: primaryGoalId,
    today,
    baselineAvgConversion: avg,
    factor,
    baselineDays: days,
  };
}

/** Маркер дедупа: одна issue на цель в окне state=all, без даты (AC-4.3). */
export function conversionDropMarker(goalId: number): string {
  return `<!-- conversion-drop:${goalId} -->`;
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
    body: `${conversionDropMarker(drop.goalId)}

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
