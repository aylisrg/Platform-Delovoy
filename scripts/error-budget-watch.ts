#!/usr/bin/env tsx
/**
 * Post-deploy error-budget: решение none/alert/rollback для workflow
 * deploy-error-budget.yml (issue #578).
 *
 *   BEFORE_COUNT=N AFTER_COUNT=N PREVIOUS_SHA=... npx tsx scripts/error-budget-watch.ts
 *
 * PREVIOUS_SHA передаёт workflow из git-тега deployed/previous (его пишет сам
 * deploy.yml): head_sha у workflow_dispatch врёт для rollback-редеплоя. Пуст на
 * первом деплое — тогда откатывать не на что.
 *
 * Пишет action/ratio/previous_sha в $GITHUB_OUTPUT; Telegram и откат делает
 * workflow. GitHub-issues не создаются — алерты только в Telegram.
 */
import { appendFileSync } from 'node:fs';
import { classifyErrorBudget } from './lib/error-budget';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задан env ${name}`);
  return v;
}

function writeOutput(key: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`[no GITHUB_OUTPUT] ${key}=${value}`);
    return;
  }
  appendFileSync(file, `${key}=${value}\n`);
}

function main(): void {
  const previousSha = process.env.PREVIOUS_SHA?.trim() || null;
  const before = Number(requiredEnv('BEFORE_COUNT'));
  const after = Number(requiredEnv('AFTER_COUNT'));

  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) {
    throw new Error(`Некорректные счётчики: before=${process.env.BEFORE_COUNT} after=${process.env.AFTER_COUNT}`);
  }

  const decision = classifyErrorBudget(before, after);
  console.log(`before=${before} after=${after} ratio=${decision.ratio ?? 'n/a'} action=${decision.action}`);

  writeOutput('action', decision.action);
  writeOutput('ratio', decision.ratio === null ? '' : String(decision.ratio));
  writeOutput('previous_sha', decision.action === 'none' ? '' : previousSha ?? '');
}

try {
  main();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
