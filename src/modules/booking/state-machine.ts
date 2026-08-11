import type { BookingStatus } from "@prisma/client";

export type ActorRole = "CLIENT" | "MANAGER" | "SUPERADMIN" | "CRON";

/**
 * Статусы, при которых бронь **занимает слот**.
 *
 * Единственный источник правды для конфликт-чеков, расписания, доступности и
 * подсчёта активных броней. Захардкоженный `["PENDING", "CONFIRMED"]` в этих
 * местах — баг: `CHECKED_IN` добавили позже, и он выпал из фильтров по всему
 * проекту. Следствие — заехавший гость исчезал из сетки, слот выглядел
 * свободным, и менеджер одним кликом создавал бронь поверх живого гостя (#424).
 *
 * Чего здесь намеренно нет:
 * - `COMPLETED` — гость ушёл, слот свободен;
 * - `CANCELLED` — брони нет;
 * - `NO_SHOW` — гость не приехал, слот отдаётся другим. Обратный переход
 *   `NO_SHOW → CHECKED_IN` существует (гость опоздал), и он вернёт бронь в
 *   активные — но до него слот честно свободен.
 *
 * Заводишь новый статус — реши, занимает ли он слот, и при необходимости
 * добавь сюда. Одно место вместо семнадцати.
 */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

export class BookingTransitionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BookingTransitionError";
  }
}

type TransitionRule = {
  allowedActors: ActorRole[];
  condition?: (ctx: TransitionContext) => boolean;
  conditionMessage?: string;
};

export type TransitionContext = {
  currentStatus: BookingStatus;
  targetStatus: BookingStatus;
  actorRole: ActorRole;
  now: Date;
  startTime: Date;
  noShowThresholdMinutes: number;
};

// Map: "FROM:TO" → rule
const TRANSITIONS: Record<string, TransitionRule> = {
  "PENDING:CONFIRMED": {
    allowedActors: ["MANAGER", "SUPERADMIN"],
  },
  "PENDING:CANCELLED": {
    allowedActors: ["CLIENT", "MANAGER", "SUPERADMIN"],
  },
  "CONFIRMED:CANCELLED": {
    allowedActors: ["CLIENT", "MANAGER", "SUPERADMIN"],
  },
  "CONFIRMED:CHECKED_IN": {
    allowedActors: ["MANAGER", "SUPERADMIN"],
    condition: (ctx) => ctx.now >= ctx.startTime,
    conditionMessage: "Чек-ин доступен только после начала сессии",
  },
  "CONFIRMED:NO_SHOW": {
    allowedActors: ["MANAGER", "SUPERADMIN", "CRON"],
    condition: (ctx) =>
      ctx.now >= new Date(ctx.startTime.getTime() + ctx.noShowThresholdMinutes * 60 * 1000),
    conditionMessage: `Нельзя отметить No-show — не прошёл порог времени`,
  },
  "CONFIRMED:COMPLETED": {
    allowedActors: ["MANAGER", "SUPERADMIN", "CRON"],
  },
  "CHECKED_IN:COMPLETED": {
    allowedActors: ["MANAGER", "SUPERADMIN", "CRON"],
  },
  "NO_SHOW:CHECKED_IN": {
    allowedActors: ["MANAGER", "SUPERADMIN"],
  },
  "NO_SHOW:CANCELLED": {
    allowedActors: ["MANAGER", "SUPERADMIN"],
  },
};

/**
 * Validates whether a status transition is allowed.
 * Throws BookingTransitionError if not.
 */
export function assertValidTransition(ctx: TransitionContext): void {
  const key = `${ctx.currentStatus}:${ctx.targetStatus}`;
  const rule = TRANSITIONS[key];

  if (!rule) {
    throw new BookingTransitionError(
      "INVALID_STATUS_TRANSITION",
      `Нельзя перевести из ${ctx.currentStatus} в ${ctx.targetStatus}`
    );
  }

  if (!rule.allowedActors.includes(ctx.actorRole)) {
    throw new BookingTransitionError(
      "FORBIDDEN",
      `Недостаточно прав для перевода из ${ctx.currentStatus} в ${ctx.targetStatus}`
    );
  }

  if (rule.condition && !rule.condition(ctx)) {
    throw new BookingTransitionError(
      "TRANSITION_CONDITION_NOT_MET",
      rule.conditionMessage ?? "Условие перехода не выполнено"
    );
  }
}

/**
 * Returns allowed target statuses for a given current status and actor role.
 */
export function getAllowedTransitions(
  currentStatus: BookingStatus,
  actorRole: ActorRole
): BookingStatus[] {
  return Object.entries(TRANSITIONS)
    .filter(([key, rule]) => {
      const [from] = key.split(":");
      return from === currentStatus && rule.allowedActors.includes(actorRole);
    })
    .map(([key]) => key.split(":")[1] as BookingStatus);
}
