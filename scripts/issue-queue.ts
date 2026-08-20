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
 *                                            [--label X ...] [--parent N] [--force]
 *                                            [--dedup-key slug] — дедуп по точному title
 *                                            и/или маркеру create-dedup (exit 3 при дубле)
 *   epics                                    открытые эпики и разобраны ли они (JSON)
 *
 * Зонтики мелочи (P2 не становится отдельной issue — правило гранулярности CLAUDE.md):
 *   batch-add --area X --key K --title "..." [--details "..."] [--dry-run]
 *                                            пункт в зонтик области (или новый зонтик)
 *   batch-result 700 --done k1,k2 --carried k3=712,k4
 *                                            итог батча перед PR: что сделано/перенесено
 *
 * Решения владельца (Telegram-кнопки вместо needs-owner-инбокса в GitHub):
 *   decisions-sync [--dry-run]               reconcile: needs-owner PR → запросы решений на
 *                                            сайт + исполнение принятых (мерж/reject/...)
 *                                            env: OWNER_DECISIONS_SECRET, OWNER_DECISIONS_URL
 *
 * Жизненный цикл PR (в сессии без MCP хватает Bash):
 *   pr-open 445 claude/issue-445-lockfile    создать PR с `Closes #445`
 *                                            (--refs — «Эпик: #N» вместо Closes, --draft — черновиком)
 *   pr-wait 463 30                           дождаться CI (минут)
 *   pr-status 463                            текущее состояние чеков
 *   gate 463                                 можно ли авто-мержить
 *   verdict 463 code-reviewer|qa-engineer    отметить PASS ревью-агента (маркер для гейта)
 *   pr-ready 463                             снять черновик (GraphQL; в сессии воркера недоступен)
 *   pr-merge 463                             мерж (сам перепроверяет гейт и CI)
 *   automerge [--dry-run]                    крон: домержить все готовые PR очереди
 *   metric 463 branch outcome ciRounds reviewRounds durationMin
 *                                            телеметрия прогона в docs/pipeline-runs/next-issue.jsonl
 *                                            (имя БЕЗ суффикса .metrics.jsonl — иначе коллизия с
 *                                            per-run файлами pipeline.sh в listPipelineRuns(), issue #582 QA)
 *
 * HTTP-путь к GitHub — scripts/lib/gh-api.ts (curl: в Actions с $GH_TOKEN,
 * в сессии Claude Code через agent-proxy).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO, ghApi as gh } from './lib/gh-api';
import {
  CODE_REVIEWER_PASS_MARKER,
  DEFAULT_CONFIG,
  DEPENDABOT_BRANCH_RE,
  DRAFT_STUCK_MARKER,
  EPIC_PLANNED_MARKER,
  GIVEUP_MARKER,
  HEARTBEAT_MARKER,
  MISSED_AUTOCLOSE_MARKER,
  QA_ENGINEER_PASS_MARKER,
  QUEUE_BRANCH_RE,
  RELEASE_BRANCH_RE,
  STALE_MARKER,
  STALE_PR_MARKER,
  assertClaimable,
  autoMergeSkipReason,
  claimJitterSeconds,
  classifyMergeGate,
  countAttempts,
  countBackpressurePrs,
  graceElapsed,
  isDependabotAutoMergeBranch,
  isTrustedVerdictAuthor,
  laneOf,
  missedAutoCloseIssues,
  pickNext,
  priorityOf,
  releasePrGate,
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
  BATCH_LABEL,
  BATCH_RESCUE_MARKER,
  batchAreaOf,
  parseBatchItems,
  parseBatchResult,
  renderBatchResult,
  unprocessedBatchItems,
} from './lib/issue-batch';
import { batchAdd, batchCommentBodies } from './lib/batch-io';
import { TOKEN_ROTATION_MARKER, isTokenDead, shouldRemindRotation } from './lib/queue-watch';

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

interface RawComment {
  body: string;
  created_at: string;
  user: { login: string } | null;
  author_association: string;
}

function allComments(num: number): RawComment[] {
  const out: RawComment[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = gh<RawComment[]>(`/repos/${REPO}/issues/${num}/comments?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Тела комментариев PR, чьё авторство `classifyMergeGate` вправе доверять
 * (#580) — только они могут нести маркеры вердиктов ревью-агентов. Репозиторий
 * публичный, поэтому фильтр обязателен: без него текст маркера в комментарии
 * постороннего аккаунта гейт принял бы за настоящее ревью.
 */
function trustedCommentBodies(num: number): string[] {
  return allComments(num)
    .filter((c) => isTrustedVerdictAuthor(c.user?.login ?? '', c.author_association))
    .map((c) => c.body);
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
  // Issue #647: джиттер перед read-check-write разносит во времени claim(),
  // вызванные почти одновременно двумя сессиями (например, разбуженными одним
  // Routine-триггером) — сужает окно гонки, не устраняя её (GitHub Issues API
  // не поддерживает compare-and-swap/ETag на PATCH labels).
  execFileSync('sleep', [claimJitterSeconds().toFixed(3)]);

  const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
  const labels = issue.labels.map((l) => l.name);
  assertClaimable(labels, num);
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
  const gate = classifyMergeGate(
    files,
    config,
    trustedCommentBodies(prNumber),
  );
  console.log(JSON.stringify({ pr: prNumber, files: files.length, ...gate }, null, 2));
  if (gate.tier === 'hold') process.exitCode = 3; // отличимо от ошибки сети/скрипта
}

/**
 * Публикует маркер вердикта ревью-агента на PR (#580) — шаг 5 `/next-issue`
 * после PASS от `code-reviewer`/`qa-engineer`. Отдельная команда, а не голая
 * инструкция «напиши такой-то HTML-комментарий» в промпте: маркер живёт в
 * одном месте (`scripts/lib/issue-queue.ts`), опечатка в промпте молча ломала
 * бы авто-мерж собственного PR сессии.
 */
function cmdVerdict(prNumber: number, agent: string): void {
  const marker =
    agent === 'code-reviewer' ? CODE_REVIEWER_PASS_MARKER : agent === 'qa-engineer' ? QA_ENGINEER_PASS_MARKER : null;
  if (!marker) throw new Error(`agent «${agent}» — ожидаю code-reviewer или qa-engineer`);
  comment(prNumber, `${marker}\nВердикт: PASS.`);
  console.log(`verdict posted #${prNumber} → ${agent}: PASS`);
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

const CREATE_DEDUP_WINDOW_DAYS = 14;

/**
 * Дубликат по `--dedup-key`: маркер `<!-- create-dedup:<slug> -->` в теле issue,
 * обновлявшейся за последние 14 дней (state=all — закрытая недавно issue тоже
 * блокирует пересоздание: «закрыли → пересоздали следующей ночью» и есть болезнь,
 * от которой дедуп заводится). Только repo-scoped пути — /search/issues
 * agent-proxy сессий не пропускает.
 */
function findByDedupKey(key: string): { number: number; state: string } | null {
  const marker = `<!-- create-dedup:${key} -->`;
  const since = new Date(Date.now() - CREATE_DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  for (let page = 1; page <= 3; page++) {
    const batch = gh<RawIssue[]>(
      `/repos/${REPO}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
    );
    const hit = batch.find((i) => !i.pull_request && (i.body ?? '').includes(marker));
    if (hit) return { number: hit.number, state: hit.state ?? 'open' };
    if (batch.length < 100) break;
  }
  return null;
}

interface CreateIssueInput {
  title: string;
  body: string;
  labels: string[];
  /** Дедуп-slug; пишется маркером в тело и проверяется перед созданием. */
  dedupKey?: string;
  /** Пропустить дедуп по точному совпадению title. */
  force?: boolean;
}

/**
 * Единая точка создания issue (cmdCreate и исполнение owner-idea решений).
 * Дедуп двухслойный: точное совпадение title с ОТКРЫТОЙ issue (создание
 * отклоняется, exit 3 у CLI) и опциональный `dedupKey` (окно 14 дней,
 * включая закрытые). Fuzzy-похожесть намеренно не делаем: механика очереди —
 * детерминированный код без AI, ложное «похоже» здесь дороже дубля.
 */
function createIssue(input: CreateIssueInput): { issue: number; url: string; deduped: boolean; existing?: number } {
  if (input.dedupKey) {
    const existing = findByDedupKey(input.dedupKey);
    if (existing) {
      return { issue: existing.number, url: `https://github.com/${REPO}/issues/${existing.number}`, deduped: true, existing: existing.number };
    }
  }
  if (!input.force) {
    const dup = openIssues().find((i) => i.title.trim() === input.title.trim());
    if (dup) {
      return { issue: dup.number, url: `https://github.com/${REPO}/issues/${dup.number}`, deduped: true, existing: dup.number };
    }
  }
  const body = input.dedupKey
    ? `${input.body.trimEnd()}\n\n<!-- create-dedup:${input.dedupKey} -->\n`
    : input.body;
  const created = gh<{ number: number; html_url: string }>(`/repos/${REPO}/issues`, 'POST', {
    title: input.title,
    body,
    labels: input.labels,
  });
  return { issue: created.number, url: created.html_url, deduped: false };
}

/** Завести issue из сессии: побочные баги, дочерние задачи эпиков, идеи владельца. */
function cmdCreate(rest: string[]): void {
  let title = '';
  let bodyFile = '';
  let prio = '';
  let parent = 0;
  let lane: 'ready' | 'epic' | null = null;
  let force = false;
  let dedupKey = '';
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
      case '--force': force = true; break;
      case '--dedup-key': dedupKey = rest[++i] ?? ''; break;
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

  const result = createIssue({ title, body, labels, dedupKey: dedupKey || undefined, force });
  console.log(JSON.stringify(result, null, 2));
  if (result.deduped) process.exitCode = 3; // отличимо от ошибки: дубль найден, ничего не создано
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
 * трое: сессия воркера (`pr-merge`), крон-подметальщик (`automerge`) и исполнение
 * решений владельца (`decisions-sync`).
 *
 * `gateExempt` пропускает ТОЛЬКО проверку гейта — CI green и снятие draft
 * обязательны всегда. Легальны ровно три случая: `owner-approved` (владелец
 * решил кнопкой в Telegram — человеческое решение и заменяет гейт), `release`
 * (release-please PR: whitelist файлов проверен вызывающим, вердиктов ревью на
 * changelog-бампе не бывает и при ручном мерже) и `dependabot-group` (границы
 * задаёт dependabot.yml, конфиг групп — HOLD-файл).
 *
 * Мерж всегда пинится к SHA: `PUT /merge` с `sha` атомарно отвергает мерж (409),
 * если в ветку успел прилететь коммит после того, как мы проверили CI. Без пина
 * между проверкой и мержем было окно TOCTOU.
 */
function attemptMerge(
  prNumber: number,
  config: QueueConfig,
  opts: {
    promoteDraft?: boolean;
    gateExempt?: 'owner-approved' | 'release' | 'dependabot-group';
    /** Мержить только этот head SHA (решения владельца пинятся к моменту аппрува). */
    expectedSha?: string;
  } = {},
): MergeAttempt {
  const pr = gh<{ draft: boolean; title: string; node_id: string; head: { sha: string }; state: string; merged: boolean }>(
    `/repos/${REPO}/pulls/${prNumber}`,
  );
  if (pr.merged) return { merged: false, reason: 'PR уже смержен' };
  if (pr.state !== 'open') return { merged: false, reason: 'PR закрыт' };

  const sha = opts.expectedSha ?? pr.head.sha;
  if (opts.expectedSha && pr.head.sha !== opts.expectedSha) {
    return { merged: false, reason: 'head SHA изменился после решения', detail: `ожидался ${opts.expectedSha.slice(0, 8)}, сейчас ${pr.head.sha.slice(0, 8)}` };
  }

  if (!opts.gateExempt) {
    const gate = classifyMergeGate(
      changedFiles(prNumber),
      config,
      trustedCommentBodies(prNumber),
    );
    if (gate.tier === 'hold') {
      return { merged: false, reason: 'gate=hold', hold: true, reasons: gate.reasons };
    }
  }

  const runs = gh<{ check_runs: CheckRun[] }>(
    `/repos/${REPO}/commits/${sha}/check-runs?per_page=100`,
  ).check_runs;
  const s = summarizeChecks(runs);
  if (!s.green) {
    const reason = runs.length === 0 ? 'CI не стартовал — чеков нет вообще' : s.done ? 'CI красный' : 'CI ещё идёт';
    return { merged: false, reason, failed: s.failed.map((r) => r.name), pending: s.pending.map((r) => r.name) };
  }

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
      sha,
    });
    return { merged: true };
  } catch (err) {
    const detail = String(err).slice(0, 300);
    // 409 по sha — ветка сдвинулась между проверкой CI и мержем: не ошибка, а
    // сработавший пин. Вызывающий решает, перечитывать ли состояние.
    if (detail.includes('409')) {
      return { merged: false, reason: 'head SHA изменился после решения', detail };
    }
    // Обычно это branch protection (нужен ревью) — не наша ошибка, а решение владельца.
    return { merged: false, reason: 'GitHub отказал в мерже', detail };
  }
}

const NEXT_ISSUE_OUTCOMES = ['merged', 'parked', 'blocked', 'released'] as const;
// Имя намеренно без суффикса `.metrics.jsonl` — см. коммент у usage-строки выше.
const METRICS_FILE = resolve(ROOT, 'docs/pipeline-runs/next-issue.jsonl');

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

    const quietMin = (now.getTime() - new Date(pr.updated_at).getTime()) / 60_000;

    // release-please: чистый changelog/version-бамп без кода. Мержится сам, но
    // только ночью (мерж release-PR = деплой; в трафик-часы он не нужен никому)
    // и только если дифф целиком в whitelist релизных файлов — что-то сверх
    // означает «это не release-PR», и такой идёт обычным путём через гейт.
    // Вердикты ревью не требуются: их не было и при ручном мерже владельцем.
    if (RELEASE_BRANCH_RE.test(pr.head.ref)) {
      if (prLabels.includes('needs-owner')) {
        results.push({ pr: pr.number, merged: false, skipped: 'needs-owner — ждёт решения владельца' });
        continue;
      }
      if (quietMin < config.automergeQuietMinutes) {
        results.push({ pr: pr.number, merged: false, skipped: `release-PR обновлялся ${Math.round(quietMin)} мин назад — жду тишины` });
        continue;
      }
      const relGate = releasePrGate(changedFiles(pr.number).map((f) => f.filename), now, config);
      if (!relGate.merge) {
        results.push({ pr: pr.number, merged: false, skipped: relGate.reason });
        continue;
      }
      if (dryRun) {
        const s = summarizeChecks(checksFor(pr.number));
        results.push({ pr: pr.number, merged: false, dryRun: true, path: 'release', wouldMerge: s.green, ci: s.green ? 'green' : s.done ? 'red' : 'pending' });
        continue;
      }
      const result = attemptMerge(pr.number, config, { promoteDraft: true, gateExempt: 'release' });
      if (result.merged) merged++;
      results.push({ pr: pr.number, path: 'release', ...result });
      continue;
    }

    // dependabot: групповые minor+patch PR мержим сами — границы обновлений
    // задаёт dependabot.yml, а мерж под PAT свипера рождает настоящие события
    // (deploy и auto-rebase стартуют без Kick). Одиночные PR (majors) ждут
    // конверсии в задачу очереди (dependabot-automerge.yml) и здесь пропускаются.
    if (DEPENDABOT_BRANCH_RE.test(pr.head.ref)) {
      if (prLabels.includes('needs-owner')) {
        results.push({ pr: pr.number, merged: false, skipped: 'needs-owner — ждёт решения владельца' });
        continue;
      }
      if (!isDependabotAutoMergeBranch(pr.head.ref)) {
        results.push({ pr: pr.number, merged: false, skipped: 'dependabot вне групп minor+patch (major?) — конвертируется в задачу очереди, не мержится сам' });
        continue;
      }
      if (quietMin < config.automergeQuietMinutes) {
        results.push({ pr: pr.number, merged: false, skipped: `dependabot-PR обновлялся ${Math.round(quietMin)} мин назад — жду тишины` });
        continue;
      }
      if (dryRun) {
        const s = summarizeChecks(checksFor(pr.number));
        results.push({ pr: pr.number, merged: false, dryRun: true, path: 'dependabot-group', wouldMerge: s.green, ci: s.green ? 'green' : s.done ? 'red' : 'pending' });
        continue;
      }
      const result = attemptMerge(pr.number, config, { promoteDraft: true, gateExempt: 'dependabot-group' });
      if (result.merged) merged++;
      results.push({ pr: pr.number, path: 'dependabot-group', ...result });
      continue;
    }

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
      const gate = classifyMergeGate(
        changedFiles(pr.number),
        config,
        trustedCommentBodies(pr.number),
      );
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

  // Закрытые зонтики: сессия могла замержить батч-PR, забыв batch-result или
  // оставив пункты неучтёнными — сигналы исчезли бы молча. Спасаем механически:
  // каждый неучтённый пункт уезжает batch-add'ом в новый зонтик своей области,
  // на закрытом зонтике остаётся rescue-маркер (дедуп повторного спасения).
  const rescueSince = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const closedBatches = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=closed&labels=${encodeURIComponent(BATCH_LABEL)}&since=${encodeURIComponent(rescueSince)}&per_page=100`,
  ).filter((i) => !i.pull_request);
  for (const b of closedBatches) {
    const bodies = allComments(b.number).map((c) => c.body);
    if (bodies.some((x) => x.includes(BATCH_RESCUE_MARKER))) continue;
    const missing = unprocessedBatchItems(parseBatchItems(bodies), parseBatchResult(bodies));
    if (missing.length === 0) continue;
    const area = batchAreaOf(b.body) ?? 'misc';
    const targets = new Set<number>();
    for (const item of missing) {
      const res = batchAdd({ area, key: item.key, title: item.title, details: item.body, maxItems: config.batchMaxItems });
      if (res.issue !== null) targets.add(res.issue);
    }
    comment(
      b.number,
      `${BATCH_RESCUE_MARKER}\n\nЗонтик закрыт, но ${missing.length} пункт(ов) не учтены в batch-result: ` +
        `${missing.map((i) => `\`${i.key}\``).join(', ')} — перенесены reconcile'ом в ${[...targets].map((n) => `#${n}`).join(', ') || 'новый зонтик'}.`,
    );
    console.log(`rescued ${missing.length} batch items from closed #${b.number}`);
    touched++;
  }

  console.log(`reconcile: ${touched} изменений`);
}

