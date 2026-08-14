/**
 * Watchdog автономии очереди (issue #573) — liveness AUTOMATION_TOKEN +
 * суточный дайджест needs-owner. Два SPOF без надзора: протухший токен
 * деградирует автоматику тихо (авто-ребейз снова приписывается
 * github-actions[bot], CI ребейзнутых веток паркуется в action_required —
 * ADR 2026-08-10, обновление 2026-08-13), а hold-PR-ы ждут владельца без
 * SLA.
 *
 * Отдельный модуль от scripts/lib/issue-queue.ts НАМЕРЕННО: PR, меняющий
 * реализацию гейта, сам уходит в hold (issue-queue.ts — в HOLD_PATTERNS),
 * и трогать тот же файл здесь означало бы двойной hold без причины —
 * логика гейта этим PR не меняется, только сторож рядом с ним.
 *
 * I/O нет ни в одной функции этого файла — вызывается из scripts/issue-queue.ts.
 */

export const TOKEN_ROTATION_MARKER = '<!-- issue-queue-token-rotation-reminder -->';
export const NEEDS_OWNER_DIGEST_MARKER = '<!-- issue-queue-needs-owner-digest -->';

/** `GET /user` с AUTOMATION_TOKEN — не-2xx означает протухший или отозванный PAT. */
export function isTokenDead(status: number): boolean {
  return status < 200 || status >= 300;
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

export interface NeedsOwnerPr {
  number: number;
  title: string;
  /** Когда лейбл needs-owner реально появился (событие `labeled` из Issues API). */
  labeledAt: string;
}

export interface NeedsOwnerDigestInput {
  now: Date;
  /** Все открытые PR с лейблом needs-owner (без порога по возрасту — фильтрует сама функция). */
  prs: NeedsOwnerPr[];
  minAgeHours: number;
  /** `created_at` последнего дайджест-комментария; null — дайджеста ещё не было. */
  lastDigestAt: string | null;
  intervalHours: number;
}

export interface NeedsOwnerDigestResult {
  send: boolean;
  stalePrs: NeedsOwnerPr[];
  reason: string;
}

/**
 * Список PR needs-owner старше minAgeHours, не чаще раза в intervalHours и
 * только когда список непустой — пустая очередь не повод писать в Telegram.
 */
export function buildNeedsOwnerDigest(i: NeedsOwnerDigestInput): NeedsOwnerDigestResult {
  const hoursSince = (iso: string) => (i.now.getTime() - new Date(iso).getTime()) / 3.6e6;
  const stalePrs = i.prs
    .filter((pr) => hoursSince(pr.labeledAt) >= i.minAgeHours)
    .sort((a, b) => new Date(a.labeledAt).getTime() - new Date(b.labeledAt).getTime());

  if (stalePrs.length === 0) {
    return { send: false, stalePrs, reason: 'нет needs-owner PR старше порога' };
  }
  if (i.lastDigestAt !== null && hoursSince(i.lastDigestAt) < i.intervalHours) {
    return {
      send: false,
      stalePrs,
      reason: `дайджест уже был ${hoursSince(i.lastDigestAt).toFixed(1)} ч назад — кулдаун`,
    };
  }
  return {
    send: true,
    stalePrs,
    reason: `${stalePrs.length} PR needs-owner старше ${i.minAgeHours} ч`,
  };
}
