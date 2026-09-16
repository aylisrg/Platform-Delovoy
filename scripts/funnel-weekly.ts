#!/usr/bin/env npx tsx
/**
 * funnel-weekly — CLI недельного отчёта по воронке (US-2 эпика #583,
 * ADR `docs/adr/2026-09-16-weekly-product-analyst-loop.md`).
 *
 * Программа сессии — `.claude/commands/weekly-funnel.md`; здесь только
 * механика. Граница ADR §3: все числа считает код (`src/modules/analytics/
 * weekly-report.ts`), агент дописывает прозу и вызывает эти команды.
 *
 *   stats      [--out f.json] [--no-dispatch] [--timeout-min 12]
 *              агрегаты прода из repo variable FUNNEL_WEEKLY_STATS; протухли —
 *              дёргает analytics-funnel-export.yml и ждёт. exit 4 — не доехали.
 *   build      --stats-file f.json [--report-date YYYY-MM-DD]
 *              отчёт + сайдкар в docs/analytics/. exit 3 — отчёт за этот период
 *              уже есть (идемпотентность повторного прогона Routine).
 *   hypothesis --report-date D --funnel f --step s --title "…" --body-file f.md
 *              issue-гипотеза с baseline из сайдкара. exit 5 — данных мало,
 *              exit 6 — PII в прозе, exit 7 — гипотез уже три.
 *   pr         --branch b --report-date D
 *              PR с отчётом (ветка claude/** — домержит свипер, если сессия умрёт).
 *
 * GitHub API — общий scripts/lib/gh-api.ts (curl через agent-proxy или $GH_TOKEN).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_HYPOTHESES_PER_WEEK,
  appendHypothesisToMarkdown,
  buildHypothesisIssueBody,
  buildWeeklyFunnelReport,
  findPii,
  formatHypothesisBaseline,
  isStatsExportFresh,
  parseHypothesisProse,
  parseWeeklySidecar,
  parseWeeklyStatsExport,
  reportPathFor,
  sidecarPathFor,
  statsForPeriod,
  type WeeklyStatsExport,
} from '../src/modules/analytics/weekly-report';
import type { WeeklyFunnelSidecar } from '../src/modules/analytics/types';
import {
  groupReleasesByDay,
  mskDate,
  parseDate,
  parseFlags,
  parseFunnel,
  parseStep,
  requireString,
  type Flags,
  type MergedPr,
} from './lib/funnel-weekly';
import { REPO, ghApi } from './lib/gh-api';

const ROOT = resolve(__dirname, '..');
const ANALYTICS_DIR = join(ROOT, 'docs/analytics');
const STATS_VARIABLE = 'FUNNEL_WEEKLY_STATS';
const EXPORT_WORKFLOW = 'analytics-funnel-export.yml';
const POLL_INTERVAL_SEC = 30;

/** Коды выхода — контракт с промптом сессии, а не украшение. */
const EXIT = {
  REPORT_EXISTS: 3,
  STATS_UNAVAILABLE: 4,
  INSUFFICIENT_DATA: 5,
  PII_FOUND: 6,
  TOO_MANY_HYPOTHESES: 7,
} as const;

// ── Общие помощники ─────────────────────────────────────────────────────────

function fail(message: string, code: number): never {
  console.error(`❌ ${message}`);
  process.exit(code);
}

function readSidecar(reportDate: string): { path: string; sidecar: WeeklyFunnelSidecar } {
  const path = join(ROOT, sidecarPathFor(reportDate));
  if (!existsSync(path)) throw new Error(`нет сайдкара ${sidecarPathFor(reportDate)} — сначала build`);
  const sidecar = parseWeeklySidecar(JSON.parse(readFileSync(path, 'utf8')));
  if (!sidecar) throw new Error(`сайдкар ${sidecarPathFor(reportDate)} не проходит схему — отчёт собран не этим кодом`);
  return { path, sidecar };
}

/** Все сайдкары репозитория — по ним решается идемпотентность build. */
function existingSidecars(): { file: string; sidecar: WeeklyFunnelSidecar }[] {
  if (!existsSync(ANALYTICS_DIR)) return [];
  const out: { file: string; sidecar: WeeklyFunnelSidecar }[] = [];
  for (const file of readdirSync(ANALYTICS_DIR).filter((f) => f.endsWith('-funnel-weekly.json'))) {
    try {
      const sidecar = parseWeeklySidecar(JSON.parse(readFileSync(join(ANALYTICS_DIR, file), 'utf8')));
      if (sidecar) out.push({ file, sidecar });
    } catch {
      // Битый файл — не отчёт: идемпотентность на него не опирается.
    }
  }
  return out;
}

