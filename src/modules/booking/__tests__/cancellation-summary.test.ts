import { describe, it, expect } from "vitest";
import {
  buildCancellationSummary,
  cancellationSummaryText,
  RESCHEDULE_WINDOW_DAYS,
} from "../cancellation-summary";
import { PREPAID_CANCELLATION_POLICY } from "../types";

describe("buildCancellationSummary", () => {
  const summary = buildCancellationSummary();

  it("называет фактический порог отмены из политики, а не хардкод", () => {
    expect(summary.lines[0]).toContain(`${PREPAID_CANCELLATION_POLICY.thresholdHours} часа`);
  });

  it("прямо говорит, что позже порога аренда не возвращается", () => {
    expect(PREPAID_CANCELLATION_POLICY.penaltyPercent).toBe(100);
    expect(summary.lines[0]).toContain("не возвращается");
  });

  it("описывает перенос: срок предупреждения и окно дат", () => {
    expect(summary.lines[1]).toContain("бесплатно перенести");
    expect(summary.lines[1]).toContain(String(RESCHEDULE_WINDOW_DAYS));
  });

  it("предупреждает про неявку — п. 7.8 оферты", () => {
    expect(summary.lines[2]).toContain("не приехать и не предупредить");
  });

  it("ведёт за подробностями в раздел 7 оферты", () => {
    expect(summary.detailsHref).toBe("/oferta#p-7");
  });

  it("даёт тот же текст в плоском виде — письмо и экран не разъезжаются", () => {
    const text = cancellationSummaryText();
    for (const line of summary.lines) {
      expect(text).toContain(line);
    }
  });
});
