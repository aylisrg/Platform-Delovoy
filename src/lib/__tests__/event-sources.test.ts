import { describe, it, expect } from "vitest";
import { EVENT_SOURCES } from "../event-sources";

describe("EVENT_SOURCES (issue #581)", () => {
  it("не переименовывает значения, которые читаются по точному совпадению в другом месте", () => {
    // SQL в site-watchdog.yml (beacon-divergence) и deploy-error-budget.yml
    expect(EVENT_SOURCES.CLIENT_BEACON).toBe("client-beacon");
    // src/modules/notifications/health.ts — heartbeat-проверка cron.processOutgoing
    expect(EVENT_SOURCES.CRON_PROCESS_OUTGOING).toBe("cron.processOutgoing");
  });

  it("значения уникальны — опечатка в двух константах с одинаковой строкой не пройдёт мимо", () => {
    const values = Object.values(EVENT_SOURCES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("все значения непустые строки", () => {
    for (const value of Object.values(EVENT_SOURCES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
