#!/usr/bin/env tsx
/**
 * Post-deploy error-budget: решение (none/alert/rollback) + issue + вывод
 * для workflow (issue #578).
 *
 *   DEPLOY_SHA=... PREVIOUS_SHA=... BEFORE_COUNT=N AFTER_COUNT=N RUN_URL=... \
 *     npx tsx scripts/error-budget-watch.ts
 *
 * DEPLOY_SHA/PREVIOUS_SHA передаёт workflow — САМ deploy.yml пишет их в repo
 * variables DEPLOYED_SHA_CURRENT/PREVIOUS сразу после успешного деплоя, а не
 * этот скрипт вычисляет их из github.event.workflow_run.head_sha: у
 * workflow_dispatch head_sha — это то, чем был ref (main) на момент диспатча,
 * а не значение inputs.sha, поэтому для hotfix/rollback-редеплоя (именно то,
 * что делает наш собственный авто-откат) head_sha врёт про реально
 * задеплоенный коммит. PREVIOUS_SHA пуст на самом первом деплое после
 * появления этого механизма — тогда откатывать не на что (см. workflow).
 *
 * Считает before/after передаёт вызывающий (SSH → psql в workflow — здесь
 * только GitHub API + чистое решение classifyErrorBudget). Пишет
 * action/ratio в $GITHUB_OUTPUT — workflow сам решает, слать ли Telegram и
 * диспатчить ли откат.
 */
import { appendFileSync } from 'node:fs';
import { REPO, ghApi } from './lib/gh-api';
import { classifyErrorBudget, errorBudgetIssue, errorBudgetMarker } from './lib/error-budget';

interface CompareCommit {
  sha: string;
  html_url: string;
  commit: { message: string };
}

interface RawIssue {
  body: string | null;
  pull_request?: unknown;
}

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

function fetchCommits(previousSha: string | null, deploySha: string): Array<{ sha: string; message: string; url: string }> {
  if (!previousSha) return [];
  try {
    const cmp = ghApi<{ commits: CompareCommit[] }>(`/repos/${REPO}/compare/${previousSha}...${deploySha}`);
    return cmp.commits.map((c) => ({ sha: c.sha, message: c.commit.message, url: c.html_url }));
  } catch (err) {
    console.error('Не удалось получить diff коммитов:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

function loadExistingBodies(): string[] {
  const bodies: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = ghApi<RawIssue[]>(
      `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent('auto-detected')}&per_page=100&page=${page}`,
    );
    bodies.push(...batch.filter((i) => !i.pull_request).map((i) => i.body ?? ''));
    if (batch.length < 100) break;
  }
  return bodies;
}

function main(): void {
  const deploySha = requiredEnv('DEPLOY_SHA');
  const previousSha = process.env.PREVIOUS_SHA?.trim() || null;
  const before = Number(requiredEnv('BEFORE_COUNT'));
  const after = Number(requiredEnv('AFTER_COUNT'));
  const runUrl = requiredEnv('RUN_URL');

  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) {
    throw new Error(`Некорректные счётчики: before=${process.env.BEFORE_COUNT} after=${process.env.AFTER_COUNT}`);
  }

  const decision = classifyErrorBudget(before, after);
  console.log(`before=${before} after=${after} ratio=${decision.ratio ?? 'n/a'} action=${decision.action}`);

  writeOutput('action', decision.action);
  writeOutput('ratio', decision.ratio === null ? '' : String(decision.ratio));
  writeOutput('previous_sha', decision.action === 'none' ? '' : previousSha ?? '');

  if (decision.action === 'none') {
    return;
  }

  const commits = fetchCommits(previousSha, deploySha);

  const issue = errorBudgetIssue({
    action: decision.action,
    before,
    after,
    ratio: decision.ratio,
    deploySha,
    previousSha,
    commits,
    runUrl,
  });
  const marker = errorBudgetMarker(deploySha);

  if (loadExistingBodies().some((b) => b.includes(marker))) {
    console.log(`Issue уже существует (${marker}), пропускаю создание`);
    return;
  }

  const res = ghApi<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', issue);
  console.log(`Создан issue: ${res.html_url}`);
}

try {
  main();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
