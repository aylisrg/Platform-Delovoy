/**
 * Autonomous issue-cleanup queue — pure logic.
 *
 * Очередь целиком живёт в лейблах GitHub: отдельной БД или файла состояния нет.
 * Это осознанно — состояние видно владельцу в интерфейсе issues, правится руками
 * в один клик и переживает потерю любой сессии агента.
 *
 * Слои лейблов:
 *   prio:P0 | prio:P1 | prio:P2   — что важнее
 *   auto:ready                     — воркер может брать
 *   auto:wip                       — взято (лок; снимается ресуществлением)
 *   auto:blocked                   — нужны доступы/решение владельца
 *   auto:prod-apply                — код автоматизируем, финальный apply трогает прод
 *   auto:epic | auto:parked        — вне очереди
 *
 * I/O нет ни в одной функции этого файла — всё вызывается из scripts/issue-queue.ts.
 */

export type Lane =
  | 'ready'
  | 'wip'
  | 'review'
  | 'blocked'
  | 'prod-apply'
  | 'epic'
  | 'parked'
  | 'untriaged';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface QueueIssue {
  number: number;
  title: string;
  labels: string[];
  updatedAt: string;
  /** Есть открытый PR, который закрывает эту issue. */
  hasOpenPr: boolean;
}

export interface QueueConfig {
  /** Главный рубильник: false — воркер не берёт ничего. */
  enabled: boolean;
  /** Разрешать авто-мерж PR-ов уровня `auto` (мерж в main = деплой в прод). */
  autoMerge: boolean;
  /** Backpressure: сколько PR-ов очереди может висеть открытыми одновременно. */
  maxOpenPrs: number;
  /** Явный порядок в голове очереди. Остальное — по (приоритет, номер). */
  pinned: number[];
  /** Через сколько часов молчания `auto:wip` считается протухшим локом. */
  staleWipHours: number;
  /**
   * Сколько раз задачу можно подобрать и бросить, прежде чем снять её с очереди.
   * Без этого потолка задача, которую воркер не вытягивает, крутится вечно и жжёт бюджет.
   */
  maxAttempts: number;
  /** Через сколько часов без PR-активности очереди считать её простаивающей. */
  heartbeatIdleHours: number;
  /** Не слать повторный алерт о простое чаще, чем раз в столько часов. */
  heartbeatCooldownHours: number;
}

export const DEFAULT_CONFIG: QueueConfig = {
  enabled: true,
  autoMerge: true,
  maxOpenPrs: 2,
  pinned: [],
  staleWipHours: 6,
  maxAttempts: 3,
  heartbeatIdleHours: 3,
  heartbeatCooldownHours: 12,
};

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function laneOf(labels: string[]): Lane {
  // Порядок проверок — это приоритет: `wip` важнее `ready`, потому что при гонке
  // (оба лейбла проставлены) issue должна выглядеть занятой, а не свободной.
  if (labels.includes('auto:wip')) return 'wip';
  // `review` проверяется до остальных: PR уже открыт и ждёт человека, живой
  // сессии за задачей нет — очередь не должна считать её ни свободной, ни занятой.
  if (labels.includes('auto:review')) return 'review';
  if (labels.includes('auto:epic')) return 'epic';
  if (labels.includes('auto:parked')) return 'parked';
  if (labels.includes('auto:blocked')) return 'blocked';
  if (labels.includes('auto:prod-apply')) return 'prod-apply';
  if (labels.includes('auto:ready')) return 'ready';
  return 'untriaged';
}

export function priorityOf(labels: string[]): Priority | null {
  for (const p of Object.keys(PRIORITY_ORDER) as Priority[]) {
    if (labels.includes(`prio:${p}`)) return p;
  }
  return null;
}

/** Issue, которую воркер имеет право взять прямо сейчас. */
export function isEligible(issue: QueueIssue): boolean {
  return laneOf(issue.labels) === 'ready' && !issue.hasOpenPr;
}

/**
 * Полный порядок очереди: сначала закреплённые (в порядке `pinned`), затем всё
 * остальное по приоритету, затем по номеру — старое вперёд. Без приоритета — в хвост.
 */
export function orderQueue(issues: QueueIssue[], config: QueueConfig): QueueIssue[] {
  const pinnedRank = new Map(config.pinned.map((n, i) => [n, i]));

  return [...issues].sort((a, b) => {
    const pa = pinnedRank.get(a.number);
    const pb = pinnedRank.get(b.number);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;

    const ra = priorityOf(a.labels);
    const rb = priorityOf(b.labels);
    const na = ra ? PRIORITY_ORDER[ra] : Number.MAX_SAFE_INTEGER;
    const nb = rb ? PRIORITY_ORDER[rb] : Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;

    return a.number - b.number;
  });
}