function renderDashboard(config: QueueConfig): string {
  const { issues, linked, links } = collect();
  const queuePrs = [...new Set([...linked.values()].map((p) => p.number))];
  const snap = snapshot(issues, config, countBackpressurePrs(links));
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Для зонтиков — счётчик пунктов: «размер» батча иначе не виден снаружи.
  const row = (i: QueueIssue) => {
    const batchNote = i.labels.includes(BATCH_LABEL)
      ? ` · 🧺 ${parseBatchItems(batchCommentBodies(i.number)).length} пунктов`
      : '';
    return `| ${priorityOf(i.labels) ?? '—'} | #${i.number} | ${i.title.replace(/\|/g, '\\|').slice(0, 90)}${batchNote} |`;
  };

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
 * Watchdog автономии (issue #573): живость AUTOMATION_TOKEN. Как и heartbeat —
 * только решения и запись маркер-комментариев на дашборд; сам вызов Telegram
 * (секреты) — в issue-queue.yml, отдельным шагом по JSON-выводу этой команды.
 * Дайджест needs-owner отсюда убран: hold-PR теперь приходит владельцу
 * кнопками в момент навешивания лейбла (decisions-sync), а напоминает о
 * зависших вечерний owner-digest.
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

    // Мёртвый токен — это действие владельца; кроме Telegram-алерта (шаг
    // workflow) заводим decision с пошаговой инструкцией и кнопкой «Готово».
    if (dead && !dryRun) {
      result.rotationDecision = postPatRotationDecision(
        'AUTOMATION_TOKEN мёртв — перевыпусти fine-grained PAT',
      );
    }

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
        result.rotationDecision = postPatRotationDecision(
          'Пора проверить срок AUTOMATION_TOKEN (fine-grained PAT живёт ≤90 дней)',
        );
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Decision «ротация PAT» — единственный легальный GitHub-заход владельца
 * (~2 мин раз в 90 дней), инструкция приходит кнопкой в Telegram. Дедуп
 * PENDING-решений того же kind — на стороне сервиса сайта. Сайт может лежать
 * или секрет не заведён — тогда честно возвращаем причину, алерт-шаг workflow
 * остаётся страховкой.
 */
function postPatRotationDecision(title: string): Record<string, unknown> {
  if (!process.env.OWNER_DECISIONS_SECRET) return { posted: false, reason: 'OWNER_DECISIONS_SECRET не задан' };
  try {
    const res = siteApi<{ id: string; created: boolean }>(DECISIONS_API, 'POST', {
      kind: 'pat-rotation',
      subjectType: 'none',
      subjectNumber: null,
      headSha: null,
      title,
      payload: {
        instructions:
          'GitHub → Settings → Developer settings → Fine-grained tokens → Generate new: ' +
          'repo Platform-Delovoy, permissions Contents (write) + Pull requests (write) + Actions (write), 90 дней. ' +
          'Значение вставить в Settings → Secrets and variables → Actions → AUTOMATION_TOKEN. ' +
          'После — кнопка «Готово» здесь.',
      },
    });
    return { posted: true, id: res.id, created: res.created };
  } catch (err) {
    return { posted: false, reason: String(err).slice(0, 200) };
  }
}

// ── Зонтики мелочи (CLI-обёртки над batch-io) ───────────────────────────────

function cmdBatchAdd(rest: string[]): void {
  let area = '';
  let key = '';
  let title = '';
  let details = '';
  const dryRun = rest.includes('--dry-run');
  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--area': area = rest[++i] ?? ''; break;
      case '--key': key = rest[++i] ?? ''; break;
      case '--title': title = rest[++i] ?? ''; break;
      case '--details': details = rest[++i] ?? ''; break;
      case '--dry-run': break;
      default: throw new Error(`неизвестный флаг «${rest[i]}»`);
    }
  }
  if (!area || !key || !title) throw new Error('нужны --area, --key и --title');
  const config = loadConfig();
  const res = batchAdd({ area, key, title, details: details || undefined, maxItems: config.batchMaxItems, dryRun });
  console.log(JSON.stringify(res, null, 2));
}

