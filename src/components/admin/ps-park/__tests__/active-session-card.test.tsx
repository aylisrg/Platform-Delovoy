import { describe, it, expect } from "vitest";
import { formatOverrun } from "../active-session-card";

// ADR F2 §Тесты — fallback набор: jsdom-инфра отсутствует, поэтому покрываем
// чистый helper. DOM-уровень тесты состояний (зелёный/жёлтый/красный/boundary)
// добавим отдельным мини-PR с @testing-library/react + jsdom — см. ADR.

describe("formatOverrun", () => {
  it("returns minutes when overrun < 60", () => {
    expect(formatOverrun(0)).toBe("Просрочено: +0 мин");
    expect(formatOverrun(5)).toBe("Просрочено: +5 мин");
    expect(formatOverrun(59)).toBe("Просрочено: +59 мин");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatOverrun(60)).toBe("Просрочено: +1 ч");
    expect(formatOverrun(120)).toBe("Просрочено: +2 ч");
  });

  it("returns hours and minutes when overrun > 60 with remainder", () => {
    expect(formatOverrun(83)).toBe("Просрочено: +1 ч 23 мин");
    expect(formatOverrun(125)).toBe("Просрочено: +2 ч 5 мин");
  });

  it("handles multi-hour overrun without upper bound (PO Решение 2)", () => {
    expect(formatOverrun(180)).toBe("Просрочено: +3 ч");
    expect(formatOverrun(605)).toBe("Просрочено: +10 ч 5 мин");
  });
});
