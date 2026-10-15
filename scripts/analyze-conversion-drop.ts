#!/usr/bin/env tsx
/**
 * Детектор обвала конверсии главной цели → issue автоочереди + Telegram (US-4, #727).
 *
 *   npx tsx scripts/analyze-conversion-drop.ts --data-file conversion.json [--dry-run]
 *
 * Вход — JSON { primaryGoalId: number|null, today: DailyConversion|null, baseline: DailyConversion[] }.
 * Данные собирает шаг backlog-intake.yml (дамп config + Metrika API).
 * Логика — scripts/lib/conversion-drop-detector.ts.
 */
import { execFileSync } from 'node:child_process';
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

/** AC-4.2: сообщение владельцу в тот же день. Секретов нет — не роняем интейк. */
function notifyOwner(text: string, dryRun: boolean): void {
  if (dryRun) {
    console.log('[dry-run] Telegram:', text.replace(/\n/g, ' '));
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chat) {
    console.log('Telegram secrets не заданы — уведомление пропущено.');
    return;
  }
  try {
    execFileSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '15',
        '-X',
        'POST',
        `https://api.telegram.org/bot${token}/sendMessage`,
        '-d',
        `chat_id=${chat}`,
        '-d',
        'parse_mode=HTML',
        '-d',
        'disable_web_page_preview=true',
        '--data-urlencode',
        `text=${text}`,
        '-o',
        '/dev/null',
      ],
      { encoding: 'utf8' },
    );
    console.log('Telegram: отправлено.');
  } catch {
    console.log('Telegram: не отправилось, issue всё равно создаётся.');
  }
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

  const marker = conversionDropMarker(drop.goalId);
  const existing = dryRun ? [] : loadExistingBodies();
  if (existing.some((b) => b.includes(marker))) {
    console.log('Дедуп: issue по этой цели уже есть в окне.');
    return;
  }

  const issue = conversionDropIssue(drop);
  const pctToday = (drop.today.conversion * 100).toFixed(2);
  const pctBase = (drop.baselineAvgConversion * 100).toFixed(2);
  const telegram =
    `🔴 <b>Обвал конверсии</b> цели <code>${drop.goalId}</code>\n` +
    `${escapeHtml(drop.today.date)} (МСК): ${pctToday}% против среднего ${pctBase}% ` +
    `(×${drop.factor.toFixed(1)}).\n` +
    `${drop.today.reaches} достижений / ${drop.today.visits} визитов.`;

  if (dryRun) {
    console.log('[dry-run] Создал бы:', issue.title);
    notifyOwner(telegram, true);
    return;
  }

  const created = ghApi<{ number: number }>(`/repos/${REPO}/issues`, 'POST', {
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
  });
  console.log(`✅ Создана issue #${created.number}: ${issue.title}`);
  notifyOwner(`${telegram}\nЗадача: #${created.number}`, false);
}

main();
