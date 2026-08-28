// Shared types for the booking engine (used by ps-park, gazebos)

import type { DiscountReason } from "./discount";

export type BookingDiscount = {
  percent: number;
  amount: string;
  originalAmount: string;
  finalAmount: string;
  reason: DiscountReason;
  note?: string;
  appliedBy: string;
  appliedAt: string;
};

export type BookingMetadata = {
  // ps-park specific
  playerCount?: number;
  // gazebos specific
  guestCount?: number;
  // common
  comment?: string;
  bookedByAdmin?: boolean;
  items?: unknown[];
  itemsTotal?: string;

  // Phase 1A: pricing snapshot
  basePrice?: string;       // decimal string: pricePerHour × hours
  pricePerHour?: string;    // snapshot of pricePerHour at booking creation
  totalPrice?: string;      // basePrice + itemsTotal
  // Беседки: цена ушла по дневному тарифу вместо почасового (потолок
  // min(часы × час, день) в gazebos/pricing.ts).
  appliedDayRate?: boolean;
  // Беседки: беседка выкуплена на весь рабочий день (openHour–closeHour).
  // Отличает намеренный выкуп дня от случайно набранных всех часов.
  fullDay?: boolean;

  // Phase 1A: check-in
  checkedInAt?: string;     // ISO datetime
  checkedInBy?: string;     // userId of manager
  lateCheckedInAt?: string; // ISO datetime, set when NO_SHOW → CHECKED_IN

  // Phase 1A: no-show
  noShowAt?: string;                  // ISO datetime
  noShowReason?: "auto" | "manual";

  // Phase 1A: cancellation penalty
  cancelPenalty?: {
    amount: string;     // decimal string
    reason: string;
    appliedAt: string;  // ISO datetime
  };

  // Checkout discount
  discount?: BookingDiscount;

  // Online payments (YooKassa): сумма, оплаченная онлайн, и последний платёж.
  onlinePaidAmount?: string; // decimal string
  paymentId?: string;

  // Предоплата, принятая менеджером на месте до завершения брони (#511).
  // Живёт в metadata, а не в колонках `cashAmount`/`cardAmount`: те —
  // снапшот чекаута, их перезаписывает завершение брони. Симметрично
  // `onlinePaidAmount`: в платёжном гейте засчитывается, в кассовый FT
  // завершения не попадает — своя строка уже проведена при приёме денег.
  prepaidCashAmount?: string; // decimal string
  prepaidCardAmount?: string; // decimal string
  prepaidAt?: string;         // ISO datetime последнего приёма предоплаты
};

export type CancellationPolicy = {
  thresholdHours: number;  // free cancel before this many hours
  penaltyPercent: number;  // percentage charged if cancelled within threshold
};

export type CancellationResult =
  | { penaltyApplied: false }
  | { penaltyApplied: true; penaltyAmount: number; basePrice: number };

export type PricingResult = {
  pricePerHour: string;
  basePrice: string;
  totalPrice: string;
};

export type CheckInMetadata = {
  checkedInAt: string;
  checkedInBy: string;
};

export type NoShowMetadata = {
  noShowAt: string;
  noShowReason: "auto" | "manual";
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  thresholdHours: 2,
  penaltyPercent: 50,
};

// Политика для броней со 100 % онлайн-предоплатой (решение владельца
// 2026-07-08): отмена гостем более чем за 24 ч — полный возврат, позже —
// без возврата (штраф = вся предоплата).
export const PREPAID_CANCELLATION_POLICY: CancellationPolicy = {
  thresholdHours: 24,
  penaltyPercent: 100,
};

export const DEFAULT_NO_SHOW_THRESHOLD_MINUTES = 30;
