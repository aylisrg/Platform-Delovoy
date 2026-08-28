/**
 * One-off data migration: часы работы беседок → режим из оферты (11:00–22:00).
 *
 * Зачем и почему только известное расхождение 08–23 — см.
 * `scripts/lib/gazebo-working-hours.ts`. Идемпотентен: после первого прогона
 * (и на любом другом значении часов) ничего не меняет, поэтому безопасно живёт
 * в шаге «Run data migrations» деплоя рядом с `set-public-phone.ts`.
 *
 * Usage: npx tsx scripts/set-gazebo-working-hours.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  describeWorkingHours,
  fixDriftedWorkingHours,
} from "./lib/gazebo-working-hours";

const prisma = new PrismaClient();

const MODULE_SLUG = "gazebos";

async function main() {
  const mod = await prisma.module.findUnique({ where: { slug: MODULE_SLUG } });
  if (!mod) {
    console.log(`  ✗ Module "${MODULE_SLUG}" not found — skipping`);
    return;
  }

  const existing = (mod.config as Record<string, unknown>) ?? {};
  const before = describeWorkingHours(existing);
  const updated = fixDriftedWorkingHours(existing);

  if (!updated) {
    console.log(
      `  · ${MODULE_SLUG}: часы работы ${before} — это не расхождение 08:00–23:00, не трогаю`
    );
    return;
  }

  await prisma.module.update({
    where: { slug: MODULE_SLUG },
    data: { config: updated },
  });

  console.log(
    `  ✓ ${MODULE_SLUG}: часы работы ${before} → ${describeWorkingHours(updated)} (оферта, п. 3.4)`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
