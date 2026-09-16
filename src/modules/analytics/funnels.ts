/**
 * Каталог воронок и их шагов (US-1 эпика #583, ADR 2026-09-16 §5.1).
 *
 * Источник истины порядка/подписей шагов — этот файл, не БД: переименование
 * или перестановка шага не требует миграции данных (осознанный компромисс —
 * см. ADR §9.4). `ProductEvent.funnel`/`step` — свободные строки, валидные
 * значения перечислены здесь и проверяются Zod-схемами в validation.ts.
 */

export const FUNNEL_KEYS = ["gazebos", "ps-park", "cafe", "rental"] as const;
export type FunnelKey = (typeof FUNNEL_KEYS)[number];

export const STEP_KEYS = [
  "view",
  "slot_selected",
  "cart_item_added",
  "form_started",
  "submitted",
  "paid",
] as const;
export type FunnelStepKey = (typeof STEP_KEYS)[number];

export type FunnelStepDef = {
  step: FunnelStepKey;
  label: string;
  /**
   * Записывается ли шаг с клиента (sendBeacon). false = только сервер —
   * такие шаги ЗАПРЕЩЕНО принимать через публичный ingest-эндпоинт
   * (см. validation.ts `productEventIngestSchema`), иначе конверсию можно
   * подделать.
   */
  clientRecordable: boolean;
  /**
   * Окно дедупликации в секундах (Redis SET NX EX). 0 — не дедуплицировать:
   * `submitted`/`paid` — две брони в одной сессии это два реальных события.
   */
  dedupeWindowSec: number;
};

export type FunnelDef = {
  funnel: FunnelKey;
  /** Слаг модуля-владельца воронки (совпадает с Module.config сегодня). */
  moduleSlug: string;
  label: string;
  steps: FunnelStepDef[];
};

const DEDUPE_INTENT_SEC = 1800; // 30 минут — см. ADR §5.5

export const FUNNELS: Record<FunnelKey, FunnelDef> = {
  gazebos: {
    funnel: "gazebos",
    moduleSlug: "gazebos",
    label: "Беседки",
    steps: [
      { step: "view", label: "Просмотр страницы", clientRecordable: false, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "slot_selected", label: "Выбрал слот", clientRecordable: true, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "submitted", label: "Бронь отправлена", clientRecordable: false, dedupeWindowSec: 0 },
      { step: "paid", label: "Оплачено", clientRecordable: false, dedupeWindowSec: 0 },
    ],
  },
  "ps-park": {
    funnel: "ps-park",
    moduleSlug: "ps-park",
    label: "Плей Парк",
    steps: [
      { step: "view", label: "Просмотр страницы", clientRecordable: false, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "slot_selected", label: "Выбрал слот", clientRecordable: true, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "submitted", label: "Бронь отправлена", clientRecordable: false, dedupeWindowSec: 0 },
      { step: "paid", label: "Оплачено", clientRecordable: false, dedupeWindowSec: 0 },
    ],
  },
  cafe: {
    funnel: "cafe",
    moduleSlug: "cafe",
    label: "Кафе",
    steps: [
      { step: "view", label: "Просмотр меню", clientRecordable: false, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "cart_item_added", label: "Товар в корзине", clientRecordable: true, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "submitted", label: "Заказ оформлен", clientRecordable: false, dedupeWindowSec: 0 },
      { step: "paid", label: "Оплачено", clientRecordable: false, dedupeWindowSec: 0 },
    ],
  },
  rental: {
    funnel: "rental",
    moduleSlug: "rental",
    label: "Аренда офисов",
    steps: [
      { step: "view", label: "Просмотр страницы", clientRecordable: false, dedupeWindowSec: DEDUPE_INTENT_SEC },
      // Сверх AC-1.4 (ADR §5.2) — если сочтут лишним, убирается одной строкой.
      { step: "form_started", label: "Начал заполнять заявку", clientRecordable: true, dedupeWindowSec: DEDUPE_INTENT_SEC },
      { step: "submitted", label: "Заявка отправлена", clientRecordable: false, dedupeWindowSec: 0 },
      // Аренда — лид, не сделка: шага оплаты нет (AC-1.4).
    ],
  },
};

export function getFunnel(funnel: string): FunnelDef | undefined {
  return FUNNELS[funnel as FunnelKey];
}

export function getStepDef(funnel: string, step: string): FunnelStepDef | undefined {
  return getFunnel(funnel)?.steps.find((s) => s.step === step);
}

export function isClientRecordable(funnel: string, step: string): boolean {
  return getStepDef(funnel, step)?.clientRecordable === true;
}

/** Ключи шагов, которые допустимо принять от клиента — по ВСЕМ воронкам. */
export function clientRecordableSteps(): FunnelStepKey[] {
  const set = new Set<FunnelStepKey>();
  for (const def of Object.values(FUNNELS)) {
    for (const s of def.steps) {
      if (s.clientRecordable) set.add(s.step);
    }
  }
  return [...set];
}
