import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ESCALATION_OPTIONS,
  recurringIncidents,
  rootCauseIssue,
  type ClosedIssueLite,
} from '../lib/incident-escalation';

const now = new Date('2026-08-10T12:00:00Z');
const LABELS = ['site-down', 'notifications-down', 'ci-failure'] as const;

const closed = (number: number, label: string, closedAt: string | null): ClosedIssueLite => ({
  number,
  labels: [label],
  closedAt,
});

describe('recurringIncidents', () => {
  it('3 закрытия за 7 дней — эскалация', () => {
    const incidents = recurringIncidents(LABELS, [
      closed(1, 'site-down', '2026-08-09T10:00:00Z'),
      closed(2, 'site-down', '2026-08-07T10:00:00Z'),
      closed(3, 'site-down', '2026-08-05T10:00:00Z'),
    ], now);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ label: 'site-down', count: 3, issues: [1, 2, 3] });
  });

  it('2 закрытия — ещё не цикл', () => {
    const incidents = recurringIncidents(LABELS, [
      closed(1, 'site-down', '2026-08-09T10:00:00Z'),
      closed(2, 'site-down', '2026-08-07T10:00:00Z'),
    ], now);
    expect(incidents).toEqual([]);
  });

  it('закрытия старше окна не считаются', () => {
    const incidents = recurringIncidents(LABELS, [
      closed(1, 'site-down', '2026-08-09T10:00:00Z'),
      closed(2, 'site-down', '2026-08-07T10:00:00Z'),
      closed(3, 'site-down', '2026-08-02T10:00:00Z'), // 8+ дней назад
    ], now);
    expect(incidents).toEqual([]);
  });

  it('лейблы независимы: по два цикла у трёх лейблов — ноль эскалаций', () => {
    const list = LABELS.flatMap((label, i) => [
      closed(i * 10 + 1, label, '2026-08-09T10:00:00Z'),
      closed(i * 10 + 2, label, '2026-08-08T10:00:00Z'),
    ]);
    expect(recurringIncidents(LABELS, list, now)).toEqual([]);
  });

  it('closedAt=null и мусорные даты игнорируются', () => {
    const incidents = recurringIncidents(LABELS, [
      closed(1, 'ci-failure', null),
      closed(2, 'ci-failure', 'not-a-date'),
      closed(3, 'ci-failure', '2026-08-09T10:00:00Z'),
      closed(4, 'ci-failure', '2026-08-08T10:00:00Z'),
      closed(5, 'ci-failure', '2026-08-07T10:00:00Z'),
    ], now);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].issues).toEqual([3, 4, 5]);
  });
});

describe('rootCauseIssue', () => {
  it('issue уходит в очередь: root-cause + инцидент-лейбл + P1 + auto:ready', () => {
    const issue = rootCauseIssue({ label: 'site-down', count: 3, issues: [1, 2, 3] });
    expect(issue.labels).toEqual(['root-cause', 'site-down', 'prio:P1', 'auto:ready']);
    expect(issue.title).toContain('site-down');
    expect(issue.title).toContain(String(DEFAULT_ESCALATION_OPTIONS.windowDays));
    expect(issue.body).toContain('- #1');
    expect(issue.body).toContain('- #3');
  });
});
