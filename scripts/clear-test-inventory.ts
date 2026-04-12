#!/usr/bin/env tsx
/**
 * Скрипт очистки тестовых данных инвентаря.
 * Запуск: npm run clear-test-inventory
 *
 * Удаляет SKU и их транзакции, если:
 *   - Название содержит тестовые маркеры (test, тест, demo, демо)
 *   - Или SKU создан до PROD_CUTOFF_DATE
 *
 * Требует подтверждения "yes" перед удалением.
 */

import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

// Всё созданное до этой даты считается тестом. Настрой перед запуском.
const PROD_CUTOFF_DATE = new Date("2026-04-12T00:00:00Z");

const TEST_NAME_PATTERNS = ["test", "тест", "demo", "демо"];

async function findTestSkus() {
  return prisma.inventorySku.findMany({
    where: {
      OR: [
        ...TEST_NAME_PATTERNS.map((p) => ({
          name: { contains: p, mode: "insensitive" as const },
        })),
        { createdAt: { lt: PROD_CUTOFF_DATE } },
      ],
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  console.log("Поиск тестовых данных инвентаря...\n");

  const testSkus = await findTestSkus();

  if (testSkus.length === 0) {
    console.log("Тестовых данных не найдено. Ничего не удалено.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Найдено тестовых SKU для удаления: ${testSkus.length}`);
  console.log("─".repeat(60));
  let totalTransactions = 0;
  for (const sku of testSkus) {
    const date = sku.createdAt.toISOString().slice(0, 10);
    const txCount = sku._count.transactions;
    console.log(`  [${date}] "${sku.name}" — ${txCount} транз.`);
    totalTransactions += txCount;
  }
  console.log("─".repeat(60));
  console.log(`Итого: ${testSkus.length} SKU, ${totalTransactions} транзакций\n`);

  const ok = await confirm('Удалить перечисленные данные? Введите "yes" для подтверждения: ');

  if (!ok) {
    console.log("Отменено. Ничего не удалено.");
    await prisma.$disconnect();
    return;
  }

  const skuIds = testSkus.map((s) => s.id);

  const deletedTx = await prisma.inventoryTransaction.deleteMany({
    where: { skuId: { in: skuIds } },
  });

  const deletedSku = await prisma.inventorySku.deleteMany({
    where: { id: { in: skuIds } },
  });

  console.log(`\nГотово. Удалено: ${deletedSku.count} SKU, ${deletedTx.count} транзакций.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Ошибка:", e);
  await prisma.$disconnect();
  process.exit(1);
});
