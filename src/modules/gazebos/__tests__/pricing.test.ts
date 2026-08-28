import { describe, it, expect } from "vitest";
import {
  extractPriceList,
  isWeekendDate,
  getResourcePricing,
  calcBookingPrice,
  freeHoursToFullDay,
  buildPublicPriceRows,
} from "../pricing";

const PL = {
  weekdayHour: 1100,
  weekdayDay: 11000,
  weekendHour: 1400,
  weekendDay: 14000,
};

describe("extractPriceList", () => {
  it("returns priceList from metadata when valid", () => {
    expect(extractPriceList({ priceList: PL }, 1100)).toEqual(PL);
  });

  it("falls back to pricePerHour when metadata has no priceList", () => {
    expect(extractPriceList(null, 800)).toEqual({
      weekdayHour: 800,
      weekdayDay: 8000,
      weekendHour: 800,
      weekendDay: 8000,
    });
  });

  it("returns null when no metadata and no price", () => {
    expect(extractPriceList(null, null)).toBeNull();
    expect(extractPriceList({}, 0)).toBeNull();
  });

  it("ignores malformed priceList in metadata", () => {
    const result = extractPriceList({ priceList: { weekdayHour: 100 } }, 500);
    expect(result?.weekdayHour).toBe(500); // fell back to pricePerHour
  });
});

describe("isWeekendDate", () => {
  it("treats Fri/Sat/Sun as weekend", () => {
    expect(isWeekendDate("2026-05-01")).toBe(true);  // Fri
    expect(isWeekendDate("2026-05-02")).toBe(true);  // Sat
    expect(isWeekendDate("2026-05-03")).toBe(true);  // Sun
  });

  it("treats Mon-Thu as weekday", () => {
    expect(isWeekendDate("2026-04-27")).toBe(false); // Mon
    expect(isWeekendDate("2026-04-28")).toBe(false); // Tue
    expect(isWeekendDate("2026-04-29")).toBe(false); // Wed
    expect(isWeekendDate("2026-04-30")).toBe(false); // Thu
  });
});

describe("getResourcePricing", () => {
  it("picks weekday rates on Wednesday", () => {
    const p = getResourcePricing({ priceList: PL }, 1100, "2026-04-29");
    expect(p?.isWeekend).toBe(false);
    expect(p?.hourRate).toBe(1100);
    expect(p?.dayRate).toBe(11000);
  });

  it("picks weekend rates on Saturday", () => {
    const p = getResourcePricing({ priceList: PL }, 1100, "2026-05-02");
    expect(p?.isWeekend).toBe(true);
    expect(p?.hourRate).toBe(1400);
    expect(p?.dayRate).toBe(14000);
  });
});

describe("calcBookingPrice", () => {
  const weekday = getResourcePricing({ priceList: PL }, 1100, "2026-04-29")!;
  const weekend = getResourcePricing({ priceList: PL }, 1100, "2026-05-02")!;

  it("uses hourly when cheaper", () => {
    const r = calcBookingPrice(weekday, 5);
    expect(r.total).toBe(5500);
    expect(r.appliedDayRate).toBe(false);
    expect(r.savings).toBe(0);
  });

  it("switches to day rate when hourly exceeds dayRate (weekday №1, 11h)", () => {
    const r = calcBookingPrice(weekday, 11);
    expect(r.hourlyTotal).toBe(12100);
    expect(r.total).toBe(11000);
    expect(r.appliedDayRate).toBe(true);
    expect(r.savings).toBe(1100);
  });

  it("switches to day rate at the break-even point (weekday №2 8×800=6400 vs 7000 — keep hourly)", () => {
    const pl2 = { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 };
    const w = getResourcePricing({ priceList: pl2 }, 800, "2026-04-29")!;
    const r = calcBookingPrice(w, 8);
    expect(r.total).toBe(6400);
    expect(r.appliedDayRate).toBe(false);
  });

  it("applies weekend day rate at 11h+ on Sat", () => {
    const r = calcBookingPrice(weekend, 11);
    expect(r.hourlyTotal).toBe(15400);
    expect(r.total).toBe(14000);
    expect(r.appliedDayRate).toBe(true);
  });

  it("equal hourly == dayRate keeps hourly (no savings)", () => {
    // 10h × 1100 = 11000 == weekdayDay
    const r = calcBookingPrice(weekday, 10);
    expect(r.total).toBe(11000);
    expect(r.appliedDayRate).toBe(false);
  });
});

