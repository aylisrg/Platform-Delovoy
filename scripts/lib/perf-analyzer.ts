/**
 * Perf-регрессии по роутам — чистая логика (issue #577).
 *
 * Источник данных — nginx access-лог (log_format delovoy_json,
 * infra/nginx/delovoy-park.conf): SSH-шаг backlog-intake.yml агрегирует его
 * на VPS (awk/jq) в плоский список сэмплов {route, requestTimeMs, status} —
 * отдельно за текущие сутки и за 7-дневный базлайн (прошлые ротации
 * logrotate). Дальше — percentile/сравнение здесь, в TypeScript: тестируемо
 * без живого VPS, в отличие от арифметики в awk.
 */

export interface RouteSample {
  route: string;
  requestTimeMs: number;
  status: number;
}

export interface RouteStats {
  route: string;
  p50: number;
  p95: number;
  total: number;
  status5xx: number;
}

export interface PerfRegression {
  route: string;
  current: RouteStats;
  baseline: RouteStats;
  reasons: Array<'p95' | '5xx'>;
}

export interface RegressionOptions {
  /** p95 текущего окна против базлайна — во сколько раз хуже считается регрессией. */
  p95Factor: number;
  /** 5xx текущего окна против базлайна (в пересчёте на сутки) — во сколько раз больше. */
  fiveXxFactor: number;
  /** Меньше сэмплов на роут — percentile слишком шумный, регрессию не объявляем. */
  minSamplesForP95: number;
  /** Меньше 5xx за сутки — единичные сбои, не всплеск (по образцу minCount в detectWarningSpikes). */
  min5xxCount: number;
  /** Топ по объёму трафика — редкие роуты статистически не показательны. */
  topN: number;
}

export const DEFAULT_REGRESSION_OPTIONS: RegressionOptions = {
  p95Factor: 2,
  fiveXxFactor: 3,
  minSamplesForP95: 20,
  min5xxCount: 5,
  topN: 20,
};

/** Nearest-rank percentile: p=95 на [10] элементах → 10-й по счёту (индекс 9). */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** По каждому встретившемуся роуту — p50/p95/total/5xx. Без ограничения на количество роутов. */
export function summarizeRoutes(samples: RouteSample[]): RouteStats[] {
  const byRoute = new Map<string, RouteSample[]>();
  for (const s of samples) {
    const list = byRoute.get(s.route);
    if (list) list.push(s);
    else byRoute.set(s.route, [s]);
  }

  const result: RouteStats[] = [];
  for (const [route, list] of byRoute) {
    const sorted = list.map((s) => s.requestTimeMs).sort((a, b) => a - b);
    result.push({
      route,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      total: list.length,
      status5xx: list.filter((s) => s.status >= 500).length,
    });
  }
  return result;
}

/** Топ-N роутов по объёму трафика текущего окна — только они идут в сравнение с базлайном. */
export function topRoutesByVolume(stats: RouteStats[], n: number): RouteStats[] {
  return [...stats].sort((a, b) => b.total - a.total).slice(0, n);
}

/**
 * Регрессии текущего окна против baseline-окна (baselineDays суток).
 * Роут без данных в baseline (новый эндпоинт) не флагуется — не с чем сравнить.
 */
export function detectRegressions(
  current: RouteStats[],
  baseline: RouteStats[],
  opts: RegressionOptions = DEFAULT_REGRESSION_OPTIONS,
  baselineDays = 7,
): PerfRegression[] {
  const baselineByRoute = new Map(baseline.map((r) => [r.route, r]));
  const regressions: PerfRegression[] = [];

  for (const cur of current) {
    const base = baselineByRoute.get(cur.route);
    if (!base) continue;

    const reasons: Array<'p95' | '5xx'> = [];

    if (cur.total >= opts.minSamplesForP95 && base.total >= opts.minSamplesForP95 && base.p95 > 0) {
      if (cur.p95 >= base.p95 * opts.p95Factor) reasons.push('p95');
    }

    if (cur.status5xx >= opts.min5xxCount) {
      const baselinePerDay = base.status5xx / baselineDays;
      const threshold = opts.fiveXxFactor * Math.max(baselinePerDay, 1e-9);
      if (cur.status5xx >= threshold) reasons.push('5xx');
    }

    if (reasons.length > 0) regressions.push({ route: cur.route, current: cur, baseline: base, reasons });
  }

  return regressions;
}

/** Первая строка тела issue — по ней дедупятся повторные прогоны (по образцу fingerprintMarker). */
export function perfRegressionMarker(route: string): string {
  return `<!-- perf-regression:${route} -->`;
}

export function perfRegressionIssue(
  r: PerfRegression,
  baselineDays: number,
): { title: string; body: string; labels: string[] } {
  const reasonText = r.reasons.join(' + ');
  return {
    title: `📉 Perf regression: ${r.route} — ${reasonText}`,
    labels: ['perf-regression', 'auto-detected', 'prio:P2', 'auto:ready'],
    body: `${perfRegressionMarker(r.route)}

## Деградация производительности роута

**Route:** \`${r.route}\`
**Причина:** ${reasonText}

| Метрика | Текущее (сутки) | Базлайн (${baselineDays}д) |
|---|---|---|
| p50, ms | ${r.current.p50} | ${r.baseline.p50} |
| p95, ms | ${r.current.p95} | ${r.baseline.p95} |
| Запросов | ${r.current.total} | ${r.baseline.total} |
| 5xx | ${r.current.status5xx} | ${r.baseline.status5xx} |

---
*Создано автоматически: \`scripts/analyze-perf.ts\` (workflow \`backlog-intake.yml\`).*`,
  };
}
