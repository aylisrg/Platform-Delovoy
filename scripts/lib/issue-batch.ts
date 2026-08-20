/**
 * Зонтики мелочи — чистая логика (I/O нет; сеть — в scripts/lib/batch-io.ts).
 *
 * Мелкая P2-задача больше не становится отдельной issue: она добавляется
 * ПУНКТОМ в открытый «зонтик» своей области — issue с лейблом `batch` и
 * маркером `<!-- batch:<area> -->` в теле. Пункты живут append-only
 * КОММЕНТАРИЯМИ с маркером `<!-- batch-item:<key> -->` — тело зонтика никто
 * не переписывает, поэтому гонки read-modify-write (ночной интейк против живой
 * сессии) теряют пункты не могут по построению.
 *
 * Воркер берёт зонтик обычным `claim` (лок, staleWip, maxAttempts — без
 * изменений), закрывает одним PR `Closes #N`, а перед PR публикует
 * batch-result комментарий: какие пункты сделаны, какие перенесены в следующий
 * зонтик. `reconcile` сверяет закрытые зонтики с их batch-result и механически
 * спасает необработанные пункты — молчаливых потерь сигналов не бывает.
 *
 * Файл сознательно вне HOLD_PATTERNS (прецедент queue-watch.ts): он не влияет
 * на решение о мерже, а мутирующая CLI-точка (scripts/issue-queue.ts) и так HOLD.
 */

/** Лейбл зонтика — для дешёвого поиска без сканирования всех тел. */
export const BATCH_LABEL = 'batch';

/** Комментарий reconcile «необработанные пункты спасены в новый зонтик» (дедуп повторного спасения). */
export const BATCH_RESCUE_MARKER = '<!-- batch-rescued -->';

const BATCH_MARKER_RE = /<!--\s*batch:([a-z0-9-]+)\s*-->/;
const BATCH_ITEM_RE = /<!--\s*batch-item:([a-zA-Z0-9._:-]+)\s*-->/;
const BATCH_RESULT_RE = /<!--\s*batch-result\s*-->/;
const BATCH_RESULT_DONE_RE = /<!--\s*batch-done:([a-zA-Z0-9._:-]+)\s*-->/g;
const BATCH_RESULT_CARRIED_RE = /<!--\s*batch-carried:([a-zA-Z0-9._:-]+)\s*-->/g;

/** Области зонтиков: модульные + служебные вёдра. */
export const BATCH_FALLBACK_AREAS = ['bot', 'infra', 'docs', 'perf', 'misc'] as const;

/** Нормализация произвольной строки области в slug зонтика. */
export function normalizeArea(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'misc';
}

/** Ключ пункта (дедуп): error-fingerprint, feedback-id, perf-роут, свободный slug. */
export function normalizeItemKey(raw: string): string {
  const key = raw.replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!key) throw new Error('пустой ключ пункта зонтика');
  return key;
}

export function batchMarker(area: string): string {
  return `<!-- batch:${normalizeArea(area)} -->`;
}

/** Область зонтика из тела issue; null — это не зонтик. */
export function batchAreaOf(body: string | null | undefined): string | null {
  const m = BATCH_MARKER_RE.exec(body ?? '');
  return m ? m[1] : null;
}

export function batchIssueTitle(area: string): string {
  return `🧺 Мелочь: ${normalizeArea(area)} — батч P2-фиксов`;
}

/** Тело зонтика — только шапка; пункты живут в комментариях (append-only). */
export function renderBatchBody(area: string): string {
  const a = normalizeArea(area);
  return [
    batchMarker(a),
    '',
    `Зонтик мелких P2-задач области \`${a}\`. **Пункты — в комментариях** с маркером`,
    '`batch-item` (append-only: пункты не редактируются и не теряются).',
    '',
    'Воркер закрывает зонтик целиком одним PR; невытянутые пункты переносит в',
    'следующий зонтик batch-result-комментарием. Отдельные issues из этой мелочи',
    'не делаем — правило гранулярности в CLAUDE.md (раздел «Автоочередь»).',
    '',
    'Пункт добавляется командой:',
    '```bash',
    `npx tsx scripts/issue-queue.ts batch-add --area ${a} --key <дедуп-ключ> --title "..." [--details "..."]`,
    '```',
  ].join('\n');
}

