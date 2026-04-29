/**
 * Tasks seed — справочные данные модуля задач:
 *   - Module(tasks)
 *   - TaskBoard(general) — дефолтная доска
 *   - TaskColumn[6] — 6 системных колонок
 *   - TaskCategory[9] — 9 категорий с keyword-маршрутизацией
 *
 * Идемпотентность: ADR-0001 §"Идемпотентность".
 *   - Module/TaskBoard/TaskCategory: upsert по slug.
 *   - TaskColumn: matchBy (boardId, sortOrder).
 *
 * Принципы update-блоков:
 *   - Module(tasks): не перезаписываем isActive/createdAt/config.
 *   - TaskBoard(general): обновляем только description (флаг isDefault — всегда true).
 *   - TaskColumn: если уже существует — НЕ перезаписываем (есть PATCH endpoint
 *     /api/tasks/boards/:id/columns/:columnId, менеджер мог переименовать колонку).
 *   - TaskCategory: обновляем ТОЛЬКО color и keywords. `name` не перезаписываем,
 *     потому что есть PATCH /api/tasks/categories/:id — менеджер мог переименовать.
 *
 * НЕ содержит PII.
 */
import type { PrismaClient } from "@prisma/client";

type CategoryDefinition = {
  slug: string;
  name: string;
  color: string;
  keywords: string[];
  sortOrder: number;
  priorityHint?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

type ColumnDefinition = {
  name: string;
  color: string;
  sortOrder: number;
  isTerminal: boolean;
  wipLimit: number | null;
};

export async function seedTasks(prisma: PrismaClient): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] 🌱 seedTasks: started`);

  // === Module(tasks) ===
  // Не перезаписываем isActive/config — менеджер мог отключить модуль.
  await prisma.module.upsert({
    where: { slug: "tasks" },
    create: {
      slug: "tasks",
      name: "Задачи",
      description: "Единый канбан задач и обращений",
      isActive: true,
    },
    update: {
      name: "Задачи",
      description: "Единый канбан задач и обращений",
    },
  });
  console.log("  ✓ Module 'tasks' registered");

  // === TaskBoard(general) ===
  const generalBoard = await prisma.taskBoard.upsert({
    where: { slug: "general" },
    create: {
      slug: "general",
      name: "Задачи Делового",
      description: "Общая доска задач и обращений арендаторов",
      isDefault: true,
      sortOrder: 0,
    },
    // isDefault поддерживаем true — это контракт системы (всегда есть default board).
    // name НЕ перезаписываем — у TaskBoard нет API для переименования сейчас, но
    // на всякий случай оставляем менеджеру свободу через прямое БД-редактирование.
    update: { isDefault: true },
  });
  console.log(`  ✓ Board 'general' (${generalBoard.id})`);

  // === TaskColumn[6] ===
  // matchBy (boardId, sortOrder) через @@unique([boardId, sortOrder]).
  // Если колонка уже существует — НЕ перезаписываем, потому что у TaskColumn
  // есть PATCH endpoint, и менеджер мог переименовать/перекрасить.
  const columns: ColumnDefinition[] = [
    { name: "Входящие", color: "#6B7280", sortOrder: 0, isTerminal: false, wipLimit: null },
    { name: "Триаж", color: "#F59E0B", sortOrder: 1, isTerminal: false, wipLimit: null },
    { name: "В работе", color: "#3B82F6", sortOrder: 2, isTerminal: false, wipLimit: 10 },
    { name: "Ждём ответа", color: "#A855F7", sortOrder: 3, isTerminal: false, wipLimit: null },
    { name: "Готово", color: "#10B981", sortOrder: 4, isTerminal: true, wipLimit: null },
    { name: "Архив", color: "#4B5563", sortOrder: 5, isTerminal: true, wipLimit: null },
  ];

  let columnsCreated = 0;
  for (const c of columns) {
    const existing = await prisma.taskColumn.findFirst({
      where: { boardId: generalBoard.id, sortOrder: c.sortOrder },
    });
    if (!existing) {
      await prisma.taskColumn.create({
        data: { ...c, boardId: generalBoard.id },
      });
      columnsCreated += 1;
    }
    // existing → не трогаем (см. комментарий выше).
  }
  console.log(
    `  ✓ Columns: ${columns.length} total, ${columnsCreated} new`,
  );

  // === TaskCategory[9] ===
  // upsert по slug. update обновляет ТОЛЬКО color и keywords:
  //   - keywords меняются с релизами routing-логики;
  //   - color — визуальная согласованность брендбука;
  //   - name НЕ перезаписывается (менеджер может переименовать через PATCH endpoint).
  const categories: CategoryDefinition[] = [
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
      // НЕ перезаписываем name — менеджер может переименовать через PATCH endpoint.
      update: { color: c.color, keywords: c.keywords },
    });
  }
  console.log(`  ✓ Categories: ${categories.length}`);

  console.log(`[${new Date().toISOString()}] ✅ seedTasks: done`);
}
