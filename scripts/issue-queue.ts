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
 *   heartbeat [--dry-run]     алерт «очередь стоит» (JSON; дедуп на дашборде)
 *   ops-watch [--dry-run]     живость AUTOMATION_TOKEN + дайджест needs-owner (JSON)
 *
 * Триаж и планирование:
 *   untriaged                                issues без auto:* — входящие для триажа (JSON)
 *   triage 480 P1 ready                      назначить prio + auto:ready|epic
 *   create --title "..." --body-file f.md    завести issue [--prio P2] [--ready|--epic]
 *                                            [--label X ...] [--parent N]
 *   epics                                    открытые эпики и разобраны ли они (JSON)
 *
 * Жизненный цикл PR (в сессии без MCP хватает Bash):
 *   pr-open 445 claude/issue-445-lockfile    создать PR с `Closes #445`
 *                                            (--refs — «Эпик: #N» вместо Closes, --draft — черновиком)
 *   pr-wait 463 30                           дождаться CI (минут)
 *   pr-status 463                            текущее состояние чеков
 *   gate 463                                 можно ли авто-мержить
 *   pr-ready 463                             снять черновик (GraphQL; в сессии воркера недоступен)
 *   pr-merge 463                             мерж (сам перепроверяет гейт и CI)
 *   automerge [--dry-run]                    крон: домержить все готовые PR очереди
 *   metric 463 branch outcome ciRounds reviewRounds durationMin
 *                                            телеметрия прогона в docs/pipeline-runs/next-issue.metrics.jsonl
 *
 * HTTP-путь к GitHub — scripts/lib/gh-api.ts (curl: в Actions с $GH_TOKEN,
 * в сессии Claude Code через agent-proxy).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO, ghApi as gh } from './lib/gh-api';
import {
  DEFAULT_CONFIG,
  DRAFT_STUCK_MARKER,
  EPIC_PLANNED_MARKER,
  GIVEUP_MARKER,
  HEARTBEAT_MARKER,
  MISSED_AUTOCLOSE_MARKER,
  QUEUE_BRANCH_RE,
  STALE_MARKER,
  STALE_PR_MARKER,
  autoMergeSkipReason,
  classifyMergeGate,
  countAttempts,
  countBackpressurePrs,
  laneOf,
  missedAutoCloseIssues,
  pickNext,
  priorityOf,
  shouldHeartbeat,
  snapshot,
  staleWipIssues,
  staleWipWithPr,
  summarizeChecks,
  untriagedIssues,
  type ChangedFile,
  type CheckRun,
  type Lane,
  type MergedPrClosing,
  type PrLink,
  type QueueConfig,
  type QueueIssue,
} from './lib/issue-queue';
import {
  NEEDS_OWNER_DIGEST_MARKER,
  TOKEN_ROTATION_MARKER,
  buildNeedsOwnerDigest,
  isTokenDead,
  shouldRemindRotation,
  type NeedsOwnerPr,
} from './lib/queue-watch';

