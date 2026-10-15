#!/usr/bin/env tsx
/**
 * Детектор обвала конверсии главной цели → issue автоочереди (US-4, #727).
 *
 *   npx tsx scripts/analyze-conversion-drop.ts --data-file conversion.json [--dry-run]
 *
 * Вход — JSON { primaryGoalId: number|null, today: DailyConversion|null, baseline: DailyConversion[] }.
 * Данные собирает шаг backlog-intake.yml (дамп config + Metrika API).
 * Логика — scripts/lib/conversion-drop-detector.ts.
 */
import { readFileSync } from 'node:fs';
import { REPO, ghApi } from './lib/gh-api';
import {
  DEFAULT_DROP_OPTIONS,
  DailyConversion,
  conversionDropIssue,
  conversionDropMarker,
  detectConversionDrop,
} from './lib/conversion-drop-detector';
import { DEDUP_WINDOW_DAYS } from './lib/github-issues';

interface InputData {
  primaryGoalId: number | null;
  today: DailyConversion | null;
  baseline: DailyConversion[];
}

interface RawIssue {
  number: number;
  body: string | null;
  pull_request?: unknown;
}

function loadExistingBodies(): string[] {
  const since = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const bodies: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = ghApi<RawIssue[]>(
      `/repos/${REPO}/issues?state=all&labels=auto-detected&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
    );
    const issues = batch.filter((i) => !i.pull_request);
    bodies.push(...issues.map((i) => i.body ?? ''));
    if (batch.length < 100) break;
  }
  return bodies;
}

function parseArgs(): { file: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIdx = args.indexOf('--data-file');
  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error('Usage: analyze-conversion-drop.ts --data-file <path> [--dry-run]');
    process.exit(1);
  }
  return { file: args[fileIdx + 1], dryRun };
}

function main(): void {
  const { file, dryRun } = parseArgs();
  const raw = readFileSync(file, 'utf8');
  const data = JSON.parse(raw) as InputData;

  const drop = detectConversionDrop(
    data.primaryGoalId,
    data.today,
    data.baseline ?? [],
    DEFAULT_DROP_OPTIONS,
  );

  if (!drop) {
    console.log('✅ Обвала конверсии нет (или нет данных / цель не задана).');
    return;
  }

  console.log(
    `Обвал: цель ${drop.goalId}, фактор ×${drop.factor.toFixed(1)}, сегодня ${drop.today.date}`,
  );

  const marker = conversionDropMarker(drop.goalId, drop.today.date);
  const existing = dryRun ? [] : loadExistingBodies();
  if (existing.some((b) => b.includes(marker))) {
    console.log('Дедуп: issue с этим маркером уже есть в окне.');
    return;
  }

  const issue = conversionDropIssue(drop);
  if (dryRun) {
    console.log('[dry-run] Создал бы:', issue.title);
    return;
  }

  const created = ghApi<{ number: number }>(`/repos/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    }),
  });
  console.log(`✅ Создана issue #${created.number}: ${issue.title}`);
}

main();
