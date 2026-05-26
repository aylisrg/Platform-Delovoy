/**
 * Unified seed pipeline orchestrator.
 *
 * Запускается:
 *   - автоматически на каждом prod-deploy (.github/workflows/deploy.yml)
 *   - вручную как emergency trigger (.github/workflows/run-seed.yml)
 *   - локально: `npm run db:seed` или `npx tsx scripts/seed.ts`
 *
 * Состав:
 *   - seedCore  — справочные данные ядра (modules, resources, menu, offices, recurring expenses)
 *   - seedTasks — модуль задач (board, columns, categories)
 *
 * Все доменные сидеры идемпотентны (см. ADR-0001 §"Идемпотентность").
 * Порядок: core → tasks (Module rows должны существовать до зависимых).
 *
 * НЕ включает seed-rental.ts — там PII, остаётся отдельным admin-only скриптом.
 *
 * См. docs/adr/ADR-0001-unified-seed-pipeline.md
 */
import { PrismaClient } from "@prisma/client";
import { seedParks } from "./seeds/parks";
import { seedCore } from "./seeds/core";
import { seedTasks } from "./seeds/tasks";
import { seedNedelovoyGrants } from "./seeds/nedelovoy-grants";
import { seedDevOverlay } from "./seeds/dev-overlay";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log("🌱 Seed pipeline started");
    await seedParks(prisma); // Parks must exist before Module grants that reference them
    await seedCore(prisma);
    await seedTasks(prisma);
    await seedNedelovoyGrants(prisma); // After seedCore — Module records must exist
    if (process.env.DEV_OVERLAY === "1") {
      await seedDevOverlay(prisma);
    }
    console.log("✅ Seed pipeline completed");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});
