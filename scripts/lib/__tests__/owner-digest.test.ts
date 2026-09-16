import { describe, it, expect } from 'vitest';
import type { WeeklyFunnelDigest } from '../../../src/modules/analytics/types';
import { buildOwnerDigest, escapeHtml, formatRuPeriod, type OwnerDigestInput } from '../owner-digest';

const weekly: WeeklyFunnelDigest = {
  period: { dateFrom: '2026-09-14', dateTo: '2026-09-20' },
  reportPath: 'docs/analytics/2026-09-21-funnel-weekly.md',
  insufficientData: false,
  funnels: [
    {
      label: 'Беседки',
      endToEndConversion: 6.2,
      endToEndDeltaPp: -1.8,
      biggestDropLabel: 'Выбрал слот',
      biggestDropConversion: 24.7,
      insufficientData: false,
    },
    {
      label: 'Плей Парк',
      endToEndConversion: 9.4,
      endToEndDeltaPp: 0.6,
      biggestDropLabel: 'Выбрал слот',
      biggestDropConversion: 31,
      insufficientData: false,
    },
    {
      label: 'Аренда офисов',
      endToEndConversion: 0,
      endToEndDeltaPp: null,
      biggestDropLabel: null,
      biggestDropConversion: null,
      insufficientData: true,
    },
  ],
  hypotheses: [
    { issue: 812, title: 'Показывать свободные слоты прямо на странице беседок' },
    { issue: 813, title: 'Убрать обязательный e-mail из формы заявки' },
  ],
};

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
    { title: 'PR #700: аппрув дан', kind: 'merge-hold', status: 'APPROVED', ageHours: 3 },
  ],
  feedback: { bugs: 1, suggestions: 2 },
  weeklyFunnel: null,
};

describe('buildOwnerDigest', () => {
  it('собирает все четыре секции и экранирует HTML в заголовках PR', () => {
    const text = buildOwnerDigest(base);
    expect(text).toContain('Уехало в прод за сутки (2)');
    expect(text).toContain('&lt;b&gt;не&lt;/b&gt;'); // заголовок PR — данные, не разметка
    expect(text).toContain('abc12345');
    expect(text).toContain('открыто <b>15</b> (−3 за сутки');
    expect(text).toContain('Ждут твоего решения (3)');
    expect(text).toContain('⏸'); // DEFERRED помечен отдельно
    expect(text).toContain('⚠'); // зависший APPROVED виден, а не «Принято» и тишина
    expect(text).toContain('мерж завис');
    expect(text).toContain('багов — 1');
  });

  it('тихий день: нет деплоев, решений и фидбека — сводка честно короткая', () => {
    const text = buildOwnerDigest({
      deployedShaShort: null,
      mergedPrs: [],
      backlog: { totalOpen: 10, opened24h: 0, closed24h: 0 },
      decisions: [],
      feedback: { bugs: 0, suggestions: 0 },
      weeklyFunnel: null,
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

describe('блок недельной воронки (US-3 эпика #583)', () => {
  it('AC-3.1/3.2/3.4: выжимка по воронкам, гипотезы с номерами, путь к отчёту', () => {
    const text = buildOwnerDigest({ ...base, weeklyFunnel: weekly });
    expect(text).toContain('Воронка за неделю 14–20 сентября');
    expect(text).toContain('• Беседки: до конца воронки доходит 6.2% (−1.8 пп); слабое место — «Выбрал слот» (24.7%)');
    expect(text).toContain('• Плей Парк: до конца воронки доходит 9.4% (+0.6 пп)');
    expect(text).toContain('• Аренда офисов: мало данных за неделю — выводов не делаем');
    expect(text).toContain('Гипотезы недели (2)');
    expect(text).toContain('ждут твоего «делай», сами в работу не уйдут');
    expect(text).toContain('• Показывать свободные слоты прямо на странице беседок (#812)');
    expect(text).toContain('• Убрать обязательный e-mail из формы заявки (#813)');
    expect(text).toContain('Полный отчёт — docs/analytics/2026-09-21-funnel-weekly.md');
    // Блок стоит между решениями и пользователями.
    expect(text.indexOf('Ждут твоего решения')).toBeLessThan(text.indexOf('Воронка за неделю'));
    expect(text.indexOf('Воронка за неделю')).toBeLessThan(text.indexOf('Пользователи за сутки'));
  });

  it('AC-3.3: отчёта сегодня нет — в сводке нет ни одной строки блока', () => {
    const text = buildOwnerDigest({ ...base, weeklyFunnel: null });
    expect(text).not.toContain('Воронка за неделю');
    expect(text).not.toContain('📊');
    expect(text).not.toContain('Гипотез');
    expect(text).not.toContain('docs/analytics/');
  });

  it('данных за неделю мало — одна честная строка без единого процента', () => {
    const text = buildOwnerDigest({
      ...base,
      weeklyFunnel: { ...weekly, insufficientData: true },
    });
    expect(text).toContain('Данных за неделю мало — разбора и гипотез нет.');
    expect(text).not.toContain('%');
    expect(text).not.toContain('Гипотезы недели');
    expect(text).not.toContain('Беседки');
  });

  it('гипотез нет — это тоже новость, строка явная', () => {
    const text = buildOwnerDigest({ ...base, weeklyFunnel: { ...weekly, hypotheses: [] } });
    expect(text).toContain('Гипотез на этой неделе нет.');
    expect(text).toContain('Полный отчёт —');
  });

  it('заголовок гипотезы — данные, а не разметка: HTML экранируется', () => {
    const text = buildOwnerDigest({
      ...base,
      weeklyFunnel: {
        ...weekly,
        hypotheses: [{ issue: 814, title: 'Кнопка <b>Оплатить</b> внизу меню' }],
      },
    });
    expect(text).toContain('Кнопка &lt;b&gt;Оплатить&lt;/b&gt; внизу меню (#814)');
  });
});

describe('formatRuPeriod', () => {
  it('одна неделя внутри месяца и неделя на стыке месяцев', () => {
    expect(formatRuPeriod('2026-09-14', '2026-09-20')).toBe('14–20 сентября');
    expect(formatRuPeriod('2026-09-28', '2026-10-04')).toBe('28 сентября – 4 октября');
  });
});

describe('escapeHtml', () => {
  it('экранирует амперсанд первым — без двойного экранирования', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });
});
