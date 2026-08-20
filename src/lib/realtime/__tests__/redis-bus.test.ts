import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock redis before importing the bus
vi.mock("@/lib/redis", () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(1),
  },
  redisAvailable: false, // default: fallback mode
}));

import * as redisMod from "@/lib/redis";
import { publish, subscribe } from "../redis-bus";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publish — in-memory fallback (redisAvailable=false)", () => {
  it("fan-outs to local subscribers without calling redis.publish", async () => {
    const received: unknown[] = [];
    const unsub = subscribe("test:channel", (e) => received.push(e));

    await publish("test:channel", { type: "test.event", data: 42 });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("test.event");
    expect(redisMod.redis.publish).not.toHaveBeenCalled();

    unsub();
  });

  it("does NOT deliver to different channel", async () => {
    const received: unknown[] = [];
    const unsub = subscribe("channel:A", (e) => received.push(e));

    await publish("channel:B", { type: "other.event" });

    expect(received).toHaveLength(0);
    unsub();
  });

  it("unsubscribe stops delivery", async () => {
    const received: unknown[] = [];
    const unsub = subscribe("test:channel2", (e) => received.push(e));

    await publish("test:channel2", { type: "first" });
    unsub();
    await publish("test:channel2", { type: "second" });

    expect(received).toHaveLength(1);
  });

  it("multiple subscribers on same channel all receive", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = subscribe("test:multi", (e) => a.push(e));
    const unsubB = subscribe("test:multi", (e) => b.push(e));

    await publish("test:multi", { type: "ping" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    unsubA();
    unsubB();
  });
});

describe("publish — redis mode (redisAvailable=true)", () => {
  it("calls redis.publish with serialized JSON", async () => {
    // Temporarily set redisAvailable to true
    vi.spyOn(redisMod, "redisAvailable", "get").mockReturnValue(true);

    await publish("some:channel", { type: "chat.message.created", chatId: "c1" });

    expect(redisMod.redis.publish).toHaveBeenCalledWith(
      "some:channel",
      expect.stringContaining('"type":"chat.message.created"'),
    );
  });
});

// getSubscriber() достаёт ioredis динамическим require — TypeScript такой вызов
// не проверяет, а unit-тесты выше идут по fallback-ветке (redisAvailable=false)
// и до него не доходят. Значит major-обновление ioredis может сломать
// подписчика молча: сборка и тесты зелёные, realtime в проде мёртв.
// Этот блок фиксирует ровно тот контракт, на который опирается redis-bus.
describe("ioredis CJS-интероп — контракт getSubscriber()", () => {
  it('require("ioredis") возвращает конструктор', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    expect(typeof Redis).toBe("function");
  });

  it("принимает опции подписчика и с lazyConnect не открывает соединение", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    const client = new Redis("redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 500, 15_000),
    });

    // lazyConnect ⇒ сокет не открыт, статус "wait" до явного connect().
    expect(client.status).toBe("wait");
    expect(typeof client.subscribe).toBe("function");
    expect(typeof client.unsubscribe).toBe("function");
    expect(typeof client.on).toBe("function");

    client.disconnect();
  });
});