const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, '.github/issue-queue.json');
const DASHBOARD_MARKER = '<!-- issue-queue-dashboard -->';

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
  state?: string;
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
  updated_at: string;
  merged_at?: string | null;
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
  const out: RawPr[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<RawPr[]>(`/repos/${REPO}/pulls?state=open&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Недавно смерженные PR-ы (для missedAutoCloseIssues, issue #616). Окно —
 * 2 страницы по `updated` desc (≤200 PR), не время: reconcile идёт по
 * расписанию (issue-queue.yml, ежечасно) — этого с запасом хватает на
 * пропущенный час, даже в активный день.
 */
function recentlyMergedPrs(): RawPr[] {
  const out: RawPr[] = [];
  for (let page = 1; page <= 2; page++) {
    const batch = gh<RawPr[]>(
      `/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.filter((pr) => !!pr.merged_at);
}

function allComments(num: number): { body: string; created_at: string }[] {
  const out: { body: string; created_at: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<{ body: string; created_at: string }[]>(
      `/repos/${REPO}/issues/${num}/comments?per_page=100&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Момент, когда на issue/PR реально появился лейбл `needs-owner` — берём
 * последнее событие `labeled` с этим именем, а не `updated_at` PR (который
 * сдвигает любой посторонний коммент/пуш и тем самым прячет по-настоящему
 * старый needs-owner из дайджеста). Событий не нашлось (редкий краевой
 * случай — GitHub иногда не отдаёт историю за давностью) → null, вызывающий
 * код падает на `updated_at` как на приближение.
 */
function needsOwnerLabeledAt(num: number): string | null {
  const events = gh<{ event: string; label?: { name: string }; created_at: string }[]>(
    `/repos/${REPO}/issues/${num}/events?per_page=100`,
  );
  const labeled = events.filter((e) => e.event === 'labeled' && e.label?.name === 'needs-owner');
  return labeled.length > 0 ? labeled[labeled.length - 1].created_at : null;
}

/** `GET /user` с явным токеном (не $GH_TOKEN сессии/Actions) — код ответа, не парсим тело. */
function checkTokenStatus(token: string): number {
  const out = execFileSync(
    'curl',
    ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/vnd.github+json', 'https://api.github.com/user'],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

/**
 * Экранирование для Telegram `parse_mode: "HTML"` — PR-заголовки в дайджесте
 * needs-owner не проверены на спецсимволы (по конвенции очереди их пишет
 * агент, но заголовок мог прийти и от человека при ручном триаже).
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function collect(): {
  issues: QueueIssue[];
  prs: RawPr[];
  linked: Map<number, RawPr>;
  links: PrLink[];
} {
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

  // Связка PR → lanes его открытых issues: по ней countBackpressurePrs отличает
  // давление очереди от инбокса владельца и чужих PR-ов.
  const laneByNumber = new Map<number, Lane>(issues.map((i) => [i.number, laneOf(i.labels)]));
  const links: PrLink[] = prs.map((pr) => ({
    prNumber: pr.number,
    queueBranch: QUEUE_BRANCH_RE.test(pr.head.ref),
    issueLanes: closedIssueNumbers(pr)
      .map((n) => laneByNumber.get(n))
      .filter((l): l is Lane => l !== undefined),
  }));

  return { issues, prs, linked, links };
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
  const { issues, links } = collect();
  const queuePrCount = countBackpressurePrs(links);
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
  const files: ChangedFile[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<ChangedFile[]>(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const gate = classifyMergeGate(files, config);
  console.log(JSON.stringify({ pr: prNumber, files: files.length, ...gate }, null, 2));
  if (gate.tier === 'hold') process.exitCode = 3; // отличимо от ошибки сети/скрипта
}

// ── Триаж и планирование ────────────────────────────────────────────────────
//
// Механика лейблов — здесь, детерминированно. Суждение (какой приоритет, задача
// или эпик) — у сессии, которая вызывает эти команды по .claude/commands/next-issue.md.

/** Входящие для триажа: открытые issues без auto:*, кроме инцидентов и дашборда. */
function cmdUntriaged(): void {
  const raw = openIssues();
  const bodies = new Map(raw.map((i) => [i.number, i.body ?? '']));
  const issues: QueueIssue[] = raw.map((i) => ({
    number: i.number,
    title: i.title,
    labels: i.labels.map((l) => l.name),
    updatedAt: i.updated_at,
    hasOpenPr: false, // для триажа не важно
  }));
  const list = untriagedIssues(issues).map((i) => ({
    number: i.number,
    title: i.title,
    labels: i.labels,
    body: (bodies.get(i.number) ?? '').slice(0, 2000),
    url: `https://github.com/${REPO}/issues/${i.number}`,
  }));
  console.log(JSON.stringify(list, null, 2));
}

function cmdTriage(num: number, prio: string, lane: string): void {
  if (!/^P[0-3]$/.test(prio)) throw new Error(`приоритет «${prio}» — ожидаю P0..P3`);
  if (lane !== 'ready' && lane !== 'epic') throw new Error(`lane «${lane}» — ожидаю ready или epic`);
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
  const labels = issue.labels.map((l) => l.name);
  const existing = labels.filter((l) => l.startsWith('auto:'));
  if (existing.length > 0) {
    throw new Error(`#${num} уже триажирована (${existing.join(', ')}) — правь лейблы руками, а не повторным триажем`);
  }
  const kept = labels.filter((l) => !l.startsWith('prio:'));
  setLabels(num, [...kept, `prio:${prio}`, `auto:${lane}`]);
  console.log(`triaged #${num} → prio:${prio} + auto:${lane}`);
}

