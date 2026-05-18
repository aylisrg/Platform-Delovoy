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
