/**
 * Чистая часть CLI недельного отчёта (`scripts/funnel-weekly.ts`, ADR
 * 2026-09-16-weekly-product-analyst-loop): разбор аргументов, валидация
 * дат/воронок/шагов и раскладка релизов по дням МСК.
 *
 * I/O здесь нет намеренно — то же разделение, что у `owner-digest.ts`:
 * в `scripts/lib/` живёт то, что покрывается тестами без сети и файлов.
 */
import { z } from 'zod';
import { FUNNELS, FUNNEL_KEYS, type FunnelKey } from '../../src/modules/analytics/funnels';

export type Flags = Record<string, string | true>;

/** `--key value` → строка, `--flag` → true. Неизвестный позиционный токен — ошибка. */
export function parseFlags(rest: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`неизвестный аргумент «${token}»`);
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function requireString(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`нужен --${name}`);
  return value;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ожидаю дату в формате YYYY-MM-DD');
const funnelSchema = z.enum(FUNNEL_KEYS);

export function parseDate(value: string, name: string): string {
  const parsed = dateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`--${name}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export function parseFunnel(value: string): FunnelKey {
  const parsed = funnelSchema.safeParse(value);
  if (!parsed.success) throw new Error(`--funnel «${value}» — ожидаю один из: ${FUNNEL_KEYS.join(', ')}`);
  return parsed.data;
}

/** Шаг валиден только в пределах своей воронки — каталог `funnels.ts` решает. */
export function parseStep(funnel: FunnelKey, value: string): string {
  const steps: string[] = FUNNELS[funnel].steps.map((s) => s.step);
  if (!steps.includes(value)) {
    throw new Error(`--step «${value}» — у воронки ${funnel} есть только: ${steps.join(', ')}`);
  }
  return value;
}

/** Europe/Moscow — фиксированный UTC+3 без DST, поэтому сдвиг, а не Intl. */
export function mskDate(date: Date): string {
  return new Date(date.getTime() + 3 * 3.6e6).toISOString().slice(0, 10);
}

export type MergedPr = { number: number; title: string; merged_at: string | null };

/**
 * Merged PR отчётной недели по дням МСК (AC-2.2). Немерженые и всё, что вне
 * периода, отбрасывается; дни и PR внутри дня — по возрастанию, чтобы отчёт
 * был воспроизводим при любом порядке выдачи API.
 */
export function groupReleasesByDay(
  prs: MergedPr[],
  period: { dateFrom: string; dateTo: string },
): { date: string; prs: { number: number; title: string }[] }[] {
  const byDay = new Map<string, { number: number; title: string }[]>();
  for (const pr of prs) {
    if (!pr.merged_at) continue;
    const day = mskDate(new Date(pr.merged_at));
    if (day < period.dateFrom || day > period.dateTo) continue;
    const list = byDay.get(day) ?? [];
    if (!list.some((p) => p.number === pr.number)) list.push({ number: pr.number, title: pr.title });
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, prs: list.sort((a, b) => a.number - b.number) }));
}
