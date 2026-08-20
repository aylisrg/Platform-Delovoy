import { describe, it, expect } from 'vitest';
import { isTokenDead, shouldRemindRotation } from '../queue-watch';

// buildNeedsOwnerDigest удалён вместе с суточным дайджестом (ADR 2026-08-20):
// hold-PR теперь приходит владельцу Telegram-кнопками в момент навешивания
// needs-owner, о зависших напоминает вечерний owner-digest.

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

  it('границы диапазона 2xx', () => {
    expect(isTokenDead(199)).toBe(true); // последний 1xx — мёртв
    expect(isTokenDead(299)).toBe(false); // последний 2xx — жив
    expect(isTokenDead(300)).toBe(true); // первый 3xx — мёртв
  });

  it('NaN/мусор в коде ответа — fail-safe в сторону «мёртв», не «жив»', () => {
    expect(isTokenDead(Number.NaN)).toBe(true);
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