describe("buildPublicPriceRows", () => {
  const gazebo1 = {
    name: "Беседка №1",
    capacity: 20,
    pricePerHour: 1100,
    metadata: { priceList: { weekdayHour: 1100, weekdayDay: 11000, weekendHour: 1500, weekendDay: 14000 } },
  };
  const gazebo234 = (n: number) => ({
    name: `Беседка №${n}`,
    capacity: 12,
    pricePerHour: 800,
    metadata: { priceList: { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1100, weekendDay: 10000 } },
  });
  const gazebo5 = {
    name: "Беседка №5",
    capacity: 30,
    pricePerHour: 1400,
    metadata: {
      priceList: { weekdayHour: 1400, weekdayDay: 13000, weekendHour: 2000, weekendDay: 16000 },
      features: ["интернет", "ТВ"],
    },
  };

  it("groups gazebos with identical capacity+price into one row", () => {
    const rows = buildPublicPriceRows([gazebo1, gazebo234(2), gazebo234(3), gazebo234(4), gazebo5]);
    expect(rows.map((r) => r.name)).toEqual([
      "Беседка №1",
      "Беседки №2, 3, 4",
      "Беседка №5",
    ]);
  });

  it("carries weekend rates from metadata priceList (source-of-truth values)", () => {
    const [row1, row234, row5] = buildPublicPriceRows([gazebo1, gazebo234(2), gazebo234(3), gazebo234(4), gazebo5]);
    expect(row1.weekendHour).toBe(1500);
    expect(row234.weekendHour).toBe(1100);
    expect(row5.weekendHour).toBe(2000);
    expect(row5.weekendDay).toBe(16000);
  });

  it("exposes features as a note", () => {
    const rows = buildPublicPriceRows([gazebo5]);
    expect(rows[0].note).toBe("интернет + ТВ");
  });

  it("keeps capacity as the max within a group", () => {
    const rows = buildPublicPriceRows([gazebo234(2), gazebo234(3)]);
    expect(rows[0].capacity).toBe(12);
  });

  it("skips resources without an extractable price", () => {
    const rows = buildPublicPriceRows([
      { name: "Беседка №9", capacity: 5, pricePerHour: null, metadata: null },
    ]);
    expect(rows).toEqual([]);
  });

  it("does not group gazebos with different pricing", () => {
    const rows = buildPublicPriceRows([gazebo1, gazebo5]);
    expect(rows).toHaveLength(2);
  });
});

// ===== Полный рабочий день на реальных ценах из прайса =====
//
// Рабочее окно 11:00–22:00 = 11 часов (оферта, п. 3.4). До снятия максимума
// длительности (8 ч) ни одна бронь до дневного тарифа не дотягивала — ветка
// была мёртвой в проде.
describe("дневной тариф на полном дне (11 ч)", () => {
  const rate = (hourRate: number, dayRate: number, isWeekend: boolean) => ({
    weekdayHour: hourRate,
    weekdayDay: dayRate,
    weekendHour: hourRate,
    weekendDay: dayRate,
    hourRate,
    dayRate,
    isWeekend,
  });

  it("Беседка №1, будни: 11 × 1100 = 12100 → дневной 11000", () => {
    const r = calcBookingPrice(rate(1100, 11000, false), 11);
    expect(r.total).toBe(11000);
    expect(r.appliedDayRate).toBe(true);
    expect(r.savings).toBe(1100);
  });

  it("Беседка №5, выходные: 11 × 2000 = 22000 → дневной 16000", () => {
    const r = calcBookingPrice(rate(2000, 16000, true), 11);
    expect(r.total).toBe(16000);
    expect(r.savings).toBe(6000);
  });

  it("Беседка №2, будни: 11 × 800 = 8800 → дневной 7000", () => {
    expect(calcBookingPrice(rate(800, 7000, false), 11).total).toBe(7000);
  });
});

describe("freeHoursToFullDay", () => {
  const weekendGazebo5 = {
    weekdayHour: 1400,
    weekdayDay: 13000,
    weekendHour: 2000,
    weekendDay: 16000,
    hourRate: 2000,
    dayRate: 16000,
    isWeekend: true,
  };

  it("даёт добор, когда дневной тариф уже покрыл выбор", () => {
    // 10 ч × 2000 = 20000 → потолок 16000; весь день стоит те же 16000.
    expect(freeHoursToFullDay(weekendGazebo5, 10, 11)).toBe(1);
  });

  it("считает бесплатным добор и при точном равенстве часовой и дневной цены", () => {
    // 8 ч × 2000 = 16000 ровно равны дневному: appliedDayRate ещё false
    // (сравнение строгое), но добор до дня не дорожает — подсказка нужна.
    expect(calcBookingPrice(weekendGazebo5, 8).appliedDayRate).toBe(false);
    expect(freeHoursToFullDay(weekendGazebo5, 8, 11)).toBe(3);
  });

  it("молчит, когда добор платный", () => {
    // 5 ч × 2000 = 10000 против 16000 за день — брать день дороже.
    expect(freeHoursToFullDay(weekendGazebo5, 5, 11)).toBe(0);
  });

  it("молчит, когда день уже выбран целиком", () => {
    expect(freeHoursToFullDay(weekendGazebo5, 11, 11)).toBe(0);
  });

  it("молчит, когда дневного тарифа нет", () => {
    const noDayRate = { ...weekendGazebo5, dayRate: 0, weekendDay: 0 };
    expect(freeHoursToFullDay(noDayRate, 10, 11)).toBe(0);
  });
});