export interface BatchItem {
  key: string;
  title: string;
  /** Полное тело комментария-пункта (детали для воркера). */
  body: string;
}

/** Комментарий-пункт. Первая строка после маркера — заголовок пункта. */
export function renderBatchItemComment(key: string, title: string, details?: string): string {
  const lines = [`<!-- batch-item:${normalizeItemKey(key)} -->`, `**${title.trim()}**`];
  if (details?.trim()) {
    lines.push('', details.trim());
  }
  return lines.join('\n');
}

/** Пункты зонтика из тел его комментариев (в порядке следования). */
export function parseBatchItems(commentBodies: string[]): BatchItem[] {
  const items: BatchItem[] = [];
  for (const body of commentBodies) {
    const m = BATCH_ITEM_RE.exec(body);
    if (!m) continue;
    const afterMarker = body.slice(body.indexOf(m[0]) + m[0].length).trim();
    const title = (afterMarker.split('\n')[0] ?? '').replace(/^\*\*|\*\*$/g, '').trim();
    items.push({ key: m[1], title: title || m[1], body });
  }
  return items;
}

/** Есть ли уже пункт с таким ключом (дедуп повторного batch-add). */
export function hasBatchItem(commentBodies: string[], key: string): boolean {
  const k = normalizeItemKey(key);
  return parseBatchItems(commentBodies).some((i) => i.key === k);
}

/** Зонтик полон — новую мелочь класть в следующий. */
export function batchIsFull(itemCount: number, maxItems: number): boolean {
  return itemCount >= maxItems;
}

export interface BatchResult {
  /** batch-result комментарий найден вообще. */
  found: boolean;
  doneKeys: string[];
  carriedKeys: string[];
}

/**
 * Итоговый комментарий воркера перед PR: машинно-читаемый список сделанного и
 * перенесённого. По нему reconcile отличает «зонтик закрыт честно» от «сессия
 * забыла пункты» — и спасает забытое в новый зонтик.
 */
export function renderBatchResult(
  done: { key: string; note?: string }[],
  carried: { key: string; toIssue?: number }[],
): string {
  const lines = ['<!-- batch-result -->', '**Итог батча:**', ''];
  for (const d of done) {
    lines.push(`- [x] \`${normalizeItemKey(d.key)}\`${d.note ? ` — ${d.note}` : ''} <!-- batch-done:${normalizeItemKey(d.key)} -->`);
  }
  for (const c of carried) {
    lines.push(
      `- [ ] \`${normalizeItemKey(c.key)}\` — перенесён${c.toIssue ? ` в #${c.toIssue}` : ''} <!-- batch-carried:${normalizeItemKey(c.key)} -->`,
    );
  }
  return lines.join('\n');
}

export function parseBatchResult(commentBodies: string[]): BatchResult {
  const resultBodies = commentBodies.filter((b) => BATCH_RESULT_RE.test(b));
  if (resultBodies.length === 0) return { found: false, doneKeys: [], carriedKeys: [] };
  const doneKeys: string[] = [];
  const carriedKeys: string[] = [];
  for (const body of resultBodies) {
    for (const m of body.matchAll(BATCH_RESULT_DONE_RE)) doneKeys.push(m[1]);
    for (const m of body.matchAll(BATCH_RESULT_CARRIED_RE)) carriedKeys.push(m[1]);
  }
  return { found: true, doneKeys: [...new Set(doneKeys)], carriedKeys: [...new Set(carriedKeys)] };
}

/**
 * Пункты закрытого зонтика, не учтённые в batch-result (или все — если
 * batch-result отсутствует). Их reconcile переносит в новый зонтик.
 */
export function unprocessedBatchItems(items: BatchItem[], result: BatchResult): BatchItem[] {
  if (!result.found) return items;
  const accounted = new Set([...result.doneKeys, ...result.carriedKeys]);
  return items.filter((i) => !accounted.has(i.key));
}