/**
 * Итог батча перед PR: машинно-читаемый список сделанного и перенесённого.
 * Отдельная команда по той же причине, что и `verdict`: формат маркеров живёт
 * в одном месте (scripts/lib/issue-batch.ts), а не в промпте.
 */
function cmdBatchResult(num: number, rest: string[]): void {
  let doneRaw = '';
  let carriedRaw = '';
  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--done': doneRaw = rest[++i] ?? ''; break;
      case '--carried': carriedRaw = rest[++i] ?? ''; break;
      default: throw new Error(`неизвестный флаг «${rest[i]}»`);
    }
  }
  const done = doneRaw
    ? doneRaw.split(',').map((k) => ({ key: k.trim() })).filter((d) => d.key)
    : [];
  // Формат --carried: "key" или "key=712" (номер зонтика, куда перенесён пункт).
  const carried = carriedRaw
    ? carriedRaw.split(',').map((part) => {
        const [k, to] = part.split('=');
        return { key: k.trim(), toIssue: to ? Number(to) : undefined };
      }).filter((c) => c.key)
    : [];
  if (done.length === 0 && carried.length === 0) throw new Error('нужен --done и/или --carried');
  comment(num, renderBatchResult(done, carried));
  console.log(`batch-result posted on #${num}: done=${done.length}, carried=${carried.length}`);
}