// ── stats ───────────────────────────────────────────────────────────────────

function readStatsVariable(): WeeklyStatsExport | null {
  try {
    const variable = ghApi<{ value: string }>(`/repos/${REPO}/actions/variables/${STATS_VARIABLE}`);
    return parseWeeklyStatsExport(JSON.parse(variable.value));
  } catch {
    return null;
  }
}

function dispatchExport(): void {
  ghApi(`/repos/${REPO}/actions/workflows/${EXPORT_WORKFLOW}/dispatches`, 'POST', { ref: 'main' });
}

function cmdStats(flags: Flags): void {
  const out = typeof flags.out === 'string' ? flags.out : '/tmp/funnel-stats.json';
  const timeoutMin = typeof flags['timeout-min'] === 'string' ? Number(flags['timeout-min']) : 12;
  const now = new Date();

  let stats = readStatsVariable();
  const fresh = stats !== null && isStatsExportFresh(stats.generatedAt, now);

  if (!fresh && flags['no-dispatch'] !== true) {
    // Переменной нет или она от прошлой недели: экспорт мог не отработать по
    // крону (падение SSH, выключенный раннер). Дёргаем руками и ждём — молчать
    // здесь нельзя, иначе отчёт построится на протухших данных.
    console.error(`агрегаты ${stats ? 'протухли' : 'не найдены'} — дёргаю ${EXPORT_WORKFLOW}`);
    try {
      dispatchExport();
    } catch (err) {
      fail(`не удалось запустить ${EXPORT_WORKFLOW}: ${err instanceof Error ? err.message : String(err)}`, EXIT.STATS_UNAVAILABLE);
    }
    const deadline = Date.now() + timeoutMin * 60_000;
    while (Date.now() < deadline) {
      execFileSync('sleep', [String(POLL_INTERVAL_SEC)]);
      const next = readStatsVariable();
      if (next && isStatsExportFresh(next.generatedAt, new Date())) {
        stats = next;
        break;
      }
      stats = next ?? stats;
    }
  }

  if (!stats || !isStatsExportFresh(stats.generatedAt, new Date())) {
    fail(
      `агрегаты воронки недоступны (repo variable ${STATS_VARIABLE} пуста или протухла) — ` +
        'отчёт за неделю не строим, заводи задачу очереди',
      EXIT.STATS_UNAVAILABLE,
    );
  }

  writeFileSync(out, `${JSON.stringify(stats, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { path: out, generatedAt: stats.generatedAt, periods: stats.periods, rows: stats.rows.length },
      null,
      2,
    ),
  );
}

// ── build ───────────────────────────────────────────────────────────────────

/** Merged PR отчётной недели — сверка динамики с выкатками (AC-2.2). */
function releasesForPeriod(period: { dateFrom: string; dateTo: string }): {
  date: string;
  prs: { number: number; title: string }[];
}[] {
  const merged: MergedPr[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = ghApi<MergedPr[]>(
      `/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    merged.push(...batch);
    if (batch.length < 100) break;
  }
  return groupReleasesByDay(merged, period);
}

