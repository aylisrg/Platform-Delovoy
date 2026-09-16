#!/usr/bin/env tsx
/**
 * Сборщик вечернего дайджеста владельцу (workflow owner-digest.yml, 21:00 МСК).
 *
 *   npx tsx scripts/owner-digest.ts [--feedback-file feedback.json]
 *
 * Собирает: merged PR за 24ч + текущий DEPLOYED_SHA_CURRENT (repo variable —
 * честная метка «что на проде», GitHub Releases не годятся: трейн выкатывает
 * и между ночными релизами), дельту бэклога, ждущие решения с сайта
 * (OWNER_DECISIONS_SECRET; сайт лежит — секция опускается), счётчики фидбека
 * из файла (SSH-шаг workflow; нет файла — секция опускается).
 *
 * Вывод — JSON {textHtml} в stdout; Telegram-отправка — отдельным шагом
 * workflow (секреты в CLI не попадают — тот же паттерн, что heartbeat).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WeeklyFunnelDigest } from '../src/modules/analytics/types';
import { isFreshSidecar, parseWeeklySidecar, toDigestSummary } from '../src/modules/analytics/weekly-report';
import { REPO, ghApi } from './lib/gh-api';
import { buildOwnerDigest, type DigestDecision, type DigestPr } from './lib/owner-digest';

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_DIR = resolve(__dirname, '..', 'docs/analytics');

function mergedPrsLast24h(now: Date): DigestPr[] {
  const cutoff = now.getTime() - DAY_MS;
  const prs = ghApi<{ number: number; title: string; merged_at: string | null }[]>(
    `/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
  );
  return prs
    .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= cutoff)
    .map((p) => ({ number: p.number, title: p.title }));
}

function backlogCounts(now: Date): { totalOpen: number; opened24h: number; closed24h: number } {
  const cutoff = now.getTime() - DAY_MS;

  let totalOpen = 0;
  for (let page = 1; page <= 10; page++) {
    const batch = ghApi<{ pull_request?: unknown }[]>(
      `/repos/${REPO}/issues?state=open&per_page=100&page=${page}`,
    );
    totalOpen += batch.filter((i) => !i.pull_request).length;
    if (batch.length < 100) break;
  }

  const since = new Date(cutoff).toISOString();
  let opened24h = 0;
  let closed24h = 0;
  for (let page = 1; page <= 3; page++) {
    const batch = ghApi<{ pull_request?: unknown; created_at: string; closed_at: string | null }[]>(
      `/repos/${REPO}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
    );
    for (const i of batch) {
      if (i.pull_request) continue;
      if (new Date(i.created_at).getTime() >= cutoff) opened24h++;
      if (i.closed_at && new Date(i.closed_at).getTime() >= cutoff) closed24h++;
    }
    if (batch.length < 100) break;
  }
  return { totalOpen, opened24h, closed24h };
}

function deployedShaShort(): string | null {
  try {
    const v = ghApi<{ value: string }>(`/repos/${REPO}/actions/variables/DEPLOYED_SHA_CURRENT`);
    return v.value ? v.value.slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** Ждущие решения с сайта. Свой curl (не ghApi — GH_TOKEN сайту не показываем). */
function pendingDecisions(now: Date): DigestDecision[] {
  const secret = process.env.OWNER_DECISIONS_SECRET;
  const base = process.env.OWNER_DECISIONS_URL ?? 'https://delovoy-park.ru';
  if (!secret) return [];
  try {
    const out = execFileSync(
      'curl',
      [
        '-sS', '--max-time', '20',
        '-H', `Authorization: Bearer ${secret}`,
        '-H', 'Accept: application/json',
        '-w', '\n%{http_code}',
        `${base}/api/admin/owner-decisions?status=pending`,
      ],
      { encoding: 'utf8' },
    );
    const nl = out.lastIndexOf('\n');
    if (Number(out.slice(nl + 1)) !== 200) return [];
    const parsed = JSON.parse(out.slice(0, nl)) as {
      success?: boolean;
      data?: { title: string; kind: string; status: string; createdAt: string }[];
    };
    return (parsed.data ?? []).map((d) => ({
      title: d.title,
      kind: d.kind,
      status: d.status,
      ageHours: (now.getTime() - new Date(d.createdAt).getTime()) / 3.6e6,
    }));
  } catch {
    return [];
  }
}

/** Момент, когда файл доехал в ветку. null — истории нет (мелкий checkout, локальный прогон). */
function gitCommittedAt(path: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', path], { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Свежий недельный отчёт по воронке (US-3, ADR 2026-09-16 §7): сайдкар с
 * максимальным именем в `docs/analytics/`, доехавший в main за последние сутки.
 * Любая неурядица (нет папки, битый JSON, чужая схема, нет git) — `null`:
 * дайджест едет без блока, но едет.
 */
function weeklyFunnel(now: Date): WeeklyFunnelDigest | null {
  try {
    const latest = readdirSync(ANALYTICS_DIR)
      .filter((f) => f.endsWith('-funnel-weekly.json'))
      .sort()
      .at(-1);
    if (!latest) return null;
    const path = join(ANALYTICS_DIR, latest);
    const sidecar = parseWeeklySidecar(JSON.parse(readFileSync(path, 'utf8')));
    if (!sidecar) return null;
    const landedAt = gitCommittedAt(path);
    if (!isFreshSidecar({ landedAt, publishedAt: sidecar.publishedAt, now })) return null;
    return toDigestSummary(sidecar);
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fbIdx = args.indexOf('--feedback-file');
  const feedbackFile = fbIdx !== -1 ? args[fbIdx + 1] : '';
  const now = new Date();

  let feedback: { bugs: number; suggestions: number } | null = null;
  if (feedbackFile && existsSync(feedbackFile)) {
    try {
      const parsed = JSON.parse(readFileSync(feedbackFile, 'utf8')) as { bugs?: number; suggestions?: number };
      feedback = { bugs: Number(parsed.bugs ?? 0), suggestions: Number(parsed.suggestions ?? 0) };
    } catch {
      feedback = null;
    }
  }

  const textHtml = buildOwnerDigest({
    deployedShaShort: deployedShaShort(),
    mergedPrs: mergedPrsLast24h(now),
    backlog: backlogCounts(now),
    decisions: pendingDecisions(now),
    feedback,
    weeklyFunnel: weeklyFunnel(now),
  });

  console.log(JSON.stringify({ textHtml }, null, 2));
}

try {
  main();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
