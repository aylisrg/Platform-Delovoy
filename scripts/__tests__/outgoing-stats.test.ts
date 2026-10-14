import { describe, it, expect } from "vitest";
import { aggregate, dubaiDayRange, dubaiHour, formatStats, hashKey, type StatsRow } from "../outgoing-stats-lib";

const row = (iso: string, o: Partial<StatsRow> = {}): StatsRow => ({
  status: "SENT",
  eventType: "booking.created",
  channelKind: "TELEGRAM",
  dedupKey: "k1",
  createdAt: new Date(iso),
  ...o,
});

describe("dubaiDayRange", () => {
  it("сутки по Дубаю = UTC-4h", () => {
    const { from, to } = dubaiDayRange("2026-10-13");
    expect(from.toISOString()).toBe("2026-10-12T20:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-13T20:00:00.000Z");
  });
  it("отклоняет кривую дату", () => {
    expect(() => dubaiDayRange("13.10.2026")).toThrow();
    expect(() => dubaiDayRange("2026-10-13; drop")).toThrow();
  });
  it("час по Дубаю", () => {
    expect(dubaiHour(new Date("2026-10-12T20:00:00Z"))).toBe("00");
    expect(dubaiHour(new Date("2026-10-13T19:59:59Z"))).toBe("23");
  });
});

describe("aggregate", () => {
  it("считает по часам, статусам, каналам, типам и отбрасывает чужие сутки", () => {
    const s = aggregate(
      [
        row("2026-10-12T19:59:59Z"), // 12.10 по Дубаю, не считается
        row("2026-10-12T20:10:00Z"),
        row("2026-10-12T20:20:00Z", { status: "FAILED", channelKind: "EMAIL", dedupKey: "k2" }),
        row("2026-10-13T05:00:00Z", { eventType: "task.assigned", dedupKey: "k3" }),
        row("2026-10-13T20:00:00Z"), // 14.10 по Дубаю
      ],
      "2026-10-13"
    );
    expect(s.total).toBe(3);
    expect(s.byStatus).toEqual({ SENT: 2, FAILED: 1 });
    expect(s.byChannel).toEqual({ TELEGRAM: 2, EMAIL: 1 });
    expect(s.hours[0].total).toBe(2);
    expect(s.hours[0].byStatus).toEqual({ SENT: 1, FAILED: 1 });
    expect(s.hours[9].byEventType).toEqual({ "task.assigned": 1 });
    expect(s.hours.reduce((a, h) => a + h.total, 0)).toBe(3);
  });

  it("дубли: только SENT >1, сортировка, top N, ключ хэширован", () => {
    const t = "2026-10-13T06:00:00Z";
    const s = aggregate(
      [
        row(t, { dedupKey: "a" }),
        row(t, { dedupKey: "a" }),
        row(t, { dedupKey: "a" }),
        row(t, { dedupKey: "b", eventType: "x" }),
        row(t, { dedupKey: "b", eventType: "x" }),
        row(t, { dedupKey: "c", status: "FAILED" }),
        row(t, { dedupKey: "c", status: "FAILED" }),
        row(t, { dedupKey: "d" }),
      ],
      "2026-10-13",
      1
    );
    expect(s.duplicates.keysWithMultipleSent).toBe(2);
    expect(s.duplicates.extraSentRows).toBe(3);
    expect(s.duplicates.top).toEqual([{ keyHash: hashKey("a"), eventType: "booking.created", sentCount: 3 }]);
  });

  it("в выводе нет сырых dedupKey", () => {
    const secret = "booking:79991234567:abc";
    const t = "2026-10-13T06:00:00Z";
    const out = formatStats(aggregate([row(t, { dedupKey: secret }), row(t, { dedupKey: secret })], "2026-10-13"));
    expect(out).not.toContain(secret);
    expect(out).not.toContain("79991234567");
    expect(out).toContain(hashKey(secret));
    expect(hashKey(secret)).toHaveLength(12);
  });
});