function cmdBuild(flags: Flags): void {
  const statsFile = requireString(flags, 'stats-file');
  const reportDate = typeof flags['report-date'] === 'string'
    ? parseDate(flags['report-date'], 'report-date')
    : mskDate(new Date());

  let parsedStats: WeeklyStatsExport | null = null;
  try {
    parsedStats = parseWeeklyStatsExport(JSON.parse(readFileSync(statsFile, 'utf8')));
  } catch {
    parsedStats = null;
  }
  if (!parsedStats) fail(`${statsFile} не читается как агрегаты воронки — прогони stats заново`, EXIT.STATS_UNAVAILABLE);
  const stats = parsedStats;

  // Идемпотентность (ADR §8): повторный Routine, ретрай, ручной вызов — второго
  // отчёта и второго комплекта гипотез за тот же период не появляется.
  const duplicate = existingSidecars().find((s) => s.sidecar.period.dateFrom === stats.periods.current.dateFrom);
  if (duplicate) {
    console.log(
      JSON.stringify(
        { skipped: true, reason: 'отчёт за этот период уже есть', reportPath: duplicate.sidecar.reportPath },
        null,
        2,
      ),
    );
    process.exit(EXIT.REPORT_EXISTS);
  }

  const { markdown, sidecar } = buildWeeklyFunnelReport({
    current: statsForPeriod(stats.rows, stats.periods.current),
    previous: statsForPeriod(stats.rows, stats.periods.previous),
    reportDate,
    publishedAt: new Date().toISOString(),
    releases: releasesForPeriod(stats.periods.current),
  });

  mkdirSync(ANALYTICS_DIR, { recursive: true });
  writeFileSync(join(ROOT, reportPathFor(reportDate)), markdown);
  writeFileSync(join(ROOT, sidecarPathFor(reportDate)), `${JSON.stringify(sidecar, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        reportPath: reportPathFor(reportDate),
        sidecarPath: sidecarPathFor(reportDate),
        period: sidecar.period,
        insufficientData: sidecar.insufficientData,
        funnels: sidecar.funnels.map((f) => ({
          funnel: f.funnel,
          topSessions: f.topSessions,
          insufficientData: f.insufficientData,
          biggestDropStep: f.biggestDropStep,
        })),
      },
      null,
      2,
    ),
  );
}

// ── hypothesis ──────────────────────────────────────────────────────────────

const HYPOTHESIS_LABELS = ['auto:hypothesis', 'from-analytics'];

/** Лейблы гипотез создаются идемпотентно — как `gh label create … || true` в интейке. */
function ensureLabels(): void {
  const wanted = [
    { name: 'auto:hypothesis', color: 'D4C5F9', description: 'Гипотеза недельного аналитика — ждёт решения владельца' },
    { name: 'from-analytics', color: 'BFDADC', description: 'Заведена недельным отчётом по воронке' },
  ];
  for (const label of wanted) {
    try {
      ghApi(`/repos/${REPO}/labels`, 'POST', label);
    } catch {
      // 422 «already_exists» — штатный путь при каждом следующем прогоне.
    }
  }
}

/** Issue заводится общей командой очереди — дедуп и маркеры живут там. */
function createHypothesisIssue(title: string, body: string, dedupKey: string): { issue: number; url: string; deduped: boolean } {
  const bodyFile = join('/tmp', `funnel-hypothesis-${dedupKey}.md`);
  writeFileSync(bodyFile, body);
  const args = [
    'tsx',
    join(ROOT, 'scripts/issue-queue.ts'),
    'create',
    '--title', title,
    '--body-file', bodyFile,
    '--dedup-key', dedupKey,
    ...HYPOTHESIS_LABELS.flatMap((l) => ['--label', l]),
  ];
  try {
    const out = execFileSync('npx', args, { encoding: 'utf8', cwd: ROOT });
    return JSON.parse(out) as { issue: number; url: string; deduped: boolean };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    // exit 3 у `create` — дубль: гипотеза за этот период уже заведена.
    if (e.status === 3 && e.stdout) return JSON.parse(e.stdout) as { issue: number; url: string; deduped: boolean };
    throw err;
  }
}

function cmdHypothesis(flags: Flags): void {
  const reportDate = parseDate(requireString(flags, 'report-date'), 'report-date');
  const funnel = parseFunnel(requireString(flags, 'funnel'));
  const step = parseStep(funnel, requireString(flags, 'step'));
  const title = requireString(flags, 'title');
  const bodyFile = requireString(flags, 'body-file');

  const { path: sidecarPath, sidecar } = readSidecar(reportDate);
  const summary = sidecar.funnels.find((f) => f.funnel === funnel);
  if (!summary) throw new Error(`воронки ${funnel} нет в отчёте ${reportDate}`);

  // AC-2.5: на шуме гипотез не формулируем — ни по всему отчёту, ни по воронке.
  if (sidecar.insufficientData || summary.insufficientData) {
    fail(
      `данных по воронке ${funnel} за неделю недостаточно (${summary.topSessions} сессий на входе) — ` +
        'гипотеза не регистрируется',
      EXIT.INSUFFICIENT_DATA,
    );
  }
  // AC-2.3: больше трёх гипотез за неделю — это уже не приоритеты, а список дел.
  if (sidecar.hypotheses.length >= MAX_HYPOTHESES_PER_WEEK) {
    fail(`за неделю уже зарегистрировано ${sidecar.hypotheses.length} гипотез — больше ${MAX_HYPOTHESES_PER_WEEK} не берём`, EXIT.TOO_MANY_HYPOTHESES);
  }

  const prose = readFileSync(bodyFile, 'utf8');
  // AC-2.6: числа отчёта персональными быть не могут по типу, проза агента — может.
  const pii = findPii(`${title}\n${prose}`);
  if (pii) fail(`в тексте гипотезы найдены персональные данные (${pii}) — issue не создаю`, EXIT.PII_FOUND);

  const parsed = parseHypothesisProse(prose);
  if (!parsed) {
    throw new Error(
      `${bodyFile}: нужны секции «### Что предлагается изменить» и «### Ожидаемый результат и почему»`,
    );
  }

  const baseline = {
    period: sidecar.period,
    topSessions: summary.topSessions,
    endToEndConversion: summary.endToEndConversion,
    endToEndDeltaPp: summary.endToEndDeltaPp,
    stepConversion: summary.biggestDropStep === step ? summary.biggestDropConversion : null,
    reportPath: sidecar.reportPath,
  };
  const body = buildHypothesisIssueBody({ reportDate, funnel, step, ...parsed, baseline });

  ensureLabels();
  const created = createHypothesisIssue(title, body, `funnel-hyp-${reportDate}-${funnel}-${step}`);
  if (created.deduped) {
    console.log(JSON.stringify({ ...created, note: 'гипотеза по этому шагу за эту неделю уже заведена' }, null, 2));
    process.exit(EXIT.REPORT_EXISTS);
  }

  const ref = {
    issue: created.issue,
    title,
    funnel,
    step,
    baseline: formatHypothesisBaseline(funnel, step, baseline),
  };
  sidecar.hypotheses.push(ref);
  writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

  const reportPath = join(ROOT, sidecar.reportPath);
  writeFileSync(reportPath, appendHypothesisToMarkdown(readFileSync(reportPath, 'utf8'), ref));

  console.log(JSON.stringify({ ...created, funnel, step, baseline: ref.baseline }, null, 2));
}

