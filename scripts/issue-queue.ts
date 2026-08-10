#!/usr/bin/env npx tsx
/**
 * issue-queue — CLI автономной разгрузки бэклога.
 *
 * Очередь:
 *   next                      что брать следующим (JSON)
 *   claim 445                 взять в работу (ready → wip)
 *   release 445 "причина"     вернуть в очередь
 *   park 445 "причина"        PR открыт, но ждёт владельца (wip → review)
 *   reconcile                 снять протухшие локи, прибраться
 *   report                    обновить issue-дашборд
 *
 * Жизненный цикл PR (сессии воркера стартуют без MCP — только Bash):
 *   pr-open 445 claude/issue-445-lockfile    создать черновик с `Closes #445`
 *   pr-wait 463 30                           дождаться CI (минут)
 *   pr-status 463                            текущее состояние чеков
 *   gate 463                                 можно ли авто-мержить
 *   pr-ready 463                             снять черновик
 *   pr-merge 463                             мерж (сам перепроверяет гейт и CI)
 *
 * Аутентификация:
 *   - в GitHub Actions — заголовок Authorization с $GH_TOKEN;
 *   - в сессии Claude Code — заголовок не нужен, исходящий HTTPS идёт через
 *     agent-proxy, который сам подставляет учётку (node fetch прокси игнорирует,
 *     поэтому здесь именно curl, а не fetch).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_CONFIG,
  classifyMergeGate,
  laneOf,
  pickNext,
  priorityOf,
  snapshot,
  staleWipIssues,
  summarizeChecks,
  type CheckRun,
  type QueueConfig,
  type QueueIssue,
} from './lib/issue-queue';

const REPO = process.env.QUEUE_REPO ?? 'aylisrg/Platform-Delovoy';
const API = 'https://api.github.com';
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, '.github/issue-queue.json');
const DASHBOARD_MARKER = '<!-- issue-queue-dashboard -->';
/** Метка в комментарии, по которой считаются брошенные попытки. */
const STALE_MARKER = '<!-- issue-queue-stale-release -->';

function gh<T = unknown>(path: string, method = 'GET', body?: unknown): T {
  const args = ['-sS', '-X', method, '-H', 'Accept: application/vnd.github+json', '-w', '\n%{http_code}'];
  if (process.env.GITHUB_ACTIONS && process.env.GH_TOKEN) {
    args.push('-H', `Authorization: Bearer ${process.env.GH_TOKEN}`);
  }
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  args.push(path.startsWith('http') ? path : `${API}${path}`);

  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const nl = out.lastIndexOf('\n');
  const status = Number(out.slice(nl + 1));
  const text = out.slice(0, nl);
  if (status < 200 || status >= 300) {
    throw new Error(`${method} ${path} → ${status}: ${text.slice(0, 400)}`);
  }
  return (text.trim() ? JSON.parse(text) : null) as T;
}

function loadConfig(): QueueConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
}

// ── Сбор состояния ──────────────────────────────────────────────────────────

interface RawIssue {
  number: number;
  title: string;
  labels: { name: string }[];
  updated_at: string;
  pull_request?: unknown;
  body?: string | null;
}

interface RawPr {
  number: number;
  title: string;
  draft: boolean;
  head: { ref: string };
  body?: string | null;
  html_url: string;
}

function openIssues(): RawIssue[] {
  const out: RawIssue[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<RawIssue[]>(`/repos/${REPO}/issues?state=open&per_page=100&page=${page}`);
    out.push(...batch.filter((i) => !i.pull_request)); // /issues отдаёт и PR-ы тоже
    if (batch.length < 100) break;
  }
  return out;
}

function openPrs(): RawPr[] {
  return gh<RawPr[]>(`/repos/${REPO}/pulls?state=open&per_page=100`);
}

/** Номера issue, которые закрывает данный PR: `Closes #N` в теле или `-N-` в имени ветки. */
function closedIssueNumbers(pr: RawPr): number[] {
  const nums = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
  for (const m of (pr.body ?? '').matchAll(re)) nums.add(Number(m[1]));
  const branch = /^claude\/(?:issue-)?(\d+)\b/.exec(pr.head.ref);
  if (branch) nums.add(Number(branch[1]));
  return [...nums];
}