export type PickResult =
  | { issue: QueueIssue; reason: null }
  | { issue: null; reason: string };

/**
 * Что воркер берёт в этот запуск. Возвращает причину отказа, а не пустоту —
 * причина уходит в дашборд, иначе «воркер ничего не сделал» неотличимо от поломки.
 */
export function pickNext(
  issues: QueueIssue[],
  config: QueueConfig,
  openQueuePrCount: number,
): PickResult {
  if (!config.enabled) {
    return { issue: null, reason: 'очередь выключена (.github/issue-queue.json → enabled=false)' };
  }
  if (openQueuePrCount >= config.maxOpenPrs) {
    return {
      issue: null,
      reason: `backpressure: открыто ${openQueuePrCount} PR-ов очереди при лимите ${config.maxOpenPrs} — сначала домержить`,
    };
  }
  // Строгая сериализация: одна живая сессия за раз. `auto:review` сюда НЕ входит —
  // там PR уже открыт и ждёт владельца, живой сессии за задачей нет. Иначе один
  // PR уровня hold, который владелец не посмотрел, останавливал бы очередь навсегда.
  const wip = issues.filter((i) => laneOf(i.labels) === 'wip');
  if (wip.length > 0) {
    return {
      issue: null,
      reason: `уже в работе: ${wip.map((i) => `#${i.number}`).join(', ')} — параллельные сессии не запускаем`,
    };
  }
  const eligible = orderQueue(issues.filter(isEligible), config);
  if (eligible.length === 0) {
    return { issue: null, reason: 'нет issues в состоянии auto:ready без открытого PR' };
  }
  return { issue: eligible[0], reason: null };
}

/**
 * Протухшие локи: сессия умерла, не сняв `auto:wip`, и PR так и не появился.
 * Без этого одна упавшая сессия останавливает очередь навсегда.
 */
export function staleWipIssues(
  issues: QueueIssue[],
  config: QueueConfig,
  now: Date,
): QueueIssue[] {
  const cutoffMs = config.staleWipHours * 60 * 60 * 1000;
  return issues.filter((i) => {
    if (laneOf(i.labels) !== 'wip') return false;
    if (i.hasOpenPr) return false; // PR есть — этот случай разбирает staleWipWithPr
    return now.getTime() - new Date(i.updatedAt).getTime() > cutoffMs;
  });
}

/**
 * Локи, у которых PR открыт, но мёртв: сессия умерла после pr-open, и PR
 * перестал обновляться. Живая сессия держит `updated_at` PR-а свежим пушами и
 * комментариями; сам issue при этом может не обновляться часами — поэтому
 * свежесть меряется именно по PR. Такие задачи уезжают в `auto:review`:
 * PR остаётся ждать человека или следующую сессию, а очередь идёт дальше.
 */
export function staleWipWithPr(
  issues: QueueIssue[],
  prUpdatedAt: Map<number, string>,
  config: QueueConfig,
  now: Date,
): QueueIssue[] {
  const cutoffMs = config.staleWipHours * 60 * 60 * 1000;
  return issues.filter((i) => {
    if (laneOf(i.labels) !== 'wip' || !i.hasOpenPr) return false;
    const updated = prUpdatedAt.get(i.number);
    if (!updated) return false;
    return now.getTime() - new Date(updated).getTime() > cutoffMs;
  });
}

// ── Маркеры служебных комментариев ──────────────────────────────────────────
//
// Всё состояние очереди, которому нужна история (попытки, алерты, парковки),
// живёт в её же комментариях с HTML-маркерами — отдельной БД нет намеренно.

/** Комментарий «лок снят, задача возвращена в очередь» — считается попыткой. */
export const STALE_MARKER = '<!-- issue-queue-stale-release -->';
/** Терминальный комментарий «снята с очереди» — сбрасывает счётчик попыток. */
export const GIVEUP_MARKER = '<!-- issue-queue-gave-up -->';
/** Комментарий «сессия умерла после pr-open, задача припаркована». */
export const STALE_PR_MARKER = '<!-- issue-queue-parked-stale-pr -->';
/** Комментарий-алерт heartbeat на дашборде (дедуп повторных алертов). */
export const HEARTBEAT_MARKER = '<!-- issue-queue-heartbeat -->';
/** Комментарий «эпик разобран на задачи» — /plan-epic второй раз не приходит. */
export const EPIC_PLANNED_MARKER = '<!-- epic-planned -->';
/** Фраза старых терминальных комментариев (до появления GIVEUP_MARKER). */
const LEGACY_GIVEUP = 'Задача снята с автоочереди';

