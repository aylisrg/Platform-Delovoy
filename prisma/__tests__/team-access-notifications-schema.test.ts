import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR 2026-10-25-team-access-notifications §3: схема и миграция фазы 1.
// CI drift-check сверяет миграцию со schema.prisma на реальной БД; здесь —
// инварианты, которые drift-check не ловит (аддитивность, перенос данных).
const root = join(__dirname, "..");
const schema = readFileSync(join(root, "schema.prisma"), "utf8");
const migration = readFileSync(
  join(root, "migrations", "20261025120000_team_access_notifications", "migration.sql"),
  "utf8",
);

function model(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("team-access-notifications schema", () => {
  it("User gets sessionVersion (default 0) and lastLoginAt", () => {
    const user = model("User");
    expect(user).toMatch(/sessionVersion\s+Int\s+@default\(0\)/);
    expect(user).toMatch(/lastLoginAt\s+DateTime\?/);
  });

  it("ModuleNotificationRecipient cascades from both Module and User", () => {
    const m = model("ModuleNotificationRecipient");
    expect(m).toMatch(/@@id\(\[moduleSlug, userId\]\)/);
    expect(m).toMatch(/module\s+Module\s+@relation\(fields: \[moduleSlug\], references: \[slug\], onDelete: Cascade/);
    expect(m).toMatch(/user\s+User\s+@relation\("ModuleRecipientUser".*onDelete: Cascade/);
  });

  it("NotificationLink cascades from OutgoingNotification and has a unique code", () => {
    const m = model("NotificationLink");
    expect(m).toMatch(/code\s+String\s+@unique/);
    expect(m).toMatch(/outgoing\s+OutgoingNotification\s+@relation\(.*onDelete: Cascade/);
    expect(m).toMatch(/@@unique\(\[outgoingId, actionIndex\]\)/);
  });

  it("reaction columns exist on both notification sources", () => {
    for (const name of ["OutgoingNotification", "InAppNotification"]) {
      const m = model(name);
      expect(m).toMatch(/clickedAt\s+DateTime\?/);
      expect(m).toMatch(/clickCount\s+Int\s+@default\(0\)/);
      expect(m).toMatch(/readVia\s+String\?/);
    }
    expect(model("OutgoingNotification")).toMatch(/failureCode\s+String\?/);
  });

  it("TelegramBotContact is keyed by telegramId (lives before account linking, AC-E1.3)", () => {
    expect(model("TelegramBotContact")).toMatch(/telegramId\s+String\s+@id/);
  });

  it("migration is additive only", () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN/i);
  });

  it("migration copies JSON recipient lists, remapping merged accounts", () => {
    expect(migration).toMatch(/jsonb_array_elements_text/);
    expect(migration).toMatch(/COALESCE\(u\."mergedIntoUserId", u\."id"\)/);
  });

  it("migration backfills bot contacts idempotently and lastLoginAt from the audit log", () => {
    expect(migration).toMatch(/INSERT INTO "TelegramBotContact"[\s\S]*ON CONFLICT \("telegramId"\) DO NOTHING/);
    expect(migration).toMatch(/'auth\.signin\.success'/);
  });
});