function collect(): { issues: QueueIssue[]; prs: RawPr[]; linked: Map<number, RawPr> } {
  const prs = openPrs();
  const linked = new Map<number, RawPr>();
  for (const pr of prs) for (const n of closedIssueNumbers(pr)) linked.set(n, pr);

  const issues: QueueIssue[] = openIssues().map((i) => ({
    number: i.number,
    title: i.title,
    labels: i.labels.map((l) => l.name),
    updatedAt: i.updated_at,
    hasOpenPr: linked.has(i.number),
  }));
  return { issues, prs, linked };
}

function setLabels(num: number, labels: string[]): void {
  gh(`/repos/${REPO}/issues/${num}`, 'PATCH', { labels });
}

function comment(num: number, body: string): void {
  gh(`/repos/${REPO}/issues/${num}/comments`, 'POST', {
    body: `${body}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`,
  });
}

function swapLane(labels: string[], to: string | null): string[] {
  const kept = labels.filter((l) => !l.startsWith('auto:'));
  return to ? [...kept, to] : kept;
}

// ── Команды ─────────────────────────────────────────────────────────────────

function cmdNext(): void {
  const config = loadConfig();
  const { issues, linked } = collect();
  const queuePrCount = new Set([...linked.values()].map((p) => p.number)).size;
  const result = pickNext(issues, config, queuePrCount);

  if (!result.issue) {
    console.log(JSON.stringify({ picked: null, reason: result.reason }, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      {
        picked: result.issue.number,
        title: result.issue.title,
        priority: priorityOf(result.issue.labels),
        url: `https://github.com/${REPO}/issues/${result.issue.number}`,
      },
      null,
      2,
    ),
  );
}

function cmdClaim(num: number): void {
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
  const labels = issue.labels.map((l) => l.name);
  if (laneOf(labels) === 'wip') throw new Error(`#${num} уже auto:wip — лок занят`);
  if (laneOf(labels) !== 'ready') throw new Error(`#${num} не в auto:ready (сейчас: ${laneOf(labels)})`);
  setLabels(num, swapLane(labels, 'auto:wip'));
  console.log(`claimed #${num}`);
}

function cmdRelease(num: number, reason: string): void {
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
  setLabels(num, swapLane(issue.labels.map((l) => l.name), 'auto:ready'));
  if (reason) comment(num, `Возвращено в очередь (\`auto:ready\`): ${reason}`);
  console.log(`released #${num}`);
}

/**
 * Задача уезжает в `auto:review`: PR открыт, но гейт не пропустил его в авто-мерж.
 * Живой сессии за ней больше нет, поэтому очередь обязана двигаться дальше.
 */
function cmdPark(num: number, reason: string): void {
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
  setLabels(num, swapLane(issue.labels.map((l) => l.name), 'auto:review'));
  if (reason) comment(num, `PR открыт, но авто-мерж запрещён гейтом: ${reason}\n\nЖдёт решения владельца.`);
  console.log(`parked #${num} → auto:review`);
}

function cmdGate(prNumber: number): void {
  const config = loadConfig();
  const files: { filename: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<{ filename: string }[]>(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const gate = classifyMergeGate(files.map((f) => f.filename), config);
  console.log(JSON.stringify({ pr: prNumber, files: files.length, ...gate }, null, 2));
  if (gate.tier === 'hold') process.exitCode = 3; // отличимо от ошибки сети/скрипта
}

// ── Жизненный цикл PR ───────────────────────────────────────────────────────
//
// Сессии, которые будит Routine, стартуют без MCP-инструментов (mcp__github__*):
// у них есть только Bash. Поэтому весь цикл PR — создание, ожидание CI, мерж —
// живёт здесь и ходит тем же curl через agent-proxy.

/** Чек-раны для head-коммита PR. */
function checksFor(prNumber: number): CheckRun[] {
  const pr = gh<{ head: { sha: string } }>(`/repos/${REPO}/pulls/${prNumber}`);
  const res = gh<{ check_runs: CheckRun[] }>(
    `/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`,
  );
  return res.check_runs;
}

function cmdPrOpen(issueNumber: number, branch: string): void {
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${issueNumber}`);
  const existing = gh<RawPr[]>(`/repos/${REPO}/pulls?state=open&head=${REPO.split('/')[0]}:${branch}`);
  if (existing.length > 0) {
    console.log(JSON.stringify({ pr: existing[0].number, url: existing[0].html_url, created: false }, null, 2));
    return;
  }
  const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/pulls`, 'POST', {
    title: issue.title,
    head: branch,
    base: 'main',
    draft: true,
    body:
      `Closes #${issueNumber}\n\n` +
      `<!-- Тело заполняется воркером: что было сломано, что изменено, как проверено. -->\n\n` +
      `---\n_Generated by [Claude Code](https://claude.ai/code)_`,
  });
  console.log(JSON.stringify({ pr: created.number, url: created.html_url, created: true }, null, 2));
}

/**
 * Снять черновик. REST этого не умеет (draft правится только через GraphQL
 * markPullRequestReadyForReview), а /graphql agent-proxy не пропускает —
 * поэтому в сессии воркера команда честно сообщает, что не смогла.
 */
function cmdPrReady(prNumber: number): void {
  const pr = gh<{ draft: boolean; node_id: string }>(`/repos/${REPO}/pulls/${prNumber}`);
  if (!pr.draft) {
    console.log(JSON.stringify({ pr: prNumber, draft: false, changed: false }, null, 2));
    return;
  }
  const query = {
    query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}',
    variables: { id: pr.node_id },
  };
  try {
    const res = gh<{ errors?: { message: string }[] }>('https://api.github.com/graphql', 'POST', query);
    if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
    console.log(JSON.stringify({ pr: prNumber, draft: false, changed: true }, null, 2));
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          pr: prNumber,
          draft: true,
          changed: false,
          reason: 'не удалось снять draft автоматически',
          detail: String(err).slice(0, 200),
        },
        null,
        2,
      ),
    );
    process.exitCode = 3;
  }
}

