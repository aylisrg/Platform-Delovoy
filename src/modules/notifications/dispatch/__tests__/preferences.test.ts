import { describe, expect, it } from "vitest";
import type {
  NotificationEventPreference,
  NotificationGlobalPreference,
  UserNotificationChannel,
} from "@prisma/client";
import { mergePreferences, pickChannel } from "../preferences";

const baseDate = new Date();

const ch = (
  overrides: Partial<UserNotificationChannel>
): UserNotificationChannel => ({
  id: "c1",
  userId: "u1",
  kind: "TELEGRAM",
  address: "12345",
  label: null,
  priority: 100,
  isActive: true,
  verifiedAt: baseDate,
  verificationCodeHash: null,
  verificationExpiresAt: null,
  verificationAttempts: 0,
  createdAt: baseDate,
  updatedAt: baseDate,
  ...overrides,
});

describe("mergePreferences", () => {
  it("uses defaults when no rows present", () => {
    const m = mergePreferences(null, null);
    expect(m.enabled).toBe(true);
    expect(m.channelKinds).toEqual([]);
    expect(m.timezone).toBe("Europe/Moscow");
  });

  it("event-level overrides global timezone", () => {
    const global = {
      userId: "u1",
      timezone: "UTC",
      quietHoursFrom: null,
      quietHoursTo: null,
      dndUntil: null,
      updatedAt: baseDate,
    } as NotificationGlobalPreference;
    const ev = {
      id: "e1",
      userId: "u1",
      eventType: "task.created",
      enabled: true,
      channelKinds: ["EMAIL"],
      quietHoursFrom: null,
      quietHoursTo: null,
      quietWeekdaysOnly: false,
      timezone: "Asia/Tokyo",
      dndUntil: null,
      createdAt: baseDate,
      updatedAt: baseDate,
    } as unknown as NotificationEventPreference;
    const m = mergePreferences(global, ev);
    expect(m.timezone).toBe("Asia/Tokyo");
    expect(m.channelKinds).toEqual(["EMAIL"]);
  });
});

describe("pickChannel", () => {
  const allAvailable = () => true;

  it("picks channel matching first preference kind", () => {
    const channels = [ch({ id: "tg", kind: "TELEGRAM", priority: 1 }), ch({ id: "em", kind: "EMAIL", priority: 2 })];
    const result = pickChannel(
      channels,
      {
        enabled: true,
        channelKinds: ["EMAIL", "TELEGRAM"],
        quietHoursFrom: null,
        quietHoursTo: null,
        quietWeekdaysOnly: false,
        timezone: "Europe/Moscow",
        dndUntil: null,
      },
      allAvailable
    );
    expect(result?.id).toBe("em");
  });

  it("falls back to user's lowest-priority verified channel when no preference", () => {
    const channels = [
      ch({ id: "tg", kind: "TELEGRAM", priority: 5 }),
      ch({ id: "em", kind: "EMAIL", priority: 1 }),
    ];
    const result = pickChannel(
      channels,
      {
        enabled: true,
        channelKinds: [],
        quietHoursFrom: null,
        quietHoursTo: null,
        quietWeekdaysOnly: false,
        timezone: "Europe/Moscow",
        dndUntil: null,
      },
      allAvailable
    );
    expect(result?.id).toBe("em");
  });

  it("skips unverified channels", () => {
    const channels = [
      ch({ id: "tg", kind: "TELEGRAM", priority: 1, verifiedAt: null }),
      ch({ id: "em", kind: "EMAIL", priority: 5 }),
    ];
    const result = pickChannel(
      channels,
      {
        enabled: true,
        channelKinds: [],
        quietHoursFrom: null,
        quietHoursTo: null,
        quietWeekdaysOnly: false,
        timezone: "Europe/Moscow",
        dndUntil: null,
      },
      allAvailable
    );
    expect(result?.id).toBe("em");
  });

  it("skips channels marked unavailable in registry", () => {
    const channels = [
      ch({ id: "tg", kind: "TELEGRAM", priority: 1 }),
      ch({ id: "em", kind: "EMAIL", priority: 2 }),
    ];
    const onlyEmail = (k: import("@prisma/client").NotificationChannelKind) =>
      k === "EMAIL";
    const result = pickChannel(
      channels,
      {
        enabled: true,
        channelKinds: ["TELEGRAM", "EMAIL"],
        quietHoursFrom: null,
        quietHoursTo: null,
        quietWeekdaysOnly: false,
        timezone: "Europe/Moscow",
        dndUntil: null,
      },
      onlyEmail
    );
    expect(result?.id).toBe("em");
  });

  it("returns null when no verified+available channels", () => {
    expect(
      pickChannel(
        [],
        {
          enabled: true,
          channelKinds: [],
          quietHoursFrom: null,
          quietHoursTo: null,
          quietWeekdaysOnly: false,
          timezone: "Europe/Moscow",
          dndUntil: null,
        },
        allAvailable
      )
    ).toBeNull();
  });
});
