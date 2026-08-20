#!/usr/bin/env tsx
/**
 * Perf-регрессии nginx (p95/5xx по роутам) → issues автоочереди (issue #577).
 *
 *   npx tsx scripts/analyze-perf.ts --events-file perf-aggregate.json [--dry-run]
 *
 * Вход — JSON {current: RouteSample[], baseline: RouteSample[]}, который
 * собирает SSH-шаг backlog-intake.yml (awk/jq на VPS читает
 * infra/nginx/delovoy-park.conf → log_format delovoy_perf). Сам расчёт
 * перцентилей и сравнение с базлайном — чистые функции scripts/lib/perf-analyzer.ts.
 */
import { readFileSync } from 'node:fs';
import { REPO, ghApi } from './lib/gh-api';
import {
  DEFAULT_REGRESSION_OPTIONS,
  RouteSample,
  detectRegressions,
  perfRegressionIssue,
  perfRegressionMarker,
  summarizeRoutes,
  topRoutesByVolume,
} from './lib/perf-analyzer';
import { BATCH_LABEL } from './lib/issue-batch';
import { batchAdd, batchCommentBodies, loadBatchMaxItems } from './lib/batch-io';
import { DEDUP_WINDOW_DAYS } from './lib/github-issues';

const BASELINE_DAYS = 7;

interface Aggregate {
  current: RouteSample[];
  baseline: RouteSample[];
}

interface RawIssue {
  number: number;
  body: string | null;
  pull_request?: unknown;
}

/**
 * Дедуп-скан: perf-regression issues за окно (state=all — регрессия, чью issue
 * закрыли на днях, не перечеканивается назавтра) плюс зонтики с комментариями —
 * P2-регрессии теперь живут пунктами зонтика `perf`, их маркеры внутри пунктов.
 */
function loadExistingBodies(): string[] {
  const since = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const bodies: string[] = [];
  for (const label of ['perf-regression', BATCH_LABEL]) {
    for (let page = 1; page <= 5; page++) {
      const batch = ghApi<RawIssue[]>(
        `/repos/${REPO}/issues?state=all&labels=${encodeURIComponent(label)}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
      );
      const issues = batch.filter((i) => !i.pull_request);
      bodies.push(...issues.map((i) => i.body ?? ''));
      if (label === BATCH_LABEL) {
        for (const i of issues) bodies.push(...batchCommentBodies(i.number));
      }
      if (batch.length < 100) break;
    }
  }
  return bodies;
}

function parseArgs(): { file: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIdx = args.indexOf('--events-file');
  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error('Usage: analyze-perf.ts --events-file <path> [--dry-run]');
    process.exit(1);
  }
  return { file: args[fileIdx + 1], dryRun };
}

function main(): void {
  const { file, dryRun } = parseArgs();

  const raw = readFileSync(file, 'utf8');
  const agg = JSON.parse(raw) as Aggregate;
  if (!Array.isArray(agg.current) || !Array.isArray(agg.baseline)) {
    throw new Error(`Некорректный формат ${file}: ожидался {current: [], baseline: []}`);
  }

  const currentStats = topRoutesByVolume(summarizeRoutes(agg.current), DEFAULT_REGRESSION_OPTIONS.topN);
  const baselineStats = summarizeRoutes(agg.baseline);
  const regressions = detectRegressions(currentStats, baselineStats, DEFAULT_REGRESSION_OPTIONS, BASELINE_DAYS);

  console.log(
    `Сэмплов: current=${agg.current.length}, baseline=${agg.baseline.length}. ` +
      `Роутов в топ-${DEFAULT_REGRESSION_OPTIONS.topN}: ${currentStats.length}. Регрессий: ${regressions.length}`,
  );

  if (regressions.length === 0) {
    console.log('✅ Регрессий не найдено.');
    return;
  }

  const existingBodies = dryRun ? [] : loadExistingBodies();
  let created = 0;

  for (const r of regressions) {
    const marker = perfRegressionMarker(r.route);
    const issue = perfRegressionIssue(r, BASELINE_DAYS);

    console.log(`\nРегрессия: ${r.route} (${r.reasons.join(' + ')})`);
    console.log(`  p95: ${r.baseline.p95}ms → ${r.current.p95}ms; 5xx: ${r.baseline.status5xx} → ${r.current.status5xx}`);

    if (dryRun) {
      console.log(`[DRY RUN] Would add batch item (perf):\nTitle: ${issue.title}`);
      continue;
    }
    if (existingBodies.some((b) => b.includes(marker))) {
      console.log(`Issue already exists (${marker}), skipping`);
      continue;
    }
    // Perf-регрессии всегда P2 → пунктом в зонтик `perf`, не отдельной issue
    // (правило гранулярности CLAUDE.md). Тело issue целиком — в детали пункта,
    // вместе с маркером: дедуп по маркеру продолжает работать.
    const res = batchAdd({
      area: 'perf',
      key: `perf-${r.route}`,
      title: issue.title,
      details: issue.body,
      maxItems: loadBatchMaxItems(),
    });
    if (res.deduped) {
      console.log(`Batch item already exists (perf-${r.route}), skipping`);
      continue;
    }
    existingBodies.push(issue.body);
    console.log(`Added batch item: ${res.url}`);
    created++;
  }

  console.log(`\n✅ Добавлено ${created} пункт(ов) в зонтик perf`);
}

try {
  main();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
