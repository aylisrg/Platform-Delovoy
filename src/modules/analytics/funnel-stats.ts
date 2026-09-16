/**
 * Чистая математика конверсии воронки — вынесена из product-events.ts
 * (issue #726, ADR 2026-09-16-weekly-product-analyst-loop §3), чтобы
 * недельный отчёт (`scripts/funnel-weekly.ts`, чистый tsx-CLI) мог считать
 * те же числа, что и `GET /api/analytics/funnel`, без импорта `@/lib/db` —
 * одна реализация математики на обоих потребителей.
 */
import { FUNNELS, type FunnelKey } from "./funnels";
import type { FunnelStats, FunnelStatsData, FunnelStepStats } from "./types";

export type FunnelStatsRow = { funnel: string; step: string; events: number; sessions: number };

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Та же математика, что раньше жила внутри `getFunnelStats` — поведение и тесты не меняются. */
export function aggregateFunnelStats(
  rows: FunnelStatsRow[],
  period: { dateFrom: string; dateTo: string },
  funnel?: FunnelKey
): FunnelStatsData {
  const byFunnel = new Map<string, Map<string, FunnelStatsRow>>();
  for (const row of rows) {
    if (!byFunnel.has(row.funnel)) byFunnel.set(row.funnel, new Map());
    byFunnel.get(row.funnel)!.set(row.step, row);
  }

  const funnelKeys = funnel ? [funnel] : (Object.keys(FUNNELS) as FunnelKey[]);
  const funnels: FunnelStats[] = funnelKeys.map((key) => {
    const def = FUNNELS[key];
    const rowsByStep = byFunnel.get(key) ?? new Map<string, FunnelStatsRow>();
    const topSessions = Number(rowsByStep.get(def.steps[0]?.step ?? "")?.sessions ?? 0);

    let prevSessions: number | null = null;
    const steps: FunnelStepStats[] = def.steps.map((stepDef) => {
      const row = rowsByStep.get(stepDef.step);
      const events = Number(row?.events ?? 0);
      const sessions = Number(row?.sessions ?? 0);
      const conversionFromPrev =
        prevSessions === null ? null : prevSessions > 0 ? round1((sessions / prevSessions) * 100) : 0;
      const conversionFromTop = topSessions > 0 ? round1((sessions / topSessions) * 100) : 0;
      prevSessions = sessions;
      return { step: stepDef.step, label: stepDef.label, events, sessions, conversionFromPrev, conversionFromTop };
    });

    let biggestDropStep: string | null = null;
    let worstDrop = Infinity;
    for (const s of steps.slice(1)) {
      if (s.conversionFromPrev !== null && s.conversionFromPrev < worstDrop) {
        worstDrop = s.conversionFromPrev;
        biggestDropStep = s.step;
      }
    }

    return { funnel: key, steps, biggestDropStep };
  });

  return { period, funnels };
}
