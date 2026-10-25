import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUPERADMIN_TELEGRAM_ID,
  getSeededSuperadminTelegramId,
  isSeededSuperadmin,
} from "@/lib/seeded-superadmin";

describe("seeded superadmin", () => {
  it("uses SUPERADMIN_TELEGRAM_ID when set", () => {
    expect(getSeededSuperadminTelegramId({ SUPERADMIN_TELEGRAM_ID: "42" })).toBe("42");
  });

  it("falls back to the same default the seed used before", () => {
    expect(getSeededSuperadminTelegramId({})).toBe(DEFAULT_SUPERADMIN_TELEGRAM_ID);
  });

  it("matches only the configured telegramId, never a missing one", () => {
    const env = { SUPERADMIN_TELEGRAM_ID: "42" };
    expect(isSeededSuperadmin({ telegramId: "42" }, env)).toBe(true);
    expect(isSeededSuperadmin({ telegramId: "43" }, env)).toBe(false);
    expect(isSeededSuperadmin({ telegramId: null }, env)).toBe(false);
  });
});
