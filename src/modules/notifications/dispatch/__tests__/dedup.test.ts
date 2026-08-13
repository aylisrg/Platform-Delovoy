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

// ADR 2026-08-13-miniapp-role-rebuild §7: для событий-состояний ключ строится
// по (userId|eventType|entityId) — два разных текста об одном состоянии внутри
// окна это дубль. Для потоков сообщений (messenger.*, task.*) — прежнее
// поведение по payload, иначе разные сообщения схлопнулись бы в одно.
describe("computeDedupKey — entity-scoped events", () => {
  const twoBodies = (eventType: string, entityId: string) => {
    const first = computeDedupKey({
      userId: "u1",
      eventType,
      entityId,
      payload: { title: "Новая бронь", body: "Беседка №3, 14:00–18:00" },
    });
    const second = computeDedupKey({
      userId: "u1",
      eventType,
      entityId,
      payload: { title: "Бронь создана", body: "Совсем другая формулировка" },
    });
    return { first, second };
  };

  it.each([
    ["booking.created", "bk-1"],
    ["booking.cancelled", "bk-1"],
    ["order.placed", "ord-1"],
    ["payment.succeeded", "pay-1"],
    ["payment.refund.succeeded", "pay-1"],
    ["contract.expiring", "ct-1"],
    ["inquiry.created", "inq-1"],
    ["system.release", "2.11.0"],
    ["BROADCAST", "camp-1"],
  ])("%s collapses different bodies for the same entity", (eventType, entityId) => {
    const { first, second } = twoBodies(eventType, entityId);
    expect(first).toBe(second);
  });

  it("still separates different entities of a state event", () => {
    const a = computeDedupKey({
      userId: "u1",
      eventType: "booking.created",
      entityId: "bk-1",
      payload: { title: "t", body: "b" },
    });
    const b = computeDedupKey({
      userId: "u1",
      eventType: "booking.created",
      entityId: "bk-2",
      payload: { title: "t", body: "b" },
    });
    expect(a).not.toBe(b);
  });

  it("still separates recipients of the same state event", () => {
    const a = computeDedupKey({
      userId: "u1",
      eventType: "system.release",
      entityId: "2.11.0",
      payload: { title: "t", body: "b" },
    });
    const b = computeDedupKey({
      userId: "u2",
      eventType: "system.release",
      entityId: "2.11.0",
      payload: { title: "t", body: "b" },
    });
    expect(a).not.toBe(b);
  });

  it("REGRESSION: messenger.message.received keeps per-message keys in one chat", () => {
    const { first, second } = twoBodies("messenger.message.received", "chat-1");
    expect(first).not.toBe(second);
  });

  it.each(["task.created", "task.commented", "task.assigned"])(
    "REGRESSION: %s keeps per-payload keys for one task",
    (eventType) => {
      const { first, second } = twoBodies(eventType, "task-1");
      expect(first).not.toBe(second);
    }
  );

  it("without entityId an allowlisted event falls back to payload hashing", () => {
    const a = computeDedupKey({
      userId: "u1",
      eventType: "booking.created",
      payload: { title: "t", body: "b1" },
    });
    const b = computeDedupKey({
      userId: "u1",
      eventType: "booking.created",
      payload: { title: "t", body: "b2" },
    });
    expect(a).not.toBe(b);
  });

  it("does not treat a lookalike prefix as entity-scoped", () => {
    // "systemic.*" не входит в аллоулист — только точный префикс "system."
    const { first, second } = twoBodies("systemic.alert", "e-1");
    expect(first).not.toBe(second);
  });
});