// ── Решения владельца: Telegram-кнопки вместо needs-owner-инбокса ───────────
//
// GitHub-креды есть только у Actions и сессий, поэтому контур такой:
// свипер (этот CLI из issue-queue-merge.yml) reconcile'ом заводит запросы
// решений на САЙТЕ (POST по секрету — паттерн release-notify), сайт шлёт
// владельцу личное Telegram-сообщение с кнопками, бот записывает решение в БД,
// а исполняет его снова свипер на следующем проходе. Сайт и бот GitHub не
// трогают вообще. Файлы контура — в HOLD_PATTERNS: это путь к мержу мимо
// гейта, автоматика не расширяет его сама.

const DECISIONS_BASE_URL = process.env.OWNER_DECISIONS_URL ?? 'https://delovoy-park.ru';
const DECISIONS_API = '/api/admin/owner-decisions';

/**
 * HTTP к сайту платформы. НЕ ghApi: тот в Actions прикладывает GH_TOKEN к
 * любому URL — светить GitHub-токен собственному сайту незачем. Тот же curl
 * (fetch игнорирует agent-proxy), свой секрет, жёсткий таймаут — сайт может
 * лежать, и свипер не должен висеть из-за него. Ответы сайта приходят в
 * конверте apiResponse ({success, data}) — распаковываем здесь.
 */