/** Завести issue из сессии: побочные баги, дочерние задачи эпиков, идеи владельца. */
function cmdCreate(rest: string[]): void {
  let title = '';
  let bodyFile = '';
  let prio = '';
  let parent = 0;
  let lane: 'ready' | 'epic' | null = null;
  const extraLabels: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--title': title = rest[++i] ?? ''; break;
      case '--body-file': bodyFile = rest[++i] ?? ''; break;
      case '--prio': prio = rest[++i] ?? ''; break;
      case '--ready': lane = 'ready'; break;
      case '--epic': lane = 'epic'; break;
      case '--label': extraLabels.push(rest[++i] ?? ''); break;
      case '--parent': parent = Number(rest[++i]); break;
      default: throw new Error(`неизвестный флаг «${rest[i]}»`);
    }
  }
  if (!title) throw new Error('нужен --title');
  if (prio && !/^P[0-3]$/.test(prio)) throw new Error(`приоритет «${prio}» — ожидаю P0..P3`);

  let body = bodyFile ? readFileSync(bodyFile, 'utf8') : '';
  if (parent) body = `${body.trimEnd()}\n\nЧасть эпика #${parent}.\n`;

  const labels = extraLabels.filter(Boolean);
  if (prio) labels.push(`prio:${prio}`);
  if (lane) labels.push(`auto:${lane}`);

  const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', {
    title,
    body,
    labels,
  });
  console.log(JSON.stringify({ issue: created.number, url: created.html_url }, null, 2));
}

/** Открытые эпики, старые вперёд; planned=true — уже разобран на задачи. */
function cmdEpics(): void {
  const epics = openIssues()
    .filter((i) => i.labels.some((l) => l.name === 'auto:epic'))
    .sort((a, b) => a.number - b.number)
    .map((i) => ({
      number: i.number,
      title: i.title,
      planned: allComments(i.number).some((c) => c.body.includes(EPIC_PLANNED_MARKER)),
      url: `https://github.com/${REPO}/issues/${i.number}`,
    }));
  console.log(JSON.stringify(epics, null, 2));
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

/**
 * PR создаётся сразу НЕ черновиком — и это вынужденно, а не по вкусу.
 * Снять draft можно только мутацией GraphQL (в REST такой операции нет), а
 * agent-proxy сессий воркера GraphQL не пропускает. Создай PR черновиком —
 * и воркер уже никогда не сможет его домержить: `pr-merge` черновики отвергает.
 *
 * Ничего при этом не теряется: настоящий предохранитель — `pr-merge`, который
 * сам перепроверяет гейт и зелёный CI. Черновик тут был бы украшением.
 * Флаг `--draft` оставлен для ручных прогонов, где GraphQL доступен.
 */
function cmdPrOpen(issueNumber: number, branch: string, draft: boolean, refsOnly: boolean): void {
  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${issueNumber}`);
  const existing = gh<RawPr[]>(`/repos/${REPO}/pulls?state=open&head=${REPO.split('/')[0]}:${branch}`);
  if (existing.length > 0) {
    console.log(JSON.stringify({ pr: existing[0].number, url: existing[0].html_url, created: false }, null, 2));
    return;
  }
  // --refs: PR ссылается на issue, но не закрывает её. Нужен PRD-PR эпика:
  // эпик остаётся открытым, пока не сделаны все дочерние задачи.
  const linkLine = refsOnly ? `Эпик: #${issueNumber}` : `Closes #${issueNumber}`;
  const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/pulls`, 'POST', {
    title: issue.title,
    head: branch,
    base: 'main',
    draft,
    body:
      `${linkLine}\n\n` +
      `<!-- Тело заполняется воркером: что было сломано, что изменено, как проверено. -->\n\n` +
      `---\n_Generated by [Claude Code](https://claude.ai/code)_`,
  });
  console.log(JSON.stringify({ pr: created.number, url: created.html_url, created: true, draft }, null, 2));
}

/**
 * Снять черновик. REST этого не умеет (draft правится только через GraphQL
 * markPullRequestReadyForReview), а /graphql agent-proxy не пропускает —
 * поэтому в сессии воркера команда честно сообщает, что не смогла.
 */
function markReady(nodeId: string): { ok: boolean; detail?: string } {
  const query = {
    query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}',
    variables: { id: nodeId },
  };
  try {
    const res = gh<{ errors?: { message: string }[] }>('https://api.github.com/graphql', 'POST', query);
    if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 200) };
  }
}

function cmdPrReady(prNumber: number): void {
  const pr = gh<{ draft: boolean; node_id: string }>(`/repos/${REPO}/pulls/${prNumber}`);
  if (!pr.draft) {
    console.log(JSON.stringify({ pr: prNumber, draft: false, changed: false }, null, 2));
    return;
  }
  const res = markReady(pr.node_id);
  if (res.ok) {
    console.log(JSON.stringify({ pr: prNumber, draft: false, changed: true }, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      { pr: prNumber, draft: true, changed: false, reason: 'не удалось снять draft автоматически', detail: res.detail },
      null,
      2,
    ),
  );
  process.exitCode = 3;
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
      console.log(
        JSON.stringify(
          {
            pr: prNumber,
            state: 'timeout',
            pending: s.pending.length ? s.pending.map((r) => r.name) : ['CI так и не стартовал'],
          },
          null,
          2,
        ),
      );
      process.exitCode = 4;
      return;
    }
    execFileSync('sleep', ['30']);
  }
}

