import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REGRESSION_OPTIONS,
  RouteSample,
  detectRegressions,
  perfRegressionIssue,
  perfRegressionMarker,
  summarizeRoutes,
  topRoutesByVolume,
} from '../perf-analyzer';

describe('summarizeRoutes', () => {
  it('считает p50/p95/total/5xx по каждому роуту отдельно', () => {
    const samples: RouteSample[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ route: '/api/gazebos', requestTimeMs: (i + 1) * 10, status: 200 })),
      { route: '/api/cafe', requestTimeMs: 50, status: 200 },
    ];

    const stats = summarizeRoutes(samples);

    expect(stats).toHaveLength(2);
    const gazebos = stats.find((s) => s.route === '/api/gazebos')!;
    expect(gazebos.total).toBe(10);
    // sorted: 10,20,...,100 — p50 (ceil(0.5*10)-1=4) => 50; p95 (ceil(0.95*10)-1=9) => 100
    expect(gazebos.p50).toBe(50);
    expect(gazebos.p95).toBe(100);
    expect(gazebos.status5xx).toBe(0);
  });

  it('считает 5xx отдельно от общего count', () => {
    const samples: RouteSample[] = [
      { route: '/api/orders', requestTimeMs: 10, status: 200 },
      { route: '/api/orders', requestTimeMs: 10, status: 500 },
      { route: '/api/orders', requestTimeMs: 10, status: 502 },
      { route: '/api/orders', requestTimeMs: 10, status: 404 },
    ];
    const [stats] = summarizeRoutes(samples);
    expect(stats.total).toBe(4);
    expect(stats.status5xx).toBe(2); // 404 не считается
  });

  it('пустой вход — пустой результат', () => {
    expect(summarizeRoutes([])).toEqual([]);
  });

  it('единственный сэмпл — p50=p95=это значение', () => {
    const [stats] = summarizeRoutes([{ route: '/x', requestTimeMs: 42, status: 200 }]);
    expect(stats.p50).toBe(42);
    expect(stats.p95).toBe(42);
  });
});

describe('topRoutesByVolume', () => {
  it('берёт top-N по total, остальные отбрасывает', () => {
    const stats = [
      { route: '/a', p50: 1, p95: 1, total: 100, status5xx: 0 },
      { route: '/b', p50: 1, p95: 1, total: 300, status5xx: 0 },
      { route: '/c', p50: 1, p95: 1, total: 200, status5xx: 0 },
    ];
    const top2 = topRoutesByVolume(stats, 2);
    expect(top2.map((s) => s.route)).toEqual(['/b', '/c']);
  });

  it('не мутирует исходный массив', () => {
    const stats = [
      { route: '/a', p50: 1, p95: 1, total: 1, status5xx: 0 },
      { route: '/b', p50: 1, p95: 1, total: 2, status5xx: 0 },
    ];
    const original = [...stats];
    topRoutesByVolume(stats, 1);
    expect(stats).toEqual(original);
  });
});

describe('detectRegressions', () => {
  const route = (over: Partial<{ route: string; p50: number; p95: number; total: number; status5xx: number }>) => ({
    route: 'r',
    p50: 100,
    p95: 200,
    total: 50,
    status5xx: 0,
    ...over,
  });

  it('p95 вырос в 2+ раза при достаточной выборке — регрессия', () => {
    const current = [route({ p95: 400, total: 50 })];
    const baseline = [route({ p95: 200, total: 50 })];
    const result = detectRegressions(current, baseline);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain('p95');
  });

  it('p95 вырос меньше чем в 2 раза — не регрессия', () => {
    const current = [route({ p95: 300, total: 50 })];
    const baseline = [route({ p95: 200, total: 50 })];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it('недостаточно сэмплов для p95 (шум) — не флагуется', () => {
    const current = [route({ p95: 1000, total: 5 })]; // < minSamplesForP95 (20)
    const baseline = [route({ p95: 200, total: 50 })];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it('5xx вырос в 3+ раза относительно базлайна/сутки — регрессия', () => {
    // baseline: 21 событие за 7 суток = 3/сутки; текущее >= 3*3=9
    const current = [route({ status5xx: 9, total: 200 })];
    const baseline = [route({ status5xx: 21, total: 500 })];
    const result = detectRegressions(current, baseline, DEFAULT_REGRESSION_OPTIONS, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain('5xx');
  });

  it('5xx ниже min5xxCount — единичный сбой, не регрессия', () => {
    const current = [route({ status5xx: 2, total: 200 })]; // < min5xxCount (5)
    const baseline = [route({ status5xx: 0, total: 500 })];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it('нулевой baseline 5xx: minCount уже отсекает шум, epsilon не даёт ложных нулей', () => {
    const current = [route({ status5xx: 6, total: 200 })]; // >= min5xxCount
    const baseline = [route({ status5xx: 0, total: 500 })];
    const result = detectRegressions(current, baseline);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toEqual(['5xx']);
  });

  it('роут без данных в baseline (новый эндпоинт) — не флагуется', () => {
    const current = [route({ route: 'new-route', p95: 5000, status5xx: 100, total: 200 })];
    const baseline: ReturnType<typeof route>[] = [];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it('обе причины одновременно — reasons содержит обе', () => {
    const current = [route({ p95: 800, status5xx: 30, total: 200 })];
    const baseline = [route({ p95: 200, status5xx: 21, total: 500 })];
    const result = detectRegressions(current, baseline, DEFAULT_REGRESSION_OPTIONS, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toEqual(['p95', '5xx']);
  });

  it('здоровый роут (не хуже базлайна) — не флагуется', () => {
    const current = [route({ p95: 150, status5xx: 1, total: 200 })];
    const baseline = [route({ p95: 200, status5xx: 7, total: 500 })];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });
});

describe('perfRegressionMarker / perfRegressionIssue — дедуп', () => {
  it('маркер стабилен для одного и того же роута', () => {
    expect(perfRegressionMarker('/api/gazebos')).toBe(perfRegressionMarker('/api/gazebos'));
  });

  it('разные роуты — разные маркеры', () => {
    expect(perfRegressionMarker('/api/gazebos')).not.toBe(perfRegressionMarker('/api/cafe'));
  });

  it('тело issue содержит маркер первой строкой — дедуп по include() найдёт его', () => {
    const regression = {
      route: '/api/gazebos',
      current: { route: '/api/gazebos', p50: 100, p95: 500, total: 100, status5xx: 10 },
      baseline: { route: '/api/gazebos', p50: 90, p95: 200, total: 300, status5xx: 3 },
      reasons: ['p95' as const],
    };
    const issue = perfRegressionIssue(regression, 7);
    expect(issue.body.startsWith(perfRegressionMarker('/api/gazebos'))).toBe(true);
    expect(issue.labels).toEqual(['perf-regression', 'auto-detected', 'prio:P2', 'auto:ready']);
  });
});