function siteApi<T = unknown>(path: string, method = 'GET', body?: unknown): T {
  const secret = process.env.OWNER_DECISIONS_SECRET;
  if (!secret) throw new Error('OWNER_DECISIONS_SECRET не задан');
  const args = [
    '-sS', '-X', method,
    '-H', `Authorization: Bearer ${secret}`,
    '-H', 'Accept: application/json',
    '--max-time', '20',
    '-w', '\n%{http_code}',
  ];
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  args.push(`${DECISIONS_BASE_URL}${path}`);
  let out: string;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    // Транспортный сбой (сайт лежит/DNS/TLS/таймаут): execFileSync кладёт в
    // err.message ПОЛНУЮ командную строку curl — вместе с Authorization-заголовком.
    // Наружу уходит только санитизированное сообщение: вызывающие места
    // сериализуют String(err) в JSON, который workflow печатает в лог и
    // step summary — секрету там не место.
    const e = err as { status?: number | null; signal?: string | null };
    throw new Error(
      `${method} ${path}: сайт недоступен (curl transport error, exit=${e.status ?? 'null'}${e.signal ? `, signal=${e.signal}` : ''})`,
    );
  }
  const nl = out.lastIndexOf('\n');
  const status = Number(out.slice(nl + 1));
  const text = out.slice(0, nl);
  if (status < 200 || status >= 300) {
    throw new Error(`${method} ${path} → ${status}: ${text.slice(0, 300)}`);
  }
  const parsed = text.trim() ? (JSON.parse(text) as { success?: boolean; data?: unknown }) : null;
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    if (!parsed.success) throw new Error(`${method} ${path}: сайт вернул success=false`);
    return parsed.data as T;
  }
  return parsed as T;
}

