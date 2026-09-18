import { describe, it, expect } from 'vitest';
import {
  groupReleasesByDay,
  mskDate,
  parseDate,
  parseFlags,
  parseFunnel,
  parseStep,
  requireString,
} from '../funnel-weekly';

describe('parseFlags', () => {
  it('разбирает пары --key value и флаги без значения', () => {
    expect(parseFlags(['--report-date', '2026-09-21', '--no-dispatch', '--funnel', 'gazebos'])).toEqual({
      'report-date': '2026-09-21',
      'no-dispatch': true,
      funnel: 'gazebos',
    });
  });

  it('пустой список — пустые флаги; позиционный аргумент — ошибка', () => {
    expect(parseFlags([])).toEqual({});
    expect(() => parseFlags(['build'])).toThrow('неизвестный аргумент «build»');
  });
});

describe('requireString', () => {
  it('требует непустую строку, флаг без значения не считается', () => {
    expect(requireString({ title: 'Гипотеза' }, 'title')).toBe('Гипотеза');
    expect(() => requireString({ title: true }, 'title')).toThrow('нужен --title');
    expect(() => requireString({ title: '  ' }, 'title')).toThrow('нужен --title');
    expect(() => requireString({}, 'title')).toThrow('нужен --title');
  });
});

describe('parseDate / parseFunnel / parseStep', () => {
  it('дата принимается только в формате YYYY-MM-DD', () => {
    expect(parseDate('2026-09-21', 'report-date')).toBe('2026-09-21');
    expect(() => parseDate('21.09.2026', 'report-date')).toThrow('--report-date');
    expect(() => parseDate('вчера', 'report-date')).toThrow('YYYY-MM-DD');
  });

  it('воронка — только из каталога', () => {
    expect(parseFunnel('ps-park')).toBe('ps-park');
    expect(() => parseFunnel('sauna')).toThrow('ожидаю один из');
  });

  it('шаг проверяется в пределах своей воронки', () => {
    expect(parseStep('gazebos', 'slot_selected')).toBe('slot_selected');
    expect(parseStep('cafe', 'cart_item_added')).toBe('cart_item_added');
    // slot_selected есть у беседок, но не у кафе — чужой шаг не проходит
    expect(() => parseStep('cafe', 'slot_selected')).toThrow('у воронки cafe есть только');
    // у аренды нет оплаты (AC-1.4 каталога)
    expect(() => parseStep('rental', 'paid')).toThrow('у воронки rental есть только');
  });
});

describe('mskDate', () => {
  it('переводит UTC-момент в календарный день МСК', () => {
    expect(mskDate(new Date('2026-09-20T12:00:00.000Z'))).toBe('2026-09-20');
    // 22:30 UTC воскресенья — это уже понедельник в Москве
    expect(mskDate(new Date('2026-09-20T22:30:00.000Z'))).toBe('2026-09-21');
    expect(mskDate(new Date('2026-09-21T00:30:00.000Z'))).toBe('2026-09-21');
  });
});

describe('groupReleasesByDay (AC-2.2)', () => {
  const period = { dateFrom: '2026-09-14', dateTo: '2026-09-20' };
  const prs = [
    { number: 884, title: 'fix(cafe): корзина', merged_at: '2026-09-18T09:00:00.000Z' },
    { number: 881, title: 'feat(gazebos): слоты', merged_at: '2026-09-15T10:00:00.000Z' },
    { number: 880, title: 'до периода', merged_at: '2026-09-13T20:00:00.000Z' },
    { number: 890, title: 'после периода', merged_at: '2026-09-21T10:00:00.000Z' },
    { number: 891, title: 'не смержен', merged_at: null },
    { number: 882, title: 'второй за день', merged_at: '2026-09-15T18:00:00.000Z' },
  ];

  it('оставляет только merged PR периода и сортирует дни и PR по возрастанию', () => {
    expect(groupReleasesByDay(prs, period)).toEqual([
      {
        date: '2026-09-15',
        prs: [
          { number: 881, title: 'feat(gazebos): слоты' },
          { number: 882, title: 'второй за день' },
        ],
      },
      { date: '2026-09-18', prs: [{ number: 884, title: 'fix(cafe): корзина' }] },
    ]);
  });

  it('границы недели считаются по МСК, а не по UTC', () => {
    // 2026-09-13T21:30Z = понедельник 00:30 МСК → уже внутри периода
    const edge = [{ number: 1, title: 'ночью в понедельник', merged_at: '2026-09-13T21:30:00.000Z' }];
    expect(groupReleasesByDay(edge, period)).toEqual([
      { date: '2026-09-14', prs: [{ number: 1, title: 'ночью в понедельник' }] },
    ]);
  });

  it('дубли одной страницы API не удваивают релиз', () => {
    const duplicated = [prs[1], prs[1]];
    expect(groupReleasesByDay(duplicated, period)[0].prs).toHaveLength(1);
  });

  it('релизов не было — пустой список, а не выдуманные дни', () => {
    expect(groupReleasesByDay([], period)).toEqual([]);
  });
});