function cmdPrStatus(prNumber: number): void {
  const s = summarizeChecks(checksFor(prNumber));
  console.log(
    JSON.stringify(
      {
        pr: prNumber,
        state: s.green ? 'green' : s.done ? 'red' : 'pending',
        pending: s.pending.map((r) => r.name),
        failed: s.failed.map((r) => `${r.name}: ${r.conclusion}`),
      },
      null,
      2,
    ),
  );
  if (s.done && !s.green) process.exitCode = 3;
}

/** Ждёт завершения CI одним вызовом — у воркера нет вебхуков, только опрос. */
function cmdPrWait(prNumber: number, timeoutMin: number): void {
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    const s = summarizeChecks(checksFor(prNumber));
    if (s.done) {
      console.log(
        JSON.stringify(
          { pr: prNumber, state: s.green ? 'green' : 'red', failed: s.failed.map((r) => `${r.name}: ${r.conclusion}`) },
          null,
          2,
        ),
      );
      if (!s.green) process.exitCode = 3;
      return;
    }
    if (Date.now() > deadline) {
      console.log(JSON.stringify({ pr: prNumber, state: 'timeout', pending: s.pending.map((r) => r.name) }, null, 2));
      process.exitCode = 4;
      return;
    }
    execFileSync('sleep', ['30']);
  }
}

/**
 * Последний предохранитель перед прод-деплоем: мержит, только если гейт разрешает
 * И весь CI зелёный. Проверяет сам, а не верит вызывающему.
 */
