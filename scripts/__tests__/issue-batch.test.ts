import { describe, it, expect } from 'vitest';
import {
  batchAreaOf,
  batchIsFull,
  batchIssueTitle,
  batchMarker,
  hasBatchItem,
  normalizeArea,
  normalizeItemKey,
  parseBatchItems,
  parseBatchResult,
  renderBatchBody,
  renderBatchItemComment,
  renderBatchResult,
  unprocessedBatchItems,
} from '../lib/issue-batch';

describe('normalizeArea / normalizeItemKey', () => {
  it('приводит область к slug', () => {
    expect(normalizeArea('PS-Park')).toBe('ps-park');
    expect(normalizeArea('cron.notifications')).toBe('cron-notifications');
    expect(normalizeArea('  ')).toBe('misc');
  });

  it('ключ пункта переживает роуты и фингерпринты', () => {
    expect(normalizeItemKey('perf-/api/cafe/menu')).toBe('perf--api-cafe-menu');
    expect(normalizeItemKey('err-a1b2c3')).toBe('err-a1b2c3');
    expect(() => normalizeItemKey('///')).toThrow();
  });
});

describe('маркеры зонтика', () => {
  it('area читается из тела, чужие тела дают null', () => {
    expect(batchAreaOf(renderBatchBody('gazebos'))).toBe('gazebos');
    expect(batchAreaOf('обычная issue')).toBeNull();
    expect(batchAreaOf(null)).toBeNull();
  });

  it('заголовок и маркер согласованы по area', () => {
    expect(batchIssueTitle('Perf')).toContain('perf');
    expect(batchMarker('Perf')).toBe('<!-- batch:perf -->');
  });
});

describe('пункты-комментарии (append-only)', () => {
  const c1 = renderBatchItemComment('err-abc', 'Падает выдача меню', 'стек...');
  const c2 = renderBatchItemComment('spike-client-beacon', 'Всплеск WARNING');

  it('parseBatchItems достаёт ключ и заголовок, игнорируя посторонние комментарии', () => {
    const items = parseBatchItems(['просто комментарий', c1, c2]);
    expect(items.map((i) => i.key)).toEqual(['err-abc', 'spike-client-beacon']);
    expect(items[0].title).toBe('Падает выдача меню');
  });

  it('hasBatchItem — дедуп повторного batch-add', () => {
    expect(hasBatchItem([c1], 'err-abc')).toBe(true);
    expect(hasBatchItem([c1], 'err-xyz')).toBe(false);
  });

  it('batchIsFull — потолок пунктов', () => {
    expect(batchIsFull(7, 8)).toBe(false);
    expect(batchIsFull(8, 8)).toBe(true);
  });
});

describe('batch-result и спасение пунктов', () => {
  const items = parseBatchItems([
    renderBatchItemComment('a', 'A'),
    renderBatchItemComment('b', 'B'),
    renderBatchItemComment('c', 'C'),
  ]);

  it('учтённые пункты (done + carried) не спасаются', () => {
    const result = parseBatchResult([renderBatchResult([{ key: 'a' }], [{ key: 'b', toIssue: 712 }])]);
    expect(result.found).toBe(true);
    expect(unprocessedBatchItems(items, result).map((i) => i.key)).toEqual(['c']);
  });

  it('без batch-result спасаются ВСЕ пункты — сессия забыла отчитаться', () => {
    const result = parseBatchResult(['левый комментарий']);
    expect(result.found).toBe(false);
    expect(unprocessedBatchItems(items, result)).toHaveLength(3);
  });

  it('несколько batch-result комментариев складываются', () => {
    const result = parseBatchResult([
      renderBatchResult([{ key: 'a' }], []),
      renderBatchResult([{ key: 'c' }], []),
    ]);
    expect(unprocessedBatchItems(items, result).map((i) => i.key)).toEqual(['b']);
  });
});