/**
 * Сколько попыток «подобрали и бросили» накопилось у задачи.
 * Считаются только stale-комментарии ПОСЛЕ последнего give-up: иначе задача,
 * которую владелец вернул в очередь после `auto:blocked`, мгновенно блокируется
 * обратно старыми маркерами — счётчик был бы дверью в один конец.
 */
export function countAttempts(commentBodiesInOrder: string[]): number {
  let attempts = 0;
  for (const body of commentBodiesInOrder) {
    if (body.includes(GIVEUP_MARKER) || body.includes(LEGACY_GIVEUP)) {
      attempts = 0; // give-up закрывает эпоху; сам он попыткой не считается
      continue;
    }
    if (body.includes(STALE_MARKER)) attempts++;
  }
  return attempts;
}

// ── Backpressure ────────────────────────────────────────────────────────────

export interface PrLink {
  prNumber: number;
  /** Ветка PR принадлежит очереди (`claude/issue-*`, `claude/epic-*`). */
  queueBranch: boolean;
  /** Lanes открытых issues, которые этот PR закрывает; пусто — сирота. */
  issueLanes: Lane[];
}

/** Ветки, PR-ы с которых принадлежат автоочереди. */
export const QUEUE_BRANCH_RE = /^claude\/(?:issue|epic)-/;

/**
 * Сколько открытых PR-ов реально давят на очередь.
 *
 * Давление создают только PR-ы, за которыми очередь должна прийти снова:
 * связанные с issue в `ready|wip|untriaged`, либо сироты на ветках очереди
 * (issue закрыта или не найдена — консервативно считаем). PR-ы, чьи issues все
 * в `review|blocked|prod-apply|epic|parked`, — это инбокс владельца: они ждут
 * человека, и очередь из-за них вставать не должна. Иначе два припаркованных
 * hold-PR замораживают всё — ровно то, от чего `park` и должен был спасать.
 * Чужие PR-ы (release-please, dependabot, ручные ветки) — не давление.
 */