function cmdPrMerge(prNumber: number): void {
  const config = loadConfig();
  const files: { filename: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<{ filename: string }[]>(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const gate = classifyMergeGate(files.map((f) => f.filename), config);
  if (gate.tier === 'hold') {
    console.log(JSON.stringify({ merged: false, reason: 'gate=hold', reasons: gate.reasons }, null, 2));
    process.exitCode = 3;
    return;
  }

  const s = summarizeChecks(checksFor(prNumber));
  if (!s.green) {
    console.log(
      JSON.stringify(
        { merged: false, reason: s.done ? 'CI красный' : 'CI ещё идёт', failed: s.failed.map((r) => r.name), pending: s.pending.map((r) => r.name) },
        null,
        2,
      ),
    );
    process.exitCode = 3;
    return;
  }

  const pr = gh<{ draft: boolean; title: string }>(`/repos/${REPO}/pulls/${prNumber}`);
  if (pr.draft) {
    console.log(JSON.stringify({ merged: false, reason: 'PR всё ещё черновик — сними draft явно' }, null, 2));
    process.exitCode = 3;
    return;
  }

  try {
    gh(`/repos/${REPO}/pulls/${prNumber}/merge`, 'PUT', {
      merge_method: 'squash',
      commit_title: `${pr.title} (#${prNumber})`,
    });
    console.log(JSON.stringify({ merged: true, pr: prNumber }, null, 2));
  } catch (err) {
    // Обычно это branch protection (нужен ревью) — не наша ошибка, а решение владельца.
    console.log(
      JSON.stringify({ merged: false, reason: 'GitHub отказал в мерже', detail: String(err).slice(0, 300) }, null, 2),
    );
    process.exitCode = 3;
  }
}

function cmdReconcile(): void {
  const config = loadConfig();
  const { issues, linked } = collect();
  const now = new Date();
  let touched = 0;

  for (const issue of staleWipIssues(issues, config, now)) {
    const hours = Math.round((now.getTime() - new Date(issue.updatedAt).getTime()) / 3.6e6);

    // Сколько раз эту задачу уже подбирали и бросали. Считаем по собственным
    // комментариям — отдельное состояние заводить незачем.
    const attempts = gh<{ body: string }[]>(
      `/repos/${REPO}/issues/${issue.number}/comments?per_page=100`,
    ).filter((c) => c.body.includes(STALE_MARKER)).length;

    if (attempts + 1 >= config.maxAttempts) {
      setLabels(issue.number, swapLane(issue.labels, 'auto:blocked'));
      comment(
        issue.number,
        `${STALE_MARKER}\n\nЗадача снята с автоочереди: ${attempts + 1} попытки подряд закончились ` +
          `ничем — сессия воркера каждый раз умирала, не дойдя до PR. Дальше автоматика будет ` +
          `бесконечно ходить по кругу и жечь бюджет, поэтому issue переведена в \`auto:blocked\`.\n\n` +
          `Скорее всего задача сформулирована слишком крупно или упирается в доступ, которого у ` +
          `воркера нет. Разбей её на части либо верни в очередь руками, поменяв лейбл на \`auto:ready\`.`,
      );
      console.log(`gave up on #${issue.number} after ${attempts + 1} attempts → auto:blocked`);
      touched++;
      continue;
    }

    setLabels(issue.number, swapLane(issue.labels, 'auto:ready'));
    comment(
      issue.number,
      `${STALE_MARKER}\n\nЛок \`auto:wip\` снят автоматически: ${hours} ч без обновлений и без ` +
        `открытого PR — сессия воркера, судя по всему, не дожила до PR. Issue вернулась в очередь ` +
        `(попытка ${attempts + 1} из ${config.maxAttempts}).`,
    );
    console.log(`released stale lock #${issue.number} (${hours}h, attempt ${attempts + 1})`);
    touched++;
  }

  // Issue с открытым PR должна быть wip, а не ready — иначе следующий воркер возьмёт её второй раз.
  // `auto:review` не трогаем: там PR намеренно ждёт владельца.
  for (const issue of issues) {
    if (issue.hasOpenPr && laneOf(issue.labels) === 'ready') {
      setLabels(issue.number, swapLane(issue.labels, 'auto:wip'));
      console.log(`marked wip (PR #${linked.get(issue.number)?.number}) #${issue.number}`);
      touched++;
    }
  }

  // Лок с PR, который помечен needs-owner, переезжает в review — иначе один
  // непросмотренный PR уровня hold держит очередь бесконечно.
  for (const issue of issues) {
    if (laneOf(issue.labels) !== 'wip') continue;
    const pr = linked.get(issue.number);
    if (!pr) continue;
    const prLabels = gh<{ labels: { name: string }[] }>(`/repos/${REPO}/issues/${pr.number}`).labels.map(
      (l) => l.name,
    );
    if (prLabels.includes('needs-owner')) {
      setLabels(issue.number, swapLane(issue.labels, 'auto:review'));
      console.log(`moved to review (PR #${pr.number} needs-owner) #${issue.number}`);
      touched++;
    }
  }

  console.log(`reconcile: ${touched} изменений`);
}

function renderDashboard(config: QueueConfig): string {
  const { issues, linked } = collect();
  const queuePrs = [...new Set([...linked.values()].map((p) => p.number))];
  const snap = snapshot(issues, config, queuePrs.length);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const row = (i: QueueIssue) =>
    `| ${priorityOf(i.labels) ?? '—'} | #${i.number} | ${i.title.replace(/\|/g, '\\|').slice(0, 90)} |`;

  const lines: string[] = [
    DASHBOARD_MARKER,
    '# Автоочередь разгрузки бэклога',
    '',
    `_Обновлено ${now} UTC · пересобирается автоматически, править руками бессмысленно._`,
    '',
    `**Состояние:** ${config.enabled ? '🟢 очередь работает' : '🔴 очередь выключена'} · ` +
      `авто-мерж ${config.autoMerge ? 'включён' : 'выключен'} · ` +
      `лимит открытых PR ${config.maxOpenPrs}`,
    '',
    `Рубильник — \`.github/issue-queue.json\`. Как всё устроено — ADR \`docs/architecture/2026-08-10-autonomous-issue-cleanup-adr.md\`.`,
    '',
    '## Что дальше',
    '',
    snap.next.issue
      ? `Следующей в работу уйдёт **#${snap.next.issue.number}** — ${snap.next.issue.title}`
      : `Ничего не берётся: ${snap.next.reason}`,
    '',
    `## В работе (${snap.byLane.wip.length})`,
    '',
    snap.byLane.wip.length
      ? ['| Приоритет | Issue | Заголовок |', '|---|---|---|', ...snap.byLane.wip.map(row)].join('\n')
      : '_Пусто._',
    '',
    `## Очередь (${snap.ordered.length})`,
    '',
    snap.ordered.length
      ? ['| Приоритет | Issue | Заголовок |', '|---|---|---|', ...snap.ordered.slice(0, 30).map(row)].join('\n')
      : '_Пусто — бэклог разобран._',
    '',
    `## Ждут владельца (${snap.byLane.blocked.length + snap.byLane['prod-apply'].length + snap.byLane.review.length})`,
    '',
    'Единственное, что воркер физически не может сделать сам.',
    '',
    ...(snap.byLane.review.length
      ? ['**PR открыт, гейт не пропустил в авто-мерж (`auto:review`):**', '', ...snap.byLane.review.map((i) => `- #${i.number} — ${i.title}`), '']
      : []),
    ...(snap.byLane.blocked.length
      ? ['**Нет доступов (`auto:blocked`):**', '', ...snap.byLane.blocked.map((i) => `- #${i.number} — ${i.title}`), '']
      : []),
    ...(snap.byLane['prod-apply'].length
      ? ['**Код готов, apply трогает прод (`auto:prod-apply`):**', '', ...snap.byLane['prod-apply'].map((i) => `- #${i.number} — ${i.title}`), '']
      : []),
    `## Открытые PR очереди (${queuePrs.length})`,
    '',
    queuePrs.length
      ? [...linked.values()]
          .filter((p, idx, arr) => arr.findIndex((q) => q.number === p.number) === idx)
          .map((p) => `- ${p.draft ? '📝 draft' : '✅ ready'} #${p.number} — ${p.title}`)
          .join('\n')
      : '_Нет._',
    '',
  ];
  return lines.join('\n');
}

function cmdReport(): void {
  const config = loadConfig();
  const body = renderDashboard(config);

  // Namely /repos/... , не /search/issues: agent-proxy сессий Claude Code пропускает
  // только repo-scoped пути, а этот CLI обязан работать одинаково и в Actions, и в сессии.
  const found = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent('auto:dashboard')}&per_page=10`,
  ).filter((i) => !i.pull_request);

  if (found.length > 0) {
    const num = found[0].number;
    gh(`/repos/${REPO}/issues/${num}`, 'PATCH', { body });
    console.log(`dashboard updated: #${num}`);
  } else {
    const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', {
      title: '📋 Автоочередь разгрузки бэклога — состояние',
      body,
      labels: ['auto:dashboard'],
    });
    console.log(`dashboard created: #${created.number} ${created.html_url}`);
  }
}

// ── Точка входа ─────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'next': cmdNext(); break;
    case 'claim': cmdClaim(Number(rest[0])); break;
    case 'release': cmdRelease(Number(rest[0]), rest.slice(1).join(' ')); break;
    case 'park': cmdPark(Number(rest[0]), rest.slice(1).join(' ')); break;
    case 'gate': cmdGate(Number(rest[0])); break;
    case 'reconcile': cmdReconcile(); break;
    case 'report': cmdReport(); break;
    case 'pr-open': cmdPrOpen(Number(rest[0]), rest[1]); break;
    case 'pr-ready': cmdPrReady(Number(rest[0])); break;
    case 'pr-status': cmdPrStatus(Number(rest[0])); break;
    case 'pr-wait': cmdPrWait(Number(rest[0]), Number(rest[1] ?? 30)); break;
    case 'pr-merge': cmdPrMerge(Number(rest[0])); break;
    default:
      console.error(
        'usage: issue-queue.ts <next|claim|release|park|gate|reconcile|report|pr-open|pr-ready|pr-status|pr-wait|pr-merge> [args]',
      );
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
