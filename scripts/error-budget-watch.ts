#!/usr/bin/env tsx
/**
 * Post-deploy error-budget: решение (none/alert/rollback) + issue + вывод
 * для workflow (issue #578).
 *
 *   DEPLOY_SHA=... BEFORE_COUNT=N AFTER_COUNT=N RUN_URL=... \
 *     npx tsx scripts/error-budget-watch.ts
 *
 * Считает before/after передаёт вызывающий (SSH → psql в workflow — здесь
 * только GitHub API + чистое решение classifyErrorBudget). Пишет
 * action/ratio/previous_sha в $GITHUB_OUTPUT — workflow сам решает,
 * слать ли Telegram и диспатчить ли откат.
 */
import { appendFileSync } from 'node:fs';
import { REPO, ghApi } from './lib/gh-api';
import { classifyErrorBudget, errorBudgetIssue, errorBudgetMarker } from './lib/error-budget';

interface WorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}

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

/** Первый success-прогон deploy.yml с head_sha, отличным от текущего деплоя. */
function findPreviousSuccessfulSha(deploySha: string): string | null {
  const runs = ghApi<{ workflow_runs: WorkflowRun[] }>(
    `/repos/${REPO}/actions/workflows/deploy.yml/runs?status=success&per_page=20`,
  ).workflow_runs;
  const sorted = [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const prev = sorted.find((r) => r.head_sha !== deploySha);
  return prev?.head_sha ?? null;
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

  if (decision.action === 'none') {
    writeOutput('previous_sha', '');
    return;
  }

  const previousSha = findPreviousSuccessfulSha(deploySha);
  writeOutput('previous_sha', previousSha ?? '');
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