interface DecisionWire {
  id: string;
  kind: 'merge-hold' | 'blocked-question' | 'owner-idea' | 'pat-rotation' | string;
  subjectType: 'pr' | 'issue' | 'none' | string;
  subjectNumber: number | null;
  headSha: string | null;
  title: string;
  status: string;
  decision: 'approve' | 'reject' | null;
  note: string | null;
  payload: {
    reasons?: string[];
    url?: string;
    /** Для prod-apply: какой ops-workflow диспатчить после «да» владельца. */
    dispatchWorkflow?: string;
    dispatchInputs?: Record<string, string>;
    /** Для owner-idea: свободный текст идеи. */
    text?: string;
    prio?: string;
  } | null;
  decidedAt: string | null;
}

function patchDecision(id: string, status: string, note?: string): void {
  siteApi(DECISIONS_API, 'PATCH', { id, status, executorNote: note });
}

/** Исполнение одного принятого решения. Ошибки не глотаем — ловит вызывающий цикл. */
function executeDecision(d: DecisionWire, config: QueueConfig, now: Date, dryRun: boolean): Record<string, unknown> {
  const base = { id: d.id, kind: d.kind, decision: d.decision, subject: d.subjectNumber };

  if (d.kind === 'merge-hold') {
    const prNumber = d.subjectNumber;
    if (!prNumber) return { ...base, error: 'нет subjectNumber' };

    if (d.decision === 'approve') {
      if (!config.autoMerge) return { ...base, skipped: 'autoMerge=false — аварийный стоп глушит и решения' };
      // Grace-окно «Отменить»: мерж необратим, случайный тап по кнопке — нет.
      if (!d.decidedAt || !graceElapsed(d.decidedAt, now, config.decisionGraceMinutes)) {
        return { ...base, waiting: `grace ${config.decisionGraceMinutes} мин после аппрува ещё не прошёл` };
      }
      const pr = gh<{ state: string; merged: boolean; head: { sha: string } }>(`/repos/${REPO}/pulls/${prNumber}`);
      if (pr.merged || pr.state !== 'open') {
        if (!dryRun) patchDecision(d.id, 'EXECUTED', pr.merged ? 'PR уже смержен' : 'PR уже закрыт');
        return { ...base, executed: true, note: 'PR уже закрыт/смержен' };
      }
      if (!d.headSha || pr.head.sha !== d.headSha) {
        // Аппрув пинится к SHA момента решения — новые коммиты его гасят.
        // decisions-sync на этом же проходе заведёт свежий запрос под новый SHA.
        if (!dryRun) {
          patchDecision(d.id, 'EXPIRED', `head SHA изменился: ожидался ${d.headSha?.slice(0, 8)}, сейчас ${pr.head.sha.slice(0, 8)}`);
          comment(prNumber, `Аппрув владельца (Telegram) устарел: PR изменился после решения. Запрос уйдёт заново под новый коммит.`);
        }
        return { ...base, expired: true };
      }
      if (dryRun) return { ...base, dryRun: true, wouldMerge: true };
      const result = attemptMerge(prNumber, config, { promoteDraft: true, gateExempt: 'owner-approved', expectedSha: d.headSha });
      if (result.merged) {
        patchDecision(d.id, 'EXECUTED', 'смержен');
        comment(prNumber, `Смержено по решению владельца из Telegram (decision \`${d.id}\`).`);
        return { ...base, merged: true };
      }
      if (result.reason === 'head SHA изменился после решения') {
        patchDecision(d.id, 'EXPIRED', result.detail);
        return { ...base, expired: true, detail: result.detail };
      }
      // CI ещё идёт/красный — решение остаётся APPROVED, добьём на следующем проходе.
      return { ...base, deferredExecution: result.reason, detail: result.detail };
    }

    if (d.decision === 'reject') {
      if (dryRun) return { ...base, dryRun: true, wouldClose: true };
      gh(`/repos/${REPO}/pulls/${prNumber}`, 'PATCH', { state: 'closed' });
      comment(
        prNumber,
        `Отклонено владельцем из Telegram${d.note ? `: ${d.note}` : ''}. PR закрыт; связанная задача переведена в \`auto:blocked\` — нужна переформулировка.`,
      );
      const prRaw = gh<RawPr>(`/repos/${REPO}/pulls/${prNumber}`);
      for (const num of closedIssueNumbers(prRaw)) {
        try {
          const issue = gh<RawIssue>(`/repos/${REPO}/issues/${num}`);
          if (issue.state === 'open') {
            setLabels(num, swapLane(issue.labels.map((l) => l.name), 'auto:blocked'));
          }
        } catch { /* issue могла быть удалена — не роняем исполнение */ }
      }
      patchDecision(d.id, 'EXECUTED', 'PR закрыт');
      return { ...base, closed: true };
    }
  }

  if (d.kind === 'blocked-question') {
    const issueNumber = d.subjectNumber;
    if (dryRun) return { ...base, dryRun: true };
    if (d.decision === 'approve') {
      if (issueNumber) {
        const issue = gh<RawIssue>(`/repos/${REPO}/issues/${issueNumber}`);
        setLabels(issueNumber, swapLane(issue.labels.map((l) => l.name), 'auto:ready'));
        comment(issueNumber, `Владелец (Telegram): да${d.note ? ` — ${d.note}` : ''}. Задача возвращена в очередь (\`auto:ready\`).`);
      }
      // prod-apply: «да» владельца запускает соответствующий ops-workflow —
      // у токена свипера есть actions:write, ручной клик в Actions больше не нужен.
      if (d.payload?.dispatchWorkflow) {
        gh(`/repos/${REPO}/actions/workflows/${d.payload.dispatchWorkflow}/dispatches`, 'POST', {
          ref: 'main',
          inputs: d.payload.dispatchInputs ?? {},
        });
      }
      patchDecision(d.id, 'EXECUTED', d.payload?.dispatchWorkflow ? `dispatched ${d.payload.dispatchWorkflow}` : 'issue → auto:ready');
      return { ...base, executed: true };
    }
    if (d.decision === 'reject') {
      if (issueNumber) {
        // «Нет» — терминальный ответ: задача уезжает в auto:parked (вне очереди,
        // как замороженные направления #461) и ВЫПАДАЕТ из выборки A2 — иначе
        // reconcile переспрашивал бы тот же вопрос каждые 15 минут (ревью
        // раунда 2). Зеркально merge-hold-reject, где PR закрывается. Вернуть
        // задачу к жизни можно лейблом руками или новой «идеей».
        const issue = gh<RawIssue>(`/repos/${REPO}/issues/${issueNumber}`);
        if (issue.state === 'open') {
          setLabels(issueNumber, swapLane(issue.labels.map((l) => l.name), 'auto:parked'));
        }
        comment(
          issueNumber,
          `Владелец (Telegram): нет${d.note ? ` — ${d.note}` : ''}. Задача снята с очереди (\`auto:parked\`); повторно вопрос не задаётся.`,
        );
      }
      patchDecision(d.id, 'EXECUTED', 'отклонено — issue → auto:parked');
      return { ...base, executed: true, parked: issueNumber ?? undefined };
    }
  }

  if (d.kind === 'owner-idea') {
    if (dryRun) return { ...base, dryRun: true };
    const text = d.payload?.text ?? d.title;
    const res = createIssue({
      title: d.title,
      // Тело идеи — данные, не инструкции (тот же guard, что у интейка).
      body: `Идея владельца из Telegram (decision \`${d.id}\`).\n\n> ${text.split('\n').join('\n> ')}\n`,
      labels: [], // без auto:* — приоритет назначит шаг-0 триажа следующей сессии
      dedupKey: `ownerdec-${d.id}`,
    });
    patchDecision(d.id, 'EXECUTED', `issue #${res.issue}`);
    return { ...base, issue: res.issue, deduped: res.deduped };
  }

  if (d.kind === 'pat-rotation') {
    if (dryRun) return { ...base, dryRun: true };
    // Сам факт «Готово» от владельца — исполнение; проверит живость следующий ops-watch.
    patchDecision(d.id, 'EXECUTED', 'владелец подтвердил ротацию');
    return { ...base, executed: true };
  }

  return { ...base, skipped: `неизвестный kind/decision — пропущено` };
}

