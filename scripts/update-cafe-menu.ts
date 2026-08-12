/**
 * Приводит меню кафе в БД к настенному прайсу (scripts/lib/cafe-menu.ts).
 *
 * Зачем отдельный скрипт, а не сид: seedCore намеренно НЕ перезаписывает цены
 * существующих позиций (менеджер правит их из админки), поэтому наполненную БД
 * он исправить не может. Этот скрипт может — запускается разово после смены
 * прайса, дальше меню живёт в админке. Идемпотентен: повторный запуск = то же
 * состояние. Логика и её тесты — scripts/lib/cafe-menu-sync.ts.
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/update-cafe-menu.ts [--dry-run]
 */
import { PrismaClient } from "@prisma/client";
import { CAFE_MENU } from "./lib/cafe-menu";
import { syncCafeMenu } from "./lib/cafe-menu-sync";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(
    `→ Синхронизирую меню кафе с прайсом (${CAFE_MENU.length} позиций)${dryRun ? " [DRY RUN]" : ""}…\n`,
  );

  const changes = await syncCafeMenu(prisma, { dryRun });

  for (const change of changes) {
    const icon = change.action === "без изменений" ? "·" : "✓";
    console.log(`  ${icon} [${change.action}] ${change.detail}`);
  }

  const touched = changes.filter((c) => c.action !== "без изменений").length;
  console.log(
    `\n${dryRun ? "🔍 DRY RUN:" : "✅"} ${touched} изменений, ${changes.length - touched} без изменений`,
  );
  if (dryRun) console.log("   Ничего не записано. Запусти без --dry-run, чтобы применить.");
}

main()
  .catch((e) => {
    console.error(`\n❌ ${(e as Error).message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
