import { describe, it, expect } from "vitest";
import { deriveCleaningBlocks, formatCleaningDuration } from "../cleaning-blocks";

const msk = (hm: string) => `2030-06-17T${hm}:00+03:00`;
const iso = (hm: string) => new Date(msk(hm)).toISOString();
const CLOSE = new Date(msk("23:00"));
const b = (id: string, from: string, to: string, resourceId = "r-1") => ({
  id,
  resourceId,
  startTime: iso(from),
  endTime: iso(to),
});

describe("deriveCleaningBlocks (#1085)", () => {
  it("бронь 14–18 → уборка 18–19", () => {
    expect(deriveCleaningBlocks([b("a", "14:00", "18:00")], 60, CLOSE)).toEqual([
      { bookingId: "a", resourceId: "r-1", startTime: iso("18:00"), endTime: iso("19:00"), minutes: 60 },
    ]);
  });

  it("обрезается по закрытию парка", () => {
    const [c] = deriveCleaningBlocks([b("a", "18:00", "22:30")], 60, CLOSE);
    expect(c.endTime).toBe(iso("23:00"));
    expect(c.minutes).toBe(30);
    expect(deriveCleaningBlocks([b("a", "19:00", "23:00")], 60, CLOSE)).toEqual([]);
  });

  it("обрезается началом следующей брони того же ресурса, чужой ресурс не влияет", () => {
    const blocks = deriveCleaningBlocks(
      [b("a", "10:00", "14:00"), b("b", "14:30", "18:00"), b("x", "14:00", "16:00", "r-2")],
      60,
      CLOSE
    );
    expect(blocks.find((c) => c.bookingId === "a")?.minutes).toBe(30);
    expect(blocks.find((c) => c.bookingId === "x")?.minutes).toBe(60);
  });

  it("брони встык (до релиза #1067) → без уборки", () => {
    const blocks = deriveCleaningBlocks([b("a", "10:00", "14:00"), b("b", "14:00", "18:00")], 60, CLOSE);
    expect(blocks.map((c) => c.bookingId)).toEqual(["b"]);
  });

  it("буфер 0 или не задан → пусто", () => {
    expect(deriveCleaningBlocks([b("a", "14:00", "18:00")], 0, CLOSE)).toEqual([]);
    expect(deriveCleaningBlocks([b("a", "14:00", "18:00")], undefined, CLOSE)).toEqual([]);
  });

  it("перенос брони переносит уборку, отмена (бронь ушла из списка) убирает её", () => {
    const moved = deriveCleaningBlocks([b("a", "16:00", "20:00")], 60, CLOSE);
    expect(moved[0].startTime).toBe(iso("20:00"));
    expect(deriveCleaningBlocks([], 60, CLOSE)).toEqual([]);
  });

  it("formatCleaningDuration", () => {
    expect(formatCleaningDuration(60)).toBe("1 ч");
    expect(formatCleaningDuration(30)).toBe("30 мин");
    expect(formatCleaningDuration(90)).toBe("1 ч 30 мин");
  });
});