function changedFiles(prNumber: number): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<ChangedFile[]>(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

interface MergeAttempt {
  merged: boolean;
  reason?: string;
  /** Гейт запретил — ждать нечего, PR нужно отдать владельцу. */
  hold?: boolean;
  reasons?: string[];
  failed?: string[];
  pending?: string[];
  detail?: string;
}

/**
 * Последний предохранитель перед прод-деплоем: мержит, только если гейт разрешает
 * И весь CI зелёный. Проверяет сам, а не верит вызывающему — а вызывающих теперь
 * двое: сессия воркера (`pr-merge`) и крон-подметальщик (`automerge`).
 */
function attemptMerge(
  prNumber: number,
  config: QueueConfig,
  opts: { promoteDraft?: boolean } = {},
): MergeAttempt {
  const gate = classifyMergeGate(changedFiles(prNumber), config);
  if (gate.tier === 'hold') {
    return { merged: false, reason: 'gate=hold', hold: true, reasons: gate.reasons };
  }

  const runs = checksFor(prNumber);
  const s = summarizeChecks(runs);
  if (!s.green) {
    const reason = runs.length === 0 ? 'CI не стартовал — чеков нет вообще' : s.done ? 'CI красный' : 'CI ещё идёт';
    return { merged: false, reason, failed: s.failed.map((r) => r.name), pending: s.pending.map((r) => r.name) };
  }

  const pr = gh<{ draft: boolean; title: string; node_id: string }>(`/repos/${REPO}/pulls/${prNumber}`);
  if (pr.draft) {
    // Снимаем черновик только здесь — когда гейт и CI уже сказали «да». До этой
    // точки PR мог быть незакончен, после неё флаг остаётся единственным, что
    // отделяет готовый PR от мержа.
    if (!opts.promoteDraft) return { merged: false, reason: 'PR всё ещё черновик — сними draft явно' };
    const ready = markReady(pr.node_id);
    if (!ready.ok) {
      return { merged: false, reason: 'не удалось снять draft автоматически', detail: ready.detail };
    }
  }

  try {
    gh(`/repos/${REPO}/pulls/${prNumber}/merge`, 'PUT', {
      merge_method: 'squash',
      commit_title: `${pr.title} (#${prNumber})`,
    });
    return { merged: true };
  } catch (err) {
    // Обычно это branch protection (нужен ревью) — не наша ошибка, а решение владельца.
    return { merged: false, reason: 'GitHub отказал в мерже', detail: String(err).slice(0, 300) };
  }
}

const NEXT_ISSUE_OUTCOMES = ['merged', 'parked', 'blocked', 'released'] as const;
const METRICS_FILE = resolve(ROOT, 'docs/pipeline-runs/next-issue.metrics.jsonl');

/**
 * Телеметрия прогонов /next-issue (issue #582) — одна JSONL-строка в общий
 * файл на завершённую задачу, коммитится в PR самой задачи (шаг 7
 * `.claude/commands/next-issue.md`). Читает/агрегирует
 * `src/modules/pipeline-metrics/service.ts` (дашборд /admin/monitoring/pipelines).
 */
function cmdMetric(
  issue: number,
  branch: string,
  outcome: string,
  ciFixRounds: number,
  reviewRounds: number,
  durationMin: number,
): void {
  if (!Number.isFinite(issue) || issue <= 0) {
    throw new Error(`issue «${issue}» — ожидаю положительное число`);
  }
  if (!branch) {
    throw new Error('branch не задан');
  }
  if (!(NEXT_ISSUE_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(`outcome «${outcome}» — ожидаю ${NEXT_ISSUE_OUTCOMES.join('|')}`);
  }
  if (!Number.isFinite(ciFixRounds) || !Number.isFinite(reviewRounds) || !Number.isFinite(durationMin)) {
    throw new Error('ci_fix_rounds/review_rounds/duration_min должны быть числами');
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    issue,
    branch,
    outcome,
    ci_fix_rounds: ciFixRounds,
    review_rounds: reviewRounds,
    duration_min: durationMin,
  });
  mkdirSync(resolve(ROOT, 'docs/pipeline-runs'), { recursive: true });
  appendFileSync(METRICS_FILE, `${line}\n`);
  console.log(`metric appended for #${issue}: ${outcome} (${METRICS_FILE})`);
}

function cmdPrMerge(prNumber: number): void {
  const result = attemptMerge(prNumber, loadConfig());
  console.log(JSON.stringify({ pr: prNumber, ...result }, null, 2));
  if (!result.merged) process.exitCode = 3;
}

/**
 * Крон-подметальщик: обходит открытые PR-ы очереди и домерживает всё, что гейт и
 * зелёный CI уже разрешили. Раньше это умела только живая сессия, и её смерть
 * между `pr-open` и `pr-merge` отправляла готовый PR в инбокс владельца.
 *
 * PR, который гейт не пропустил, здесь же получает лейбл `needs-owner`, а его
 * issue уезжает в `auto:review`: иначе очередь стояла бы до `staleWipHours`,
 * ожидая сессию, которой нет.
 */
function cmdAutoMerge(dryRun: boolean): void {
  const config = loadConfig();
  // Рубильник должен глушить подметальщика целиком, а не через гейт: при
  // `autoMerge: false` гейт возвращает hold на каждый PR, и обход ниже развесил бы
  // `needs-owner` на весь бэклог — выключатель обязан быть тихим.
  if (!config.enabled || !config.autoMerge) {
    const which = !config.enabled ? 'enabled' : 'autoMerge';
    console.log(JSON.stringify({ merged: 0, considered: 0, off: `${which}=false в .github/issue-queue.json` }, null, 2));
    return;
  }

  const { issues, prs } = collect();
  const laneByNumber = new Map<number, Lane>(issues.map((i) => [i.number, laneOf(i.labels)]));
  const labelsByNumber = new Map<number, string[]>(issues.map((i) => [i.number, i.labels]));
  const results: Record<string, unknown>[] = [];
  const now = new Date();
  let merged = 0;

  for (const pr of prs) {
    const closes = closedIssueNumbers(pr);
    // Лейблы PR живут в /issues/{n} — у PR-ов и issues общее пространство номеров.
    const prLabels = gh<{ labels: { name: string }[] }>(`/repos/${REPO}/issues/${pr.number}`).labels.map(
      (l) => l.name,
    );
    const skip = autoMergeSkipReason(
      {
        prNumber: pr.number,
        branch: pr.head.ref,
        labels: prLabels,
        issueLanes: closes.map((n) => laneByNumber.get(n)).filter((l): l is Lane => l !== undefined),
        updatedAt: pr.updated_at,
      },
      config,
      now,
    );
    if (skip) {
      results.push({ pr: pr.number, merged: false, skipped: skip });
      continue;
    }

    if (dryRun) {
      const gate = classifyMergeGate(changedFiles(pr.number), config);
      const s = summarizeChecks(checksFor(pr.number));
      results.push({
        pr: pr.number,
        merged: false,
        dryRun: true,
        wouldMerge: gate.tier === 'auto' && s.green,
        tier: gate.tier,
        draft: pr.draft,
        ci: s.green ? 'green' : s.done ? 'red' : 'pending',
      });
      continue;
    }

    const result = attemptMerge(pr.number, config, { promoteDraft: true });
    if (result.merged) {
      merged++;
      // `Closes #N` закроет issue сам — лейблы очереди уедут вместе с ней.
      results.push({ pr: pr.number, merged: true, closes });
      continue;
    }

    // Снятие черновика — единственный шаг подметальщика, зависящий от GraphQL.
    // Если мутация недоступна, PR не молчит: один видимый комментарий с прямой
    // просьбой нажать «Ready for review». `needs-owner` при этом НЕ вешаем — сбой
    // может быть транзиентным, и лейбл вывел бы PR из-под подметальщика навсегда.
    if (result.reason === 'не удалось снять draft автоматически') {
      const seen = allComments(pr.number).some((c) => c.body.includes(DRAFT_STUCK_MARKER));
      if (!seen) {
        comment(
          pr.number,
          `${DRAFT_STUCK_MARKER}\n\nPR готов к мержу — гейт вернул \`auto\`, CI зелёный, — но снять ` +
            `черновик автоматически не вышло: мутация GraphQL недоступна ` +
            `(\`${result.detail ?? 'без деталей'}\`).\n\nНажми «Ready for review» — дальше подметальщик ` +
            `домержит сам, ничего больше не требуется.`,
        );
      }
    }

    if (result.hold) {
      // Решение нужно от человека — зовём его сразу и явно, а не молчаливым
      // протуханием лока через несколько часов.
      if (!prLabels.includes('needs-owner')) {
        gh(`/repos/${REPO}/issues/${pr.number}/labels`, 'POST', { labels: ['needs-owner'] });
        comment(
          pr.number,
          `Авто-мерж запрещён гейтом:\n\n${(result.reasons ?? []).map((r) => `- ${r}`).join('\n')}\n\n` +
            `Очередь идёт дальше, PR ждёт решения владельца.`,
        );
      }
      for (const num of closes) {
        const labels = labelsByNumber.get(num);
        if (labels && laneOf(labels) === 'wip') {
          setLabels(num, swapLane(labels, 'auto:review'));
        }
      }
    }
    results.push({ pr: pr.number, ...result });
  }

  console.log(JSON.stringify({ merged, considered: prs.length, results }, null, 2));
}

function cmdReconcile(): void {
  const config = loadConfig();
  const { issues: allIssues, linked } = collect();
  const now = new Date();
  let touched = 0;

  // GitHub иногда не закрывает issue автоматически по `Closes #N` смерженного PR
  // (issue #616) — reconcile добирает пропуски сам, не дожидаясь, пока это заметят
  // руками. Закрытые здесь issues исключаются из остальной обработки этого прогона:
  // остальные проверки ниже иначе работали бы с уже устаревшей копией.
  const mergedPrs: MergedPrClosing[] = recentlyMergedPrs().map((pr) => ({
    number: pr.number,
    closesIssues: closedIssueNumbers(pr),
    mergedAt: pr.merged_at as string, // recentlyMergedPrs() уже отфильтровал по !!merged_at
  }));
  const missedClosed = new Set<number>();
  for (const { issue, prNumber } of missedAutoCloseIssues(allIssues, mergedPrs)) {
    gh(`/repos/${REPO}/issues/${issue.number}`, 'PATCH', { state: 'closed' });
    comment(
      issue.number,
      `${MISSED_AUTOCLOSE_MARKER}\n\nPR #${prNumber} смержен и закрывает эту issue (\`Closes #${issue.number}\`), ` +
        `но GitHub не закрыл её автоматически (issue #616) — закрыто вручную reconcile'ом.`,
    );
    console.log(`closed missed-auto-close #${issue.number} (PR #${prNumber})`);
    missedClosed.add(issue.number);
    touched++;
  }
  const issues = allIssues.filter((i) => !missedClosed.has(i.number));

  for (const issue of staleWipIssues(issues, config, now)) {
    const hours = Math.round((now.getTime() - new Date(issue.updatedAt).getTime()) / 3.6e6);

    // Сколько раз эту задачу уже подбирали и бросали. Считаем по собственным
    // комментариям — отдельное состояние заводить незачем. give-up сбрасывает
    // счётчик: возвращённая владельцем задача начинает с чистого листа.
    const attempts = countAttempts(allComments(issue.number).map((c) => c.body));

    if (attempts + 1 >= config.maxAttempts) {
      setLabels(issue.number, swapLane(issue.labels, 'auto:blocked'));
      comment(
        issue.number,
        `${GIVEUP_MARKER}\n\nЗадача снята с автоочереди: ${attempts + 1} попытки подряд закончились ` +
          `ничем — сессия воркера каждый раз умирала, не дойдя до PR. Дальше автоматика будет ` +
          `бесконечно ходить по кругу и жечь бюджет, поэтому issue переведена в \`auto:blocked\`.\n\n` +
          `Скорее всего задача сформулирована слишком крупно или упирается в доступ, которого у ` +
          `воркера нет. Разбей её на части либо верни в очередь руками, поменяв лейбл на \`auto:ready\` — ` +
          `счётчик попыток при этом начнётся заново.`,
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

  // Сессия умерла ПОСЛЕ pr-open: лок висит, PR замер. Раньше такой лок не
  // протухал никогда («PR есть — работа идёт») и очередь вставала до вмешательства
  // человека. Теперь свежесть меряется по updated_at самого PR.
  const movedToReview = new Set<number>();
  const prUpdatedAt = new Map<number, string>([...linked].map(([n, pr]) => [n, pr.updated_at]));
  for (const issue of staleWipWithPr(issues, prUpdatedAt, config, now)) {
    const pr = linked.get(issue.number);
    const hours = Math.round(
      (now.getTime() - new Date(prUpdatedAt.get(issue.number) ?? issue.updatedAt).getTime()) / 3.6e6,
    );
    setLabels(issue.number, swapLane(issue.labels, 'auto:review'));
    comment(
      issue.number,
      `${STALE_PR_MARKER}\n\nСессия, открывшая PR #${pr?.number}, судя по всему, умерла: PR не ` +
        `обновлялся ${hours} ч. Задача переведена в \`auto:review\`, очередь идёт дальше. ` +
        `PR ждёт владельца или следующей сессии.`,
    );
    console.log(`parked stale-PR lock #${issue.number} (PR #${pr?.number}, ${hours}h) → auto:review`);
    movedToReview.add(issue.number);
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
    if (movedToReview.has(issue.number)) continue;
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
  const { issues, linked, links } = collect();
  const queuePrs = [...new Set([...linked.values()].map((p) => p.number))];
  const snap = snapshot(issues, config, countBackpressurePrs(links));
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
  // state=all: закрытый дашборд переоткрывается, а не плодит дубликаты навечно.
  // Выключается дашборд не закрытием, а enabled=false в .github/issue-queue.json.
  const found = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=all&labels=${encodeURIComponent('auto:dashboard')}&sort=created&direction=asc&per_page=10`,
  ).filter((i) => !i.pull_request);

  if (found.length > 0) {
    const target = found[0];
    const patch: { body: string; state?: 'open' } = { body };
    if (target.state === 'closed') patch.state = 'open';
    gh(`/repos/${REPO}/issues/${target.number}`, 'PATCH', patch);
    console.log(`dashboard ${target.state === 'closed' ? 'reopened' : 'updated'}: #${target.number}`);
  } else {
    const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', {
      title: '📋 Автоочередь разгрузки бэклога — состояние',
      body,
      labels: ['auto:dashboard'],
    });
    console.log(`dashboard created: #${created.number} ${created.html_url}`);
  }
}

/**
 * Сторож простоя. Исполнитель очереди — смертная интерактивная сессия: умерла —
 * и «очередь стоит» не заметит никто, все прогоны зелёные. Команда решает, пора
 * ли будить владельца (сам Telegram-вызов — в issue-queue.yml, секретов тут нет),
 * и дедупит алерты маркер-комментарием на дашборде.
 */
function cmdHeartbeat(dryRun: boolean): void {
  const config = loadConfig();
  const { issues } = collect();
  const ready = issues.filter((i) => laneOf(i.labels) === 'ready').length;
  const wip = issues.filter((i) => laneOf(i.labels) === 'wip').length;

  // Активность очереди — по самому свежему PR на её ветках, включая закрытые:
  // только что смерженный PR — тоже признак жизни.
  const recentPrs = gh<{ head: { ref: string }; updated_at: string }[]>(
    `/repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
  );
  const lastQueuePrActivityAt =
    recentPrs.find((p) => QUEUE_BRANCH_RE.test(p.head.ref))?.updated_at ?? null;

  const dash = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=all&labels=${encodeURIComponent('auto:dashboard')}&sort=created&direction=asc&per_page=10`,
  ).filter((i) => !i.pull_request);
  let lastAlertAt: string | null = null;
  if (dash.length > 0) {
    const alerts = allComments(dash[0].number).filter((c) => c.body.includes(HEARTBEAT_MARKER));
    lastAlertAt = alerts.length > 0 ? alerts[alerts.length - 1].created_at : null;
  }

  const verdict = shouldHeartbeat({
    enabled: config.enabled,
    readyCount: ready,
    wipCount: wip,
    lastQueuePrActivityAt,
    lastAlertAt,
    now: new Date(),
    idleHours: config.heartbeatIdleHours,
    cooldownHours: config.heartbeatCooldownHours,
  });

  if (verdict.alert && !dryRun && dash.length > 0) {
    comment(
      dash[0].number,
      `${HEARTBEAT_MARKER}\n\n⏸ Очередь простаивает: ready=${ready}, wip=0, PR-активности нет ` +
        `дольше ${config.heartbeatIdleHours} ч. Сессии воркера заводит Routine раз в 2 часа — ` +
        `значит, сломан планировщик, а не очередь.`,
    );
  }
  console.log(JSON.stringify({ alert: verdict.alert, reason: verdict.reason, ready, wip }, null, 2));
}

/**
 * Watchdog автономии (issue #573): живость AUTOMATION_TOKEN + суточный
 * дайджест needs-owner. Как и heartbeat — только решения и запись
 * маркер-комментариев на дашборд; сам вызов Telegram (секреты) — в
 * issue-queue.yml, отдельным шагом по JSON-выводу этой команды.
 */
function cmdOpsWatch(dryRun: boolean): void {
  const dash = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=all&labels=${encodeURIComponent('auto:dashboard')}&sort=created&direction=asc&per_page=10`,
  ).filter((i) => !i.pull_request);
  const dashNumber = dash.length > 0 ? dash[0].number : null;
  const dashComments = dashNumber !== null ? allComments(dashNumber) : [];

  const result: Record<string, unknown> = {};

  // --- 1. Живость AUTOMATION_TOKEN ---
  // Секрет может быть не заведён вовсе (CLAUDE.md: очередь работает и без
  // него, просто авто-ребейзы паркуются в action_required) — это не «токен
  // умер», а «токена никогда не было»; ложную тревогу не поднимаем.
  const automationToken = process.env.AUTOMATION_TOKEN;
  if (!automationToken) {
    result.token = { checked: false, reason: 'AUTOMATION_TOKEN не задан' };
  } else {
    const status = checkTokenStatus(automationToken);
    const dead = isTokenDead(status);
    result.token = { checked: true, dead, status };
    result.tokenAlert = dead;

    if (!dead) {
      const lastReminderAt =
        dashComments.filter((c) => c.body.includes(TOKEN_ROTATION_MARKER)).at(-1)?.created_at ?? null;
      const remind = shouldRemindRotation({ now: new Date(), lastReminderAt, intervalDays: 30 });
      result.rotationReminder = remind;
      if (remind && !dryRun && dashNumber !== null) {
        comment(
          dashNumber,
          `${TOKEN_ROTATION_MARKER}\n\n🔑 Напоминание: AUTOMATION_TOKEN — fine-grained PAT со ` +
            `сроком действия ≤90 дней, дата истечения через API недоступна. Проверь в ` +
            `GitHub → Settings → Developer settings → Fine-grained tokens и при необходимости ` +
            `сгенерируй новый (issue #573, ADR 2026-08-10 §«Обновление 2026-08-13»).`,
        );
      }
    }
  }

  // --- 2. Дайджест needs-owner старше 48ч ---
  const needsOwnerRaw = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent('needs-owner')}&per_page=100`,
  ).filter((i) => i.pull_request);
  const needsOwnerPrs: NeedsOwnerPr[] = needsOwnerRaw.map((pr) => ({
    number: pr.number,
    title: pr.title,
    labeledAt: needsOwnerLabeledAt(pr.number) ?? pr.updated_at,
  }));
  const lastDigestAt =
    dashComments.filter((c) => c.body.includes(NEEDS_OWNER_DIGEST_MARKER)).at(-1)?.created_at ?? null;

  const digest = buildNeedsOwnerDigest({
    now: new Date(),
    prs: needsOwnerPrs,
    minAgeHours: 48,
    lastDigestAt,
    intervalHours: 24,
  });
  result.digest = digest;

  if (digest.send) {
    const now = Date.now();
    const ageLine = (pr: NeedsOwnerPr, title: string) => {
      const ageHours = Math.round((now - new Date(pr.labeledAt).getTime()) / 3.6e6);
      return `- #${pr.number} ${title} — ${ageHours} ч`;
    };
    // GH-комментарий — обычный markdown-текст (дедуп-маркер для этой команды).
    const plainLines = digest.stalePrs.map((pr) => ageLine(pr, pr.title));
    const digestText = `needs-owner дольше 48 ч, ждут решения владельца:\n${plainLines.join('\n')}`;
    result.digestText = digestText;
    // Отдельная HTML-экранированная версия — для Telegram (parse_mode:"HTML"
    // в issue-queue.yml); заголовок PR не гарантированно безопасен для HTML.
    const htmlLines = digest.stalePrs.map((pr) => ageLine(pr, escapeHtml(pr.title)));
    result.digestTextHtml = `needs-owner дольше 48 ч, ждут решения владельца:\n${htmlLines.join('\n')}`;
    if (!dryRun && dashNumber !== null) {
      comment(dashNumber, `${NEEDS_OWNER_DIGEST_MARKER}\n\n📋 ${digestText}`);
    }
  }

  console.log(JSON.stringify(result, null, 2));
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
    case 'heartbeat': cmdHeartbeat(rest.includes('--dry-run')); break;
    case 'ops-watch': cmdOpsWatch(rest.includes('--dry-run')); break;
    case 'untriaged': cmdUntriaged(); break;
    case 'triage': cmdTriage(Number(rest[0]), rest[1] ?? '', rest[2] ?? ''); break;
    case 'create': cmdCreate(rest); break;
    case 'epics': cmdEpics(); break;
    case 'pr-open': cmdPrOpen(Number(rest[0]), rest[1], rest.includes('--draft'), rest.includes('--refs')); break;
    case 'pr-ready': cmdPrReady(Number(rest[0])); break;
    case 'pr-status': cmdPrStatus(Number(rest[0])); break;
    case 'pr-wait': cmdPrWait(Number(rest[0]), Number(rest[1] ?? 30)); break;
    case 'pr-merge': cmdPrMerge(Number(rest[0])); break;
    case 'metric':
      cmdMetric(
        Number(rest[0]),
        rest[1] ?? '',
        rest[2] ?? '',
        Number(rest[3]),
        Number(rest[4]),
        Number(rest[5]),
      );
      break;
    case 'automerge': cmdAutoMerge(rest.includes('--dry-run')); break;
    default:
      console.error(
        'usage: issue-queue.ts <next|claim|release|park|gate|reconcile|report|heartbeat|untriaged|triage|create|epics|pr-open|pr-ready|pr-status|pr-wait|pr-merge|metric> [args]',
      );
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