// ── pr ──────────────────────────────────────────────────────────────────────

function cmdPr(flags: Flags): void {
  const branch = requireString(flags, 'branch');
  const reportDate = parseDate(requireString(flags, 'report-date'), 'report-date');
  const { sidecar } = readSidecar(reportDate);

  const owner = REPO.split('/')[0];
  const existing = ghApi<{ number: number; html_url: string }[]>(
    `/repos/${REPO}/pulls?state=open&head=${owner}:${branch}`,
  );
  if (existing.length > 0) {
    console.log(JSON.stringify({ pr: existing[0].number, url: existing[0].html_url, created: false }, null, 2));
    return;
  }

  const period = `${sidecar.period.dateFrom} … ${sidecar.period.dateTo}`;
  const body = [
    `Недельный отчёт по воронке за ${period} (US-2 эпика #583).`,
    '',
    `- Отчёт: \`${sidecar.reportPath}\``,
    `- Сайдкар для вечерней сводки: \`${sidecarPathFor(reportDate)}\``,
    sidecar.insufficientData
      ? '- Данных за неделю недостаточно — интерпретации и гипотез в отчёте нет (AC-2.5).'
      : `- Гипотез зарегистрировано: ${sidecar.hypotheses.length} (в работу сами не уходят — ждут владельца).`,
    ...sidecar.hypotheses.map((h) => `  - #${h.issue} — ${h.title}`),
    '',
    'Числа считает `buildWeeklyFunnelReport` (тесты в',
    '`src/modules/analytics/__tests__/weekly-report.test.ts`), проза — product-analyst.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

  const created = ghApi<{ number: number; html_url: string }>(`/repos/${REPO}/pulls`, 'POST', {
    title: `docs(analytics): недельный отчёт по воронке ${sidecar.period.dateFrom}…${sidecar.period.dateTo}`,
    head: branch,
    base: 'main',
    body,
  });
  console.log(JSON.stringify({ pr: created.number, url: created.html_url, created: true }, null, 2));
}

// ── Точка входа ─────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
try {
  const flags = cmd ? parseFlags(rest) : {};
  switch (cmd) {
    case 'stats': cmdStats(flags); break;
    case 'build': cmdBuild(flags); break;
    case 'hypothesis': cmdHypothesis(flags); break;
    case 'pr': cmdPr(flags); break;
    default:
      console.error('usage: funnel-weekly.ts <stats|build|hypothesis|pr> [--flag value]');
      process.exitCode = 2;
  }
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
