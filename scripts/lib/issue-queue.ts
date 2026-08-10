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
}

export const DEFAULT_CONFIG: QueueConfig = {
  enabled: true,
  autoMerge: true,
  maxOpenPrs: 2,
  pinned: [],
  staleWipHours: 6,
};

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function laneOf(labels: string[]): Lane {
  // Порядок проверок — это приоритет: `wip` важнее `ready`, потому что при гонке
  // (оба лейбла проставлены) issue должна выглядеть занятой, а не свободной.
  if (labels.includes('auto:wip')) return 'wip';
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
    if (i.hasOpenPr) return false; // PR есть — работа реально идёт, лок законный
    return now.getTime() - new Date(i.updatedAt).getTime() > cutoffMs;
  });
}

// ── Merge gate ──────────────────────────────────────────────────────────────
//
// Мерж в main запускает CI → deploy.yml → прод. Значит «замержить автоматически»
// буквально означает «выкатить в прод без человека». Поэтому изменения делятся на
// два класса: обратимый код приложения (мержим) и всё, что меняет саму
// инфраструктуру или схему БД (PR готовим, мерж ждёт владельца).

/** Пути, мерж которых меняет прод-инфру или схему БД — авто-мерж запрещён. */
export const HOLD_PATTERNS: RegExp[] = [
  /^prisma\/migrations\//,
  /^prisma\/schema\.prisma$/,
  /^infra\//,
  /^docker-compose.*\.ya?ml$/,
  /^Dockerfile/,
  /^\.github\/workflows\/(deploy|ops-|timeweb-|release)/,
  // Автоматизация не мержит сама себя без присмотра.
  /^\.github\/workflows\/issue-queue\.yml$/,
  /^\.github\/issue-queue\.json$/,
  /^scripts\/(deploy|restore|backup|pre-migration|apply-nginx)/,
];

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
 */
export function classifyMergeGate(changedFiles: string[], config: QueueConfig): MergeGate {
  const reasons: string[] = [];

  if (!config.autoMerge) {
    reasons.push('авто-мерж выключен в .github/issue-queue.json');
  }

  for (const pattern of HOLD_PATTERNS) {
    const hit = changedFiles.filter((f) => pattern.test(f));
    if (hit.length > 0) {
      reasons.push(`трогает прод-инфру/схему: ${hit.slice(0, 3).join(', ')}`);
    }
  }

  const modules = [...new Set(changedFiles.map(moduleOf).filter((m): m is string => m !== null))].sort();
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
  /** Завершились и ни один не упал. */
  green: boolean;
}

export function summarizeChecks(runs: CheckRun[]): ChecksSummary {
  const pending = runs.filter((r) => r.status !== 'completed');
  const failed = runs.filter(
    (r) => r.status === 'completed' && !PASSING_CONCLUSIONS.has(r.conclusion ?? ''),
  );
  return {
    pending,
    failed,
    done: pending.length === 0,
    green: pending.length === 0 && failed.length === 0,
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
    ready: [], wip: [], blocked: [], 'prod-apply': [], epic: [], parked: [], untriaged: [],
  } as Record<Lane, QueueIssue[]>;
  for (const issue of issues) byLane[laneOf(issue.labels)].push(issue);

  return {
    byLane,
    ordered: orderQueue(byLane.ready, config),
    next: pickNext(issues, config, openQueuePrCount),
  };
}
