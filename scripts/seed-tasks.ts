/**
 * Seed for tasks module — default board, columns, categories, and Module row.
 * Idempotent: safe to re-run; uses upsert by slug.
 *
 * Usage:
 *   npx tsx scripts/seed-tasks.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding tasks module...");

  // Module registration
  await prisma.module.upsert({
    where: { slug: "tasks" },
    create: {
      slug: "tasks",
      name: "Задачи",
      description: "Единый канбан задач и обращений",
      isActive: true,
    },
    update: {},
  });
  console.log("  ✓ Module 'tasks' registered");

  const generalBoard = await prisma.taskBoard.upsert({
    where: { slug: "general" },
    create: {
      slug: "general",
      name: "Задачи Делового",
      description: "Общая доска задач и обращений арендаторов",
      isDefault: true,
      sortOrder: 0,
    },
    update: { name: "Задачи Делового", isDefault: true },
  });
  console.log(`  ✓ Board 'general' (${generalBoard.id})`);

  const columns = [
    { name: "Входящие", color: "#6B7280", sortOrder: 0, isTerminal: false, wipLimit: null },
    { name: "Триаж", color: "#F59E0B", sortOrder: 1, isTerminal: false, wipLimit: null },
    { name: "В работе", color: "#3B82F6", sortOrder: 2, isTerminal: false, wipLimit: 10 },
    { name: "Ждём ответа", color: "#A855F7", sortOrder: 3, isTerminal: false, wipLimit: null },
    { name: "Готово", color: "#10B981", sortOrder: 4, isTerminal: true, wipLimit: null },
    { name: "Архив", color: "#4B5563", sortOrder: 5, isTerminal: true, wipLimit: null },
  ];
  for (const c of columns) {
    const existing = await prisma.taskColumn.findFirst({
      where: { boardId: generalBoard.id, sortOrder: c.sortOrder },
    });
    if (existing) {
      await prisma.taskColumn.update({
        where: { id: existing.id },
        data: c,
      });
    } else {
      await prisma.taskColumn.create({
        data: { ...c, boardId: generalBoard.id },
      });
    }
  }
  console.log(`  ✓ ${columns.length} columns`);

  const categories: Array<{
    slug: string;
    name: string;
    color: string;
    keywords: string[];
    sortOrder: number;
    priorityHint?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }> = [
    {
      slug: "rental",
      name: "Аренда",
      color: "#0EA5E9",
      keywords: ["аренда", "офис", "договор", "оплата"],
      sortOrder: 1,
    },
    {
      slug: "cafe",
      name: "Кафе",
      color: "#F59E0B",
      keywords: ["кафе", "меню", "заказ", "еда"],
      sortOrder: 2,
    },
    {
      slug: "ps-park",
      name: "PS Park",
      color: "#8B5CF6",
      keywords: ["плейстейшн", "ps", "столик", "геймпад"],
      sortOrder: 3,
    },
    {
      slug: "gazebos",
      name: "Беседки",
      color: "#10B981",
      keywords: ["беседка", "мангал", "дрова"],
      sortOrder: 4,
    },
    {
      slug: "parking",
      name: "Парковка",
      color: "#6B7280",
      keywords: ["парковка", "машина", "шлагбаум"],
      sortOrder: 5,
    },
    {
      slug: "cleaning",
      name: "Уборка",
      color: "#22D3EE",
      keywords: ["уборка", "грязно", "мусор", "туалет"],
      sortOrder: 6,
    },
    {
      slug: "security",
      name: "Безопасность",
      color: "#EF4444",
      keywords: ["охрана", "видеонаблюдение", "ключ"],
      sortOrder: 7,
      priorityHint: "HIGH",
    },
    {
      slug: "it",
      name: "IT",
      color: "#A855F7",
      keywords: ["wi-fi", "wifi", "интернет", "связь", "роутер"],
      sortOrder: 8,
    },
    {
      slug: "uncategorized",
      name: "Без категории",
      color: "#9CA3AF",
      keywords: [],
      sortOrder: 99,
    },
  ];
  for (const c of categories) {
    await prisma.taskCategory.upsert({
      where: { slug: c.slug },
      create: c,
      update: { name: c.name, color: c.color, keywords: c.keywords },
    });
  }
  console.log(`  ✓ ${categories.length} categories`);

  console.log("\n✅ tasks seed completed");
}

main()
  .catch((e) => {
    console.error("❌ tasks seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
