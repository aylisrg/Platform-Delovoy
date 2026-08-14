import { describe, it, expect } from 'vitest';
import {
  isTokenDead,
  shouldRemindRotation,
  buildNeedsOwnerDigest,
  type NeedsOwnerPr,
} from '../queue-watch';

describe('isTokenDead', () => {
  it('живой токен — 2xx', () => {
    expect(isTokenDead(200)).toBe(false);
    expect(isTokenDead(204)).toBe(false);
  });

  it('протухший/отозванный токен — 401 (юнит из acceptance criteria issue #573)', () => {
    expect(isTokenDead(401)).toBe(true);
  });

  it('403 (rate limit / forbidden) и 5xx тоже считаются мёртвым', () => {
    expect(isTokenDead(403)).toBe(true);
    expect(isTokenDead(500)).toBe(true);
  });

  it('редиректы (3xx) не 2xx — тоже мёртвый', () => {
    expect(isTokenDead(301)).toBe(true);
  });
});

describe('shouldRemindRotation', () => {
  const now = new Date('2026-08-14T12:00:00Z');

  it('напоминаний ещё не было — напомнить сразу', () => {
    expect(shouldRemindRotation({ now, lastReminderAt: null, intervalDays: 30 })).toBe(true);
  });

  it('напоминали 29 дней назад — молчать', () => {
    const lastReminderAt = new Date(now.getTime() - 29 * 86_400_000).toISOString();
    expect(shouldRemindRotation({ now, lastReminderAt, intervalDays: 30 })).toBe(false);
  });

  it('напоминали ровно 30 дней назад — напомнить снова', () => {
    const lastReminderAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    expect(shouldRemindRotation({ now, lastReminderAt, intervalDays: 30 })).toBe(true);
  });

  it('напоминали 31 день назад — напомнить снова', () => {
    const lastReminderAt = new Date(now.getTime() - 31 * 86_400_000).toISOString();
    expect(shouldRemindRotation({ now, lastReminderAt, intervalDays: 30 })).toBe(true);
  });
});

describe('buildNeedsOwnerDigest', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3.6e6).toISOString();

  const stale: NeedsOwnerPr = { number: 483, title: 'Stale PR', labeledAt: hoursAgo(50) };
  const fresh: NeedsOwnerPr = { number: 500, title: 'Fresh PR', labeledAt: hoursAgo(10) };

  it('пустой список PR — молчать', () => {
    const result = buildNeedsOwnerDigest({
      now,
      prs: [],
      minAgeHours: 48,
      lastDigestAt: null,
      intervalHours: 24,
    });
    expect(result.send).toBe(false);
    expect(result.stalePrs).toEqual([]);
  });

  it('все PR младше порога — молчать', () => {
    const result = buildNeedsOwnerDigest({
      now,
      prs: [fresh],
      minAgeHours: 48,
      lastDigestAt: null,
      intervalHours: 24,
    });
    expect(result.send).toBe(false);
  });

  it('есть PR старше порога, дайджеста ещё не было — слать', () => {
    const result = buildNeedsOwnerDigest({
      now,
      prs: [stale, fresh],
      minAgeHours: 48,
      lastDigestAt: null,
      intervalHours: 24,
    });
    expect(result.send).toBe(true);
    expect(result.stalePrs).toEqual([stale]);
  });

  it('дайджест уже был в пределах intervalHours — не дублировать', () => {
    const result = buildNeedsOwnerDigest({
      now,
      prs: [stale],
      minAgeHours: 48,
      lastDigestAt: hoursAgo(5),
      intervalHours: 24,
    });
    expect(result.send).toBe(false);
    expect(result.stalePrs).toEqual([stale]); // список считается, просто не отправляется
  });

  it('дайджест был больше intervalHours назад — слать снова', () => {
    const result = buildNeedsOwnerDigest({
      now,
      prs: [stale],
      minAgeHours: 48,
      lastDigestAt: hoursAgo(25),
      intervalHours: 24,
    });
    expect(result.send).toBe(true);
  });

  it('несколько застрявших PR — сортировка по возрасту, старые первыми', () => {
    const older: NeedsOwnerPr = { number: 100, title: 'Oldest', labeledAt: hoursAgo(100) };
    const result = buildNeedsOwnerDigest({
      now,
      prs: [stale, older],
      minAgeHours: 48,
      lastDigestAt: null,
      intervalHours: 24,
    });
    expect(result.stalePrs.map((p) => p.number)).toEqual([100, 483]);
  });
});
