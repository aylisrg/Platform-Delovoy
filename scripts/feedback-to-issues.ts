#!/usr/bin/env tsx
/**
 * Фидбек пользователей → issues автоочереди.
 *
 * Вход — psql-дамп FeedbackItem со status=NEW (json_agg), снятый джобой
 * backlog-intake.yml по SSH: прод-Postgres недоступен раннерам напрямую.
 *
 *   npx tsx scripts/feedback-to-issues.ts --file feedback.json [--dry-run] [--max-issues 20]
 *
 * BUG → prio:P1|P2 (по isUrgent) + auto:ready — сразу в очередь.
 * SUGGESTION → enhancement без auto:* — входящая для шага-0 триажа.
 * BUG, похожий на тестовое/пустое сообщение (isLikelyTestFeedback,
 * issue #540) — issue не заводится вовсе, только строка в лог: не мусорить
 * P1-очередь тестовыми "Тест фитбек" (issue #484, #486).
 * Дедуп — маркер `<!-- feedback:<id> -->` по issues с лейблом from-feedback.
 * Обратной синхронизации статуса в FeedbackItem нет намеренно (см. ADR).
 */
import { readFileSync } from 'node:fs';
import { REPO, ghApi } from './lib/gh-api';
import { alreadyBridged, feedbackToIssue, isLikelyTestFeedback, parseFeedbackJson } from './lib/feedback-bridge';

function existingFeedbackBodies(): string[] {
  const bodies: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = ghApi<{ body: string | null; pull_request?: unknown }[]>(
      `/repos/${REPO}/issues?state=all&labels=from-feedback&per_page=100&page=${page}`,
    );
    bodies.push(...batch.filter((i) => !i.pull_request).map((i) => i.body ?? ''));
    if (batch.length < 100) break;
  }
  return bodies;
}

function main(): void {
  const args = process.argv.slice(2);
  let file = '';
  let dryRun = false;
  let maxIssues = 20;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': file = args[++i] ?? ''; break;
      case '--dry-run': dryRun = true; break;
      case '--max-issues': maxIssues = parseInt(args[++i], 10); break;
      default: throw new Error(`неизвестный флаг «${args[i]}»`);
    }
  }
  if (!file) throw new Error('нужен --file <дамп FeedbackItem>');

  const rows = parseFeedbackJson(readFileSync(file, 'utf8'));
  console.log(`Фидбек-записей в дампе: ${rows.length}`);
  if (rows.length === 0) {
    console.log('Нечего переносить.');
    return;
  }

  const existing = existingFeedbackBodies();
  let created = 0;
  let skipped = 0;
  let filteredTest = 0;

  for (const row of rows) {
    if (alreadyBridged(row, existing)) {
      skipped++;
      continue;
    }
    if (row.type === 'BUG' && isLikelyTestFeedback(row.description)) {
      filteredTest++;
      const preview = row.description.replace(/\s+/g, ' ').trim().slice(0, 80);
      console.log(`[filtered: likely-test] ${row.id} — «${preview}»`);
      continue;
    }
    if (created >= maxIssues) {
      console.log(`⚠️  Достигнут потолок ${maxIssues} issues за прогон — остальное завтра.`);
      break;
    }
    const issue = feedbackToIssue(row);
    if (dryRun) {
      console.log(`[DRY RUN] ${issue.title} [${issue.labels.join(', ')}]`);
      created++;
      continue;
    }
    const res = ghApi<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', issue);
    existing.push(issue.body);
    console.log(`Created: #${res.number} ${res.html_url}`);
    created++;
  }

  console.log(`\n✅ создано: ${created}, пропущено (уже есть): ${skipped}, отфильтровано как тестовые: ${filteredTest}`);
}

try {
  main();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
