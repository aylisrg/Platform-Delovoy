/**
 * Watchdog автономии очереди (issue #573) — liveness AUTOMATION_TOKEN.
 * Протухший токен деградирует автоматику тихо: авто-ребейз снова приписывается
 * github-actions[bot], CI ребейзнутых веток паркуется в action_required —
 * ADR 2026-08-10, обновление 2026-08-13.
 *
 * Суточный дайджест needs-owner отсюда убран (ADR 2026-08-20): hold-PR теперь
 * приходит владельцу Telegram-кнопками в момент навешивания лейбла
 * (decisions-sync свипера), о зависших напоминает вечерний owner-digest.
 *
 * Отдельный модуль от scripts/lib/issue-queue.ts НАМЕРЕННО: PR, меняющий
 * реализацию гейта, сам уходит в hold (issue-queue.ts — в HOLD_PATTERNS),
 * и трогать тот же файл здесь означало бы двойной hold без причины —
 * логика гейта этим PR не меняется, только сторож рядом с ним.
 *
 * I/O нет ни в одной функции этого файла — вызывается из scripts/issue-queue.ts.
 */

export const TOKEN_ROTATION_MARKER = '<!-- issue-queue-token-rotation-reminder -->';

/**
 * `GET /user` с AUTOMATION_TOKEN — не-2xx означает протухший или отозванный
 * PAT. Написано как отрицание диапазона, а не `< 200 || >= 300`: NaN (или
 * иной мусор, если код ответа когда-нибудь перестанет быть валидным числом)
 * должен считаться мёртвым, а не живым — `NaN < 200` и `NaN >= 300` оба
 * false, что при прямом виде условия молча трактовало бы NaN как «жив».
 */
export function isTokenDead(status: number): boolean {
  return !(status >= 200 && status < 300);
}

export interface RotationReminderInput {
  now: Date;
  /** `created_at` последнего комментария с TOKEN_ROTATION_MARKER; null — ещё не напоминали. */
  lastReminderAt: string | null;
  intervalDays: number;
}

/**
 * Дата истечения fine-grained PAT недоступна через API — единственный сигнал
 * живости - код ответа `/user`. Раз в intervalDays (по умолчанию 30) —
 * информационное напоминание о ротации, только пока токен ещё жив (мёртвый
 * уже алертит отдельно и без дедупа — там не до напоминаний).
 */
export function shouldRemindRotation(i: RotationReminderInput): boolean {
  if (i.lastReminderAt === null) return true;
  const daysSince = (i.now.getTime() - new Date(i.lastReminderAt).getTime()) / 86_400_000;
  return daysSince >= i.intervalDays;
}
