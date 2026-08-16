import { describe, it, expect } from "vitest";
import { EVENT_SOURCES } from "../event-sources";

describe("EVENT_SOURCES (issue #581)", () => {
  it("не переименовывает значения, которые читаются по точному совпадению в другом месте", () => {
    // scripts/lib/log-reader.ts WARNING_SOURCES
    expect(EVENT_SOURCES.CLIENT_BEACON).toBe("client-beacon");
    expect(EVENT_SOURCES.RATE_LIMIT).toBe("rate-limit");
    // scripts/lib/pattern-extractor.ts — fingerprint по metadata.digest
    expect(EVENT_SOURCES.SERVER_ERROR).toBe("server-error");
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
