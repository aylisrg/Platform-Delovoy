import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// #590: удаление пользователя с бронями должно проходить, брони остаются
// с userId = NULL. Проверяем и schema.prisma, и последнюю миграцию, которая
// трогает Booking_userId_fkey (CI drift-check сверяет их на реальной БД).
const root = join(__dirname, "..");

describe("Booking.userId FK", () => {
  it("schema: Booking.user is optional (default onDelete SetNull)", () => {
    const schema = readFileSync(join(root, "schema.prisma"), "utf8");
    const booking = schema.match(/model Booking \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(booking).toMatch(/userId\s+String\?/);
    const rel = booking.split("\n").find((l) => /^\s*user\s+User\?/.test(l)) ?? "";
    expect(rel).not.toBe("");
    expect(rel).not.toMatch(/onDelete:\s*(Restrict|Cascade|NoAction)/);
  });

  it("migrations: last definition of Booking_userId_fkey is ON DELETE SET NULL", () => {
    const dir = join(root, "migrations");
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    let last = "";
    for (const d of dirs) {
      let sql = "";
      try {
        sql = readFileSync(join(dir, d, "migration.sql"), "utf8");
      } catch {
        continue;
      }
      const m = sql.match(/ADD CONSTRAINT "Booking_userId_fkey"[^;]*;/g);
      if (m) last = m[m.length - 1];
    }
    expect(last).toMatch(/ON DELETE SET NULL/);
  });
});
