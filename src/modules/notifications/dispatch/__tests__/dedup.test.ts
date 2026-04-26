import { describe, expect, it } from "vitest";
import { computeDedupKey } from "../dedup";

describe("computeDedupKey", () => {
  it("is stable for identical inputs", () => {
    const a = computeDedupKey({
      userId: "u1",
      eventType: "task.created",
      entityId: "t1",
      payload: { title: "Hi", body: "There" },
    });
    const b = computeDedupKey({
      userId: "u1",
      eventType: "task.created",
      entityId: "t1",
      payload: { title: "Hi", body: "There" },
    });
    expect(a).toBe(b);
  });

  it("differs by userId / eventType / entityId / payload", () => {
    const base = {
      userId: "u1",
      eventType: "task.created",
      entityId: "t1",
      payload: { title: "Hi", body: "There" },
    };
    const k = computeDedupKey(base);
    expect(computeDedupKey({ ...base, userId: "u2" })).not.toBe(k);
    expect(computeDedupKey({ ...base, eventType: "task.updated" })).not.toBe(k);
    expect(computeDedupKey({ ...base, entityId: "t2" })).not.toBe(k);
    expect(
      computeDedupKey({ ...base, payload: { title: "Hi!", body: "There" } })
    ).not.toBe(k);
    expect(
      computeDedupKey({ ...base, payload: { title: "Hi", body: "There." } })
    ).not.toBe(k);
  });

  it("ignores undefined entityId vs missing", () => {
    const k1 = computeDedupKey({
      userId: "u1",
      eventType: "x",
      payload: { title: "a", body: "b" },
    });
    const k2 = computeDedupKey({
      userId: "u1",
      eventType: "x",
      entityId: undefined,
      payload: { title: "a", body: "b" },
    });
    expect(k1).toBe(k2);
  });
});
