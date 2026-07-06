import { describe, it, expect } from "vitest";
import { redisRetryDelay, redisRetryStrategy } from "../redis";

describe("redisRetryDelay — реконнект никогда не прекращается", () => {
  it("возвращает число (не null) для любого количества попыток", () => {
    for (const times of [1, 5, 10, 11, 100, 10_000]) {
      const delay = redisRetryDelay(times);
      expect(typeof delay).toBe("number");
      expect(delay).toBeGreaterThan(0);
    }
  });

  it("растёт и упирается в потолок 15s", () => {
    expect(redisRetryDelay(1)).toBe(500);
    expect(redisRetryDelay(10)).toBe(5_000);
    expect(redisRetryDelay(30)).toBe(15_000);
    expect(redisRetryDelay(1_000)).toBe(15_000);
  });
});

describe("redisRetryStrategy — в тестовой среде попытки ограничены", () => {
  // Vitest выставляет VITEST=true, поэтому здесь активна тестовая ветка:
  // без неё бесконечный реконнект держал бы event loop и подвешивал прогон.
  it("останавливается после пары попыток под vitest", () => {
    expect(redisRetryStrategy(1)).toBe(500);
    expect(redisRetryStrategy(2)).toBe(1_000);
    expect(redisRetryStrategy(3)).toBeNull();
  });
});
