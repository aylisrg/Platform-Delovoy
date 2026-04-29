/**
 * Прайсинг беседок: weekday/weekend × час/день.
 *
 * Источник данных — `Resource.metadata.priceList` (заполняется
 * скриптом `scripts/update-gazebo-prices.ts`). Для ресурсов без
 * priceList используется fallback на `Resource.pricePerHour` —
 * та же цена в будни/выходные/день.
 */

export type PriceList = {
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
};

export type ResourcePricing = PriceList & {
  /** Применимая ставка часа для данной даты. */
  hourRate: number;
  /** Применимая ставка дня для данной даты. */
  dayRate: number;
  /** Пт-Вс? Используется для лейблов в UI. */
  isWeekend: boolean;
};

export type PriceBreakdown = {
  hours: number;
  hourRate: number;
  dayRate: number;
  isWeekend: boolean;
  /** Стоимость по часовой ставке. */
  hourlyTotal: number;
  /** Финальная стоимость (минимум из часовой и дневной). */
  total: number;
  /** true, если выгоднее применить дневной тариф. */
  appliedDayRate: boolean;
  /** Сколько сэкономлено относительно почасовой при дневном тарифе (≥0). */
  savings: number;
};

const isPriceList = (v: unknown): v is PriceList =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as PriceList).weekdayHour === "number" &&
  typeof (v as PriceList).weekdayDay === "number" &&
  typeof (v as PriceList).weekendHour === "number" &&
  typeof (v as PriceList).weekendDay === "number";

/**
 * Извлекает `priceList` из metadata; если нет — собирает из `pricePerHour`
 * (одна цена на всё, день = 10 × час как разумный дефолт).
 */
export function extractPriceList(
  metadata: unknown,
  pricePerHour: number | null
): PriceList | null {
  if (metadata && typeof metadata === "object" && "priceList" in metadata) {
    const pl = (metadata as { priceList: unknown }).priceList;
    if (isPriceList(pl)) return pl;
  }
  if (pricePerHour && pricePerHour > 0) {
    return {
      weekdayHour: pricePerHour,
      weekdayDay: pricePerHour * 10,
      weekendHour: pricePerHour,
      weekendDay: pricePerHour * 10,
    };
  }
  return null;
}

/**
 * "Выходной" по бизнес-правилу прайс-листа = пятница, суббота, воскресенье.
 * Принимает дату как `YYYY-MM-DD` (локальная дата без таймзоны).
 */
export function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  // new Date(y, m-1, d) — локальная дата, без сдвигов UTC.
  const dow = new Date(y, m - 1, d).getDay(); // 0=Sun … 6=Sat
  return dow === 0 || dow === 5 || dow === 6;
}

export function getResourcePricing(
  metadata: unknown,
  pricePerHour: number | null,
  dateStr: string
): ResourcePricing | null {
  const pl = extractPriceList(metadata, pricePerHour);
  if (!pl) return null;
  const weekend = isWeekendDate(dateStr);
  return {
    ...pl,
    isWeekend: weekend,
    hourRate: weekend ? pl.weekendHour : pl.weekdayHour,
    dayRate: weekend ? pl.weekendDay : pl.weekdayDay,
  };
}

/**
 * Финальная стоимость: min(часы × hourRate, dayRate). Если дневной тариф
 * выгоднее — применяем его. Это совпадает с логикой прайс-листа, где
 * "день" — это плоская ставка за смену.
 */
/**
 * Серверный расчёт для записи в Booking.metadata. Учитывает день недели
 * и дневной тариф. Совместим по форме с `PricingResult` из booking module.
 */
export function computeGazeboPricing(
  startTime: Date,
  endTime: Date,
  dateStr: string,
  resourceMetadata: unknown,
  pricePerHour: number | null,
  itemsTotal: number
): {
  pricePerHour: string;
  basePrice: string;
  totalPrice: string;
  appliedDayRate: boolean;
} {
  const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  const pricing = getResourcePricing(resourceMetadata, pricePerHour, dateStr);
  if (!pricing) {
    const total = Math.round(itemsTotal * 100) / 100;
    return {
      pricePerHour: "0.00",
      basePrice: "0.00",
      totalPrice: total.toFixed(2),
      appliedDayRate: false,
    };
  }
  const breakdown = calcBookingPrice(pricing, hours);
  const basePrice = Math.round(breakdown.total * 100) / 100;
  const totalPrice = Math.round((basePrice + itemsTotal) * 100) / 100;
  return {
    pricePerHour: pricing.hourRate.toFixed(2),
    basePrice: basePrice.toFixed(2),
    totalPrice: totalPrice.toFixed(2),
    appliedDayRate: breakdown.appliedDayRate,
  };
}

export function calcBookingPrice(
  pricing: ResourcePricing,
  hours: number
): PriceBreakdown {
  const hourlyTotal = hours * pricing.hourRate;
  const useDayRate = pricing.dayRate > 0 && pricing.dayRate < hourlyTotal;
  const total = useDayRate ? pricing.dayRate : hourlyTotal;
  return {
    hours,
    hourRate: pricing.hourRate,
    dayRate: pricing.dayRate,
    isWeekend: pricing.isWeekend,
    hourlyTotal,
    total,
    appliedDayRate: useDayRate,
    savings: useDayRate ? hourlyTotal - pricing.dayRate : 0,
  };
}
