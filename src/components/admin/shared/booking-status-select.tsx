"use client";

import type { BookingStatus } from "@prisma/client";
import {
  assertValidTransition,
  type ActorRole,
} from "@/modules/booking/state-machine";
import { BOOKING_STATUS_LABELS } from "@/modules/booking/history";
import type { BookingPaymentState } from "@/modules/booking/payment-status";

/** Значение «ОПЛАЧЕНО» — не статус жизненного цикла, а отметка об оплате. */
export const PAID_OPTION = "__PAID__" as const;

export type StatusSelectValue = BookingStatus | typeof PAID_OPTION;

type Props = {
  currentStatus: BookingStatus;
  startTime: Date;
  paymentState: BookingPaymentState;
  /** Роль текущего пользователя — определяет, какие переходы вообще возможны. */
  actorRole?: ActorRole;
  disabled?: boolean;
  onSelect: (value: StatusSelectValue) => void;
};

/** Порядок как в жизни брони, а не как в enum. */
const LIFECYCLE_ORDER: BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "NO_SHOW",
  "COMPLETED",
  "CANCELLED",
];

/**
 * Единый переключатель статуса брони.
 *
 * Владелец не находил, «как поменять статус»: кнопки в карточке зависели от
 * текущего состояния, и половина переходов (заезд, неявка) не была доступна
 * вообще. Здесь виден **весь** список — включая недоступные пункты, но они
 * заблокированы и подписаны причиной. Так менеджер понимает, почему «Заезд»
 * нельзя поставить брони, которая начнётся завтра, вместо того чтобы поймать
 * ошибку сервера после клика.
 *
 * Доступность считает сам FSM (`assertValidTransition`), а не копия его
 * правил: разъехаться они не могут по построению.
 */
export function BookingStatusSelect({
  currentStatus,
  startTime,
  paymentState,
  actorRole = "MANAGER",
  disabled = false,
  onSelect,
}: Props) {
  const now = new Date();

  /** null — переход разрешён; строка — почему нет. */
  function blockedReason(target: BookingStatus): string | null {
    if (target === currentStatus) return null;
    try {
      assertValidTransition({
        currentStatus,
        targetStatus: target,
        actorRole,
        now,
        startTime,
        noShowThresholdMinutes: 30,
      });
      return null;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "TRANSITION_CONDITION_NOT_MET") return e.message ?? "недоступно";
      if (e.code === "FORBIDDEN") return "нет прав";
      return "недоступно";
    }
  }

  const paidBlocked =
    paymentState === "PAID"
      ? "уже оплачено"
      : paymentState === "PENALTY_HELD"
        ? "удержан штраф"
        : currentStatus === "COMPLETED" || currentStatus === "CANCELLED"
          ? "бронь закрыта"
          : null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-zinc-500">Статус</span>
      <select
        aria-label="Статус брони"
        value={currentStatus}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value as StatusSelectValue;
          // Селект остаётся управляемым: реальный статус поменяет родитель
          // после подтверждения, поэтому значение здесь не трогаем.
          if (value !== currentStatus) onSelect(value);
        }}
        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm font-medium text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
      >
        {LIFECYCLE_ORDER.map((status) => {
          const reason = blockedReason(status);
          return (
            <option key={status} value={status} disabled={reason !== null}>
              {BOOKING_STATUS_LABELS[status]}
              {reason ? ` — ${reason}` : ""}
            </option>
          );
        })}
        <option value={PAID_OPTION} disabled={paidBlocked !== null}>
          💰 ОПЛАЧЕНО{paidBlocked ? ` — ${paidBlocked}` : ""}
        </option>
      </select>
    </label>
  );
}