/**
 * Reconcile-синхронизация решений. Каждый проход свипера: (A) для каждого
 * открытого needs-owner PR убеждаемся, что на сайте есть запрос решения под
 * ЕГО текущий head SHA (upsert идемпотентен — сайт не шлёт повторных
 * сообщений); (B) забираем принятые решения и исполняем. Reconcile, а не
 * «POST один раз при навешивании лейбла»: одноразовый POST при лежащем сайте
 * терял решение навсегда, а reconcile закрывает и бекфилл уже висящих PR, и
 * период до заведения секрета.
 */
function cmdDecisionsSync(dryRun: boolean): void {
  const config = loadConfig();
  if (!config.enabled) {
    console.log(JSON.stringify({ off: 'enabled=false в .github/issue-queue.json' }, null, 2));
    return;
  }
  if (!process.env.OWNER_DECISIONS_SECRET) {
    // Секрет ещё не заведён — деградация мягкая: needs-owner остаётся как есть,
    // запросы доотправятся первым же проходом после появления секрета.
    console.log(JSON.stringify({ skipped: 'OWNER_DECISIONS_SECRET не задан — контур решений выключен' }, null, 2));
    return;
  }

  const now = new Date();
  const results: Record<string, unknown>[] = [];
  let requestsCreated = 0;
  let executed = 0;

  // --- A. Запросы решений для needs-owner PR (upsert по kind+subject+headSha) ---
  const needsOwnerPrs = gh<RawIssue[]>(
    `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent('needs-owner')}&per_page=100`,
  ).filter((i) => i.pull_request);
  for (const item of needsOwnerPrs) {
    try {
      const pr = gh<{ head: { sha: string }; html_url: string }>(`/repos/${REPO}/pulls/${item.number}`);
      let reasons: string[];
      try {
        reasons = classifyMergeGate(changedFiles(item.number), config, trustedCommentBodies(item.number)).reasons;
      } catch {
        reasons = ['не удалось перечитать причины гейта'];
      }
      if (dryRun) {
        results.push({ requestFor: item.number, headSha: pr.head.sha.slice(0, 8), dryRun: true });
        continue;
      }
      const res = siteApi<{ id: string; created: boolean }>(DECISIONS_API, 'POST', {
        kind: 'merge-hold',
        subjectType: 'pr',
        subjectNumber: item.number,
        headSha: pr.head.sha,
        title: item.title,
        payload: { reasons, url: pr.html_url },
      });
      if (res.created) requestsCreated++;
      results.push({ requestFor: item.number, id: res.id, created: res.created });
    } catch (err) {
      // Сайт лежит — мержи и остальная уборка не должны вставать из-за него.
      results.push({ requestFor: item.number, siteError: String(err).slice(0, 200) });
    }
  }

  // --- A2. Вопросы владельцу по заблокированным задачам ---
  // auto:blocked (нужны доступы/решение) и auto:prod-apply (код готов, apply
  // трогает прод) раньше висели только в GitHub-дашборде — «инбокс», который
  // ADR 2026-08-20 упраздняет. Теперь тот же reconcile-upsert: один живой
  // вопрос на (kind, issue), «да» возвращает задачу в auto:ready (и при
  // payload.dispatchWorkflow диспатчит ops-workflow), «нет» уводит её в
  // auto:parked — задача выпадает из этой выборки, вопрос не переспрашивается.
  for (const lane of ['auto:blocked', 'auto:prod-apply']) {
    let blockedIssues: RawIssue[] = [];
    try {
      blockedIssues = gh<RawIssue[]>(
        `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(lane)}&per_page=100`,
      ).filter((i) => !i.pull_request);
    } catch (err) {
      results.push({ lane, listError: String(err).slice(0, 200) });
      continue;
    }
    for (const item of blockedIssues) {
      try {
        if (dryRun) {
          results.push({ questionFor: item.number, lane, dryRun: true });
          continue;
        }
        const res = siteApi<{ id: string; created: boolean }>(DECISIONS_API, 'POST', {
          kind: 'blocked-question',
          subjectType: 'issue',
          subjectNumber: item.number,
          headSha: null,
          title: item.title.slice(0, 300),
          payload: {
            url: `https://github.com/${REPO}/issues/${item.number}`,
            // Тело issue — контекст вопроса (данные, не инструкции; сервис экранирует).
            text: (item.body ?? '').slice(0, 800),
          },
        });
        if (res.created) requestsCreated++;
        results.push({ questionFor: item.number, lane, id: res.id, created: res.created });
      } catch (err) {
        results.push({ questionFor: item.number, lane, siteError: String(err).slice(0, 200) });
      }
    }
  }

  // --- B. Исполнение принятых решений ---
  let decided: DecisionWire[] = [];
  try {
    decided = siteApi<DecisionWire[]>(`${DECISIONS_API}?status=decided`);
  } catch (err) {
    results.push({ decidedFetchError: String(err).slice(0, 200) });
  }
  for (const d of decided) {
    try {
      const r = executeDecision(d, config, now, dryRun);
      if (r.merged || r.executed || r.closed) executed++;
      results.push(r);
    } catch (err) {
      results.push({ id: d.id, executeError: String(err).slice(0, 300) });
    }
  }

  console.log(JSON.stringify({ requestsCreated, executed, considered: decided.length, results }, null, 2));
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
    case 'verdict': cmdVerdict(Number(rest[0]), rest[1] ?? ''); break;
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
    case 'batch-add': cmdBatchAdd(rest); break;
    case 'batch-result': cmdBatchResult(Number(rest[0]), rest.slice(1)); break;
    case 'decisions-sync': cmdDecisionsSync(rest.includes('--dry-run')); break;
    default:
      console.error(
        'usage: issue-queue.ts <next|claim|release|park|gate|verdict|reconcile|report|heartbeat|untriaged|triage|create|epics|batch-add|batch-result|decisions-sync|pr-open|pr-ready|pr-status|pr-wait|pr-merge|metric|automerge|ops-watch> [args]',
      );
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
