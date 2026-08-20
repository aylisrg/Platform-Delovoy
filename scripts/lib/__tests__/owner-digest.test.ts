import { describe, it, expect } from 'vitest';
import { buildOwnerDigest, escapeHtml, type OwnerDigestInput } from '../owner-digest';

const base: OwnerDigestInput = {
  deployedShaShort: 'abc12345',
  mergedPrs: [
    { number: 700, title: 'fix(cafe): корзина <b>не</b> очищалась' },
    { number: 701, title: 'chore(deps): недельная пачка minor+patch' },
  ],
  backlog: { totalOpen: 15, opened24h: 1, closed24h: 4 },
  decisions: [
    { title: 'PR #677 ждёт решения', kind: 'merge-hold', status: 'PENDING', ageHours: 26 },
    { title: 'Второй RU-VPS — да/нет?', kind: 'blocked-question', status: 'DEFERRED', ageHours: 72 },
  ],
  feedback: { bugs: 1, suggestions: 2 },
};

describe('buildOwnerDigest', () => {
  it('собирает все четыре секции и экранирует HTML в заголовках PR', () => {
    const text = buildOwnerDigest(base);
    expect(text).toContain('Уехало в прод за сутки (2)');
    expect(text).toContain('&lt;b&gt;не&lt;/b&gt;'); // заголовок PR — данные, не разметка
    expect(text).toContain('abc12345');
    expect(text).toContain('открыто <b>15</b> (−3 за сутки');
    expect(text).toContain('Ждут твоего решения (2)');
    expect(text).toContain('⏸'); // DEFERRED помечен отдельно
    expect(text).toContain('багов — 1');
  });

  it('тихий день: нет деплоев, решений и фидбека — сводка честно короткая', () => {
    const text = buildOwnerDigest({
      deployedShaShort: null,
      mergedPrs: [],
      backlog: { totalOpen: 10, opened24h: 0, closed24h: 0 },
      decisions: [],
      feedback: { bugs: 0, suggestions: 0 },
    });
    expect(text).toContain('ничего не выкатывалось');
    expect(text).toContain('без изменений');
    expect(text).toContain('решений никто не ждёт');
    expect(text).toContain('Фидбека от пользователей за сутки не было');
  });

  it('без данных фидбека (прод недоступен) секция опускается, а не врёт нулями', () => {
    const text = buildOwnerDigest({ ...base, feedback: null });
    expect(text).not.toContain('Фидбека');
    expect(text).not.toContain('багов —');
  });

  it('длинный список PR обрезается с «и ещё N»', () => {
    const prs = Array.from({ length: 14 }, (_, i) => ({ number: i, title: `pr ${i}` }));
    const text = buildOwnerDigest({ ...base, mergedPrs: prs });
    expect(text).toContain('…и ещё 4');
  });
});

describe('escapeHtml', () => {
  it('экранирует амперсанд первым — без двойного экранирования', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });
});
