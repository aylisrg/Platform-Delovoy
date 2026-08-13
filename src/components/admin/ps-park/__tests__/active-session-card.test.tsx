import { describe, it, expect } from "vitest";
import { formatOverrun } from "../active-session-card";

// ADR F2 §Тесты — fallback набор на момент написания: jsdom-инфры ещё не было,
// поэтому покрывали только чистый helper. jsdom + @testing-library/react
// появились в #425 (см. src/components/admin/gazebos/__tests__/booking-detail-card.test.tsx
// для примера) — DOM-уровень тесты состояний (зелёный/жёлтый/красный/boundary)
// для этой карточки всё ещё не добавлены, задел на отдельный PR.

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
