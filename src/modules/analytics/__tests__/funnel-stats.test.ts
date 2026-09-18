import { describe, it, expect } from "vitest";
import { aggregateFunnelStats, round1 } from "../funnel-stats";

describe("round1", () => {
  it("округляет до одного знака после запятой", () => {
    expect(round1(24.666)).toBe(24.7);
    expect(round1(0)).toBe(0);
  });
});

describe("aggregateFunnelStats", () => {
  const period = { dateFrom: "2026-09-14", dateTo: "2026-09-20" };

  it("считает конверсию от предыдущего и от первого шага", () => {
    const rows = [
      { funnel: "gazebos", step: "view", events: 100, sessions: 100 },
      { funnel: "gazebos", step: "slot_selected", events: 40, sessions: 40 },
      { funnel: "gazebos", step: "submitted", events: 10, sessions: 10 },
      { funnel: "gazebos", step: "paid", events: 5, sessions: 5 },
    ];

    const result = aggregateFunnelStats(rows, period, "gazebos");
    const funnel = result.funnels[0];

    expect(funnel.steps[0]).toMatchObject({ sessions: 100, conversionFromPrev: null, conversionFromTop: 100 });
    expect(funnel.steps[1]).toMatchObject({ sessions: 40, conversionFromPrev: 40, conversionFromTop: 40 });
    expect(funnel.steps[2]).toMatchObject({ sessions: 10, conversionFromPrev: 25, conversionFromTop: 10 });
    expect(funnel.steps[3]).toMatchObject({ sessions: 5, conversionFromPrev: 50, conversionFromTop: 5 });
    expect(funnel.biggestDropStep).toBe("submitted");
  });

  it("пустой вход — нулевые шаги, без деления на ноль", () => {
    const result = aggregateFunnelStats([], period, "rental");
    const funnel = result.funnels[0];
    expect(funnel.steps.every((s) => s.events === 0 && s.sessions === 0)).toBe(true);
    expect(funnel.steps[0].conversionFromPrev).toBeNull();
    expect(funnel.steps[1].conversionFromPrev).toBe(0);
  });

  it("без funnel — считает по всем воронкам каталога", () => {
    const result = aggregateFunnelStats([], period);
    expect(result.funnels.map((f) => f.funnel).sort()).toEqual(["cafe", "gazebos", "ps-park", "rental"].sort());
  });

  it("возвращает переданный period без изменений", () => {
    const result = aggregateFunnelStats([], period, "cafe");
    expect(result.period).toEqual(period);
  });
});