export function countBackpressurePrs(links: PrLink[]): number {
  const pressing = new Set<number>();
  for (const link of links) {
    const pressure =
      link.issueLanes.some((lane) => lane === 'ready' || lane === 'wip' || lane === 'untriaged') ||
      (link.issueLanes.length === 0 && link.queueBranch);
    if (pressure) pressing.add(link.prNumber);
  }
  return pressing.size;
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export interface HeartbeatInput {
  enabled: boolean;
  readyCount: number;
  wipCount: number;
  /** `updated_at` самого свежего PR очереди (state=all); null — PR-ов не было. */
  lastQueuePrActivityAt: string | null;
  /** Время последнего heartbeat-алерта; null — алертов ещё не было. */
  lastAlertAt: string | null;
  now: Date;
  idleHours: number;
  cooldownHours: number;
}

/**
 * Исполнитель очереди — смертная интерактивная сессия, и «очередь стоит» сам
 * никто не заметит. Алерт уходит, когда есть что брать, никто не работает,
 * PR-активности давно нет — и мы не спамили этим же алертом только что.
 */
export function shouldHeartbeat(i: HeartbeatInput): { alert: boolean; reason: string } {
  const hoursSince = (iso: string) => (i.now.getTime() - new Date(iso).getTime()) / 3.6e6;

  if (!i.enabled) return { alert: false, reason: 'очередь выключена' };
  if (i.readyCount === 0) return { alert: false, reason: 'очередь пуста — простой законный' };
  if (i.wipCount > 0) return { alert: false, reason: 'есть задача в работе' };
  if (i.lastQueuePrActivityAt !== null && hoursSince(i.lastQueuePrActivityAt) <= i.idleHours) {
    return { alert: false, reason: `PR-активность была ${hoursSince(i.lastQueuePrActivityAt).toFixed(1)} ч назад` };
  }
  if (i.lastAlertAt !== null && hoursSince(i.lastAlertAt) <= i.cooldownHours) {
    return { alert: false, reason: `алерт уже был ${hoursSince(i.lastAlertAt).toFixed(1)} ч назад — кулдаун` };
  }
  return {
    alert: true,
    reason: `очередь простаивает: ready=${i.readyCount}, wip=0, PR-активности нет дольше ${i.idleHours} ч`,
  };
}

// ── Триаж ───────────────────────────────────────────────────────────────────

/**
 * Инцидент-лейблы watchdog'ов. Такие issues живут своим циклом (открылась при
 * падении — закрылась при восстановлении) и в очередь не попадают; в бэклог
 * их превращает эскалация повторов (scripts/escalate-incidents.ts).
 */
export const INCIDENT_LABELS = ['site-down', 'notifications-down', 'ci-failure'] as const;

/** Issue, которую должен разобрать автоматический триаж. */
export function isUntriaged(issue: QueueIssue): boolean {
  if (laneOf(issue.labels) !== 'untriaged') return false;
  // `auto:dashboard` — не lane, laneOf его не видит; исключаем явно.
  if (issue.labels.includes('auto:dashboard')) return false;
  if (issue.labels.some((l) => (INCIDENT_LABELS as readonly string[]).includes(l))) return false;
  return true;
}

export function untriagedIssues(issues: QueueIssue[]): QueueIssue[] {
  return issues.filter(isUntriaged).sort((a, b) => a.number - b.number);
}

// ── Merge gate ──────────────────────────────────────────────────────────────
//
// Мерж в main запускает CI → deploy.yml → прод, то есть «замержить автоматически»
// буквально означает «выкатить в прод без человека». По решению владельца от
// 2026-08-11 катим сами: инфраструктура, деплой-workflow'ы и аддитивные миграции
// уехали в авто-мерж. Защита — CI, два ревью-агента, blue-green, снапшот VPS,
// бэкап БД, smoke-тесты и автооткат.
//
// Тормоз остался ровно на двух классах, и оба — про необратимость.

/**
 * Пути, которые автоматика не мержит сама: это её собственные рубильники.
 * Сюда входит и реализация гейта — иначе защита циклична: агент мог бы ослабить
 * правило и тем же прогоном замержить это ослабление.
 */
export const HOLD_PATTERNS: RegExp[] = [
  /^\.github\/workflows\/issue-queue\.yml$/,
  /^\.github\/issue-queue\.json$/,
  /^scripts\/lib\/issue-queue\.ts$/,
  /^scripts\/issue-queue\.ts$/,
  // Интейк чеканит auto:ready-issues из внешних данных (фидбек, client-beacon) —
  // менять его правила без присмотра автоматика не должна.
  /^\.github\/workflows\/backlog-intake\.yml$/,
];

/**
 * SQL, который теряет данные. Код откатывается коммитом, а неудачно выполненный
 * DROP — только восстановлением бэкапа, то есть с окном потерь. Поэтому
 * деструктивные миграции остаются человеку, а аддитивные (CREATE TABLE,
 * ADD COLUMN, CREATE INDEX) мержатся сами.
 */
const DESTRUCTIVE_SQL: { pattern: RegExp; what: string }[] = [
  { pattern: /\bDROP\s+TABLE\b/i, what: 'DROP TABLE' },
  { pattern: /\bDROP\s+COLUMN\b/i, what: 'DROP COLUMN' },
  { pattern: /\bDROP\s+(?:SCHEMA|DATABASE)\b/i, what: 'DROP SCHEMA/DATABASE' },
  { pattern: /\bTRUNCATE\b/i, what: 'TRUNCATE' },
  { pattern: /\bDELETE\s+FROM\b/i, what: 'DELETE FROM' },
  { pattern: /\bALTER\s+TYPE\b/i, what: 'ALTER TYPE' },
  { pattern: /\bSET\s+NOT\s+NULL\b/i, what: 'SET NOT NULL' },
  { pattern: /\bDROP\s+CONSTRAINT\b/i, what: 'DROP CONSTRAINT' },
];

/**
 * Ищет деструктивный SQL в диффе миграции. На вход — `patch` из GitHub API,
 * поэтому считаются только добавленные строки: удаление старой миграции из
 * истории (строки с `-`) ничего в проде не роняет.
 */
export function destructiveSqlIn(patch: string): string[] {
  const added = patch
    .split('\n')
    .filter((l) => l.startsWith('+'))
    .join('\n');
  return DESTRUCTIVE_SQL.filter(({ pattern }) => pattern.test(added)).map((d) => d.what);
}

export interface ChangedFile {
  filename: string;
  /** Дифф файла; у бинарных и слишком больших файлов GitHub его не отдаёт. */
  patch?: string;
}

export interface MergeGate {
  tier: 'auto' | 'hold';
  reasons: string[];
  modules: string[];
}

/** К какому модулю относится файл — для правила «PR трогает 5+ модулей = scope creep». */
export function moduleOf(file: string): string | null {
  const m =
    /^src\/modules\/([^/]+)\//.exec(file) ??
    /^src\/app\/api\/([^/]+)\//.exec(file) ??
    /^src\/app\/\(admin\)\/admin\/([^/]+)\//.exec(file);
  return m ? m[1] : null;
}

/**
 * Решение о том, можно ли этот PR мержить автоматически.
 * Строго: любая одна причина из списка переводит PR в `hold`.
 *
 * Принимает и просто имена файлов, и объекты с `patch` — дифф нужен, чтобы
 * отличить аддитивную миграцию от деструктивной. Без диффа миграция считается
 * безопасной: GitHub не отдаёт `patch` для слишком больших файлов, и ронять на
 * этом всю очередь неправильно — CI и ревью-агенты остаются на месте.
 */
export function classifyMergeGate(
  changedFiles: (string | ChangedFile)[],
  config: QueueConfig,
): MergeGate {
  const files: ChangedFile[] = changedFiles.map((f) => (typeof f === 'string' ? { filename: f } : f));
  const names = files.map((f) => f.filename);
  const reasons: string[] = [];

  if (!config.autoMerge) {
    reasons.push('авто-мерж выключен в .github/issue-queue.json');
  }

  for (const pattern of HOLD_PATTERNS) {
    const hit = names.filter((f) => pattern.test(f));
    if (hit.length > 0) {
      reasons.push(`трогает рубильники самой автоматики: ${hit.slice(0, 3).join(', ')}`);
    }
  }

  for (const file of files) {
    if (!/^prisma\/migrations\//.test(file.filename) || !file.patch) continue;
    const found = destructiveSqlIn(file.patch);
    if (found.length > 0) {
      reasons.push(`деструктивная миграция ${file.filename}: ${found.join(', ')} — потеря данных необратима`);
    }
  }

  const modules = [...new Set(names.map(moduleOf).filter((m): m is string => m !== null))].sort();
  if (modules.length >= 5) {
    reasons.push(`scope creep: затронуто ${modules.length} модулей (${modules.join(', ')}) — правило CLAUDE.md #5`);
  }

  return { tier: reasons.length === 0 ? 'auto' : 'hold', reasons, modules };
}

// ── Состояние CI ────────────────────────────────────────────────────────────

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

/** `skipped`/`neutral` — не провал: джобы CI намеренно пропускаются по условиям в ci.yml. */
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export interface ChecksSummary {
  pending: CheckRun[];
  failed: CheckRun[];
  /** Все чеки завершились — дальше ждать нечего. */
  done: boolean;
  /** Завершились, ни один не упал, и их было не ноль. */
  green: boolean;
}

export function summarizeChecks(runs: CheckRun[]): ChecksSummary {
  const pending = runs.filter((r) => r.status !== 'completed');
  const failed = runs.filter(
    (r) => r.status === 'completed' && !PASSING_CONCLUSIONS.has(r.conclusion ?? ''),
  );
  // Пустой список — это «CI ещё не зарегистрировал прогон», а не «всё прошло».
  // Сразу после push чеков секунду-другую нет вообще; посчитать это зелёным
  // значит разрешить мерж кода, который никто не проверял.
  const registered = runs.length > 0;
  return {
    pending,
    failed,
    done: registered && pending.length === 0,
    green: registered && pending.length === 0 && failed.length === 0,
  };
}

// ── Дашборд ─────────────────────────────────────────────────────────────────

export interface QueueSnapshot {
  byLane: Record<Lane, QueueIssue[]>;
  ordered: QueueIssue[];
  next: PickResult;
}

export function snapshot(
  issues: QueueIssue[],
  config: QueueConfig,
  openQueuePrCount: number,
): QueueSnapshot {
  const byLane = {
    ready: [], wip: [], review: [], blocked: [], 'prod-apply': [], epic: [], parked: [], untriaged: [],
  } as Record<Lane, QueueIssue[]>;
  for (const issue of issues) byLane[laneOf(issue.labels)].push(issue);

  return {
    byLane,
    ordered: orderQueue(byLane.ready, config),
    next: pickNext(issues, config, openQueuePrCount),
  };
}
