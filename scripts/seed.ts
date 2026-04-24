import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // === SUPERADMIN (Telegram login) ===
  // Migrate legacy email admin → Telegram-based admin
  const legacyAdmin = await prisma.user.findUnique({
    where: { email: "admin@delovoy-park.ru" },
  });

  if (legacyAdmin) {
    // Convert existing admin: add telegramId, keep all FK references intact
    const admin = await prisma.user.update({
      where: { id: legacyAdmin.id },
      data: {
        telegramId: "694696",
        name: "Elliott",
        role: "SUPERADMIN",
        email: null,         // remove email login
        passwordHash: null,  // remove password login
      },
    });
    console.log(`  ✓ Migrated legacy admin → telegramId=${admin.telegramId} (${admin.name})`);
  } else {
    // No legacy admin — create or update by telegramId
    const admin = await prisma.user.upsert({
      where: { telegramId: "694696" },
      update: { role: "SUPERADMIN" },
      create: {
        telegramId: "694696",
        name: "Elliott",
        role: "SUPERADMIN",
      },
    });
    console.log(`  ✓ Admin user: telegramId=${admin.telegramId} (${admin.name})`);
  }

  // === MODULES ===
  const modules = [
    { slug: "cafe", name: "Кафе", description: "Кафе бизнес-парка — меню, заказы, доставка в офис" },
    { slug: "ps-park", name: "Плей Парк", description: "Бронирование столов PlayStation, напитки и пицца" },
    { slug: "gazebos", name: "Барбекю Парк", description: "Бронирование беседок на территории парка" },
    { slug: "parking", name: "Парковка", description: "Информация о парковке, в будущем — управление шлагбаумом" },
    { slug: "rental", name: "Аренда офисов", description: "Каталог офисов, CRM арендаторов, управление договорами" },
  ];

  for (const mod of modules) {
    await prisma.module.upsert({
      where: { slug: mod.slug },
      update: { name: mod.name, description: mod.description },
      create: mod,
    });
  }
  console.log(`  ✓ Modules: ${modules.map((m) => m.slug).join(", ")}`);

  // === RESOURCES: Барбекю Парк (5 шт) ===
  const gazebos = [
    { moduleSlug: "gazebos", name: "Беседка №1", description: "Большая беседка на 12 человек", capacity: 12, pricePerHour: 1500, googleCalendarId: "eaefb36cdf5caba883230fa46c17ac4b22b637090e065803e5deeea46de1de18@group.calendar.google.com" },
    { moduleSlug: "gazebos", name: "Беседка №2", description: "Средняя беседка на 8 человек", capacity: 8, pricePerHour: 1000, googleCalendarId: "1bd7f0bbf9e8b25566be8f25208fdb9ef5b9e7d39a534798599f053a53a62de0@group.calendar.google.com" },
    { moduleSlug: "gazebos", name: "Беседка №3", description: "Малая беседка на 4 человека", capacity: 4, pricePerHour: 700, googleCalendarId: "c7e4b54bb43b456f2639026c7bb4474fd1b344680110f1c49ae0a036a24b308c@group.calendar.google.com" },
    { moduleSlug: "gazebos", name: "Беседка №4", description: "Средняя беседка на 6 человек", capacity: 6, pricePerHour: 900, googleCalendarId: "a8d72586159ad865d3b0953367c67576d86579859b9e3a7defb0b748f907e36b@group.calendar.google.com" },
    { moduleSlug: "gazebos", name: "Беседка №5", description: "Малая беседка на 4 человека", capacity: 4, pricePerHour: 700, googleCalendarId: "4ef725fad9adba09fb597ddd85bae2110f35df843c627b49b9041b2720e58d53@group.calendar.google.com" },
  ];

  for (const g of gazebos) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: g.moduleSlug, name: g.name },
    });
    if (existing) {
      await prisma.resource.update({ where: { id: existing.id }, data: { googleCalendarId: g.googleCalendarId } });
    } else {
      await prisma.resource.create({ data: g });
    }
  }
  console.log(`  ✓ Gazebo resources: ${gazebos.length}`);

  // === RESOURCES: PlayStation столы (4 шт) ===
  const psTables = [
    { moduleSlug: "ps-park", name: "Стол PlayStation 1", description: "PS5, 2 геймпада, монитор 55\"", capacity: 4, pricePerHour: 800, googleCalendarId: "400e4a4538a03f7d0c1a5833b451b89c540cb99254a6fb7340cbc9e47b38d132@group.calendar.google.com" },
    { moduleSlug: "ps-park", name: "Стол PlayStation 2", description: "PS5, 2 геймпада, монитор 55\"", capacity: 4, pricePerHour: 800, googleCalendarId: "c5044a44f9a8a6ee3f36a9bcb99ae873d0cc9f1117ef35dc175a403755d79f34@group.calendar.google.com" },
    { moduleSlug: "ps-park", name: "Стол PlayStation 3", description: "PS5, 4 геймпада, монитор 65\"", capacity: 6, pricePerHour: 1200, googleCalendarId: "062e0d92f42fb876f033fd7e651072d3fdd63f779012b8a054183693840e6d3e@group.calendar.google.com" },
    { moduleSlug: "ps-park", name: "Стол PlayStation 4", description: "PS5, 2 геймпада, монитор 55\"", capacity: 4, pricePerHour: 800, googleCalendarId: "372c10ef4d3cdc778abeffe95baaf4646b11cade1dc1b19af1d715f7b18b09d8@group.calendar.google.com" },
  ];

  for (const t of psTables) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: t.moduleSlug, name: t.name },
    });
    if (existing) {
      await prisma.resource.update({ where: { id: existing.id }, data: { googleCalendarId: t.googleCalendarId } });
    } else {
      await prisma.resource.create({ data: t });
    }
  }
  console.log(`  ✓ Плей Парк tables: ${psTables.length}`);

  // === MENU ITEMS: Кафе ===
  const menuItems = [
    { category: "Напитки", name: "Американо", price: 180 },
    { category: "Напитки", name: "Капучино", price: 250 },
    { category: "Напитки", name: "Латте", price: 280 },
    { category: "Напитки", name: "Чай чёрный", price: 120 },
    { category: "Пицца", name: "Маргарита", price: 550, description: "Томатный соус, моцарелла, базилик" },
    { category: "Пицца", name: "Пепперони", price: 650, description: "Томатный соус, моцарелла, пепперони" },
    { category: "Основное", name: "Бизнес-ланч", price: 450, description: "Суп + горячее + напиток" },
    { category: "Основное", name: "Цезарь с курицей", price: 420, description: "Салат Цезарь с куриной грудкой" },
  ];

  for (const [i, item] of menuItems.entries()) {
    const existing = await prisma.menuItem.findFirst({
      where: { name: item.name, moduleSlug: "cafe" },
    });
    if (!existing) {
      await prisma.menuItem.create({
        data: { ...item, moduleSlug: "cafe", sortOrder: i },
      });
    }
  }
  console.log(`  ✓ Menu items: ${menuItems.length}`);

  // === OFFICES ===
  const offices = [
    { number: "101", floor: 1, building: 1, area: 25, pricePerMonth: 35000 },
    { number: "102", floor: 1, building: 1, area: 40, pricePerMonth: 55000 },
    { number: "201", floor: 2, building: 1, area: 30, pricePerMonth: 42000 },
    { number: "202", floor: 2, building: 1, area: 50, pricePerMonth: 70000 },
    { number: "301", floor: 3, building: 1, area: 35, pricePerMonth: 48000 },
  ];

  for (const office of offices) {
    await prisma.office.upsert({
      where: { building_floor_number: { building: office.building, floor: office.floor, number: office.number } },
      update: { area: office.area, pricePerMonth: office.pricePerMonth },
      create: office,
    });
  }
  console.log(`  ✓ Offices: ${offices.length}`);

  // Register inventory module
  await prisma.module.upsert({
    where: { slug: "inventory" },
    update: { name: "Инвентарь", description: "Учёт товаров: напитки, еда, аксессуары" },
    create: { slug: "inventory", name: "Инвентарь", description: "Учёт товаров: напитки, еда, аксессуары" },
  });
  console.log("  ✓ Inventory module registered (items added via 'Приехал новый товар')");

  // === MANAGEMENT MODULE (Управленка) ===
  await prisma.module.upsert({
    where: { slug: "management" },
    update: { name: "Управленка", description: "Управленческий учёт расходов" },
    create: { slug: "management", name: "Управленка", description: "Управленческий учёт расходов" },
  });

  // Seed initial recurring expenses (known IT costs with amount=0)
  const admin = await prisma.user.findFirst({ where: { role: "SUPERADMIN" } });
  const adminId = admin?.id ?? "system";

  const initialRecurring = [
    {
      name: "Timeweb VPS",
      description: "Хостинг на Timeweb Cloud — ОБНОВИТЕ СУММУ!",
      category: "IT_INFRASTRUCTURE" as const,
      frequency: "MONTHLY" as const,
      amount: 0,
      startDate: new Date("2026-04-17"),
      nextBillingDate: new Date("2026-05-17"),
    },
    {
      name: "Домен delovoy-park.ru",
      description: "Регистрация домена — ОБНОВИТЕ СУММУ И ДАТУ!",
      category: "IT_INFRASTRUCTURE" as const,
      frequency: "YEARLY" as const,
      amount: 0,
      startDate: new Date("2026-04-17"),
      nextBillingDate: new Date("2027-04-17"),
    },
    {
      name: "GitHub",
      description: "GitHub Team/Pro — ОБНОВИТЕ СУММУ! Если Free, деактивируйте.",
      category: "IT_INFRASTRUCTURE" as const,
      frequency: "MONTHLY" as const,
      amount: 0,
      startDate: new Date("2026-04-17"),
      nextBillingDate: new Date("2026-05-17"),
    },
  ];

  for (const r of initialRecurring) {
    const existing = await prisma.recurringExpense.findFirst({
      where: { name: r.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.recurringExpense.create({
        data: { ...r, createdById: adminId },
      });
    }
  }
  console.log(`  ✓ Management module + ${initialRecurring.length} initial recurring expenses`);

  // === TASKS MODULE + CATEGORIES ===
  await prisma.module.upsert({
    where: { slug: "tasks" },
    update: {
      name: "Задачи",
      description: "Таск-трекер команды и жалобы от арендаторов",
    },
    create: {
      slug: "tasks",
      name: "Задачи",
      description: "Таск-трекер команды и жалобы от арендаторов",
    },
  });

  const taskCategories: Array<{
    slug: string;
    name: string;
    description: string;
    keywords: string[];
    sortOrder: number;
  }> = [
    {
      slug: "plumbing",
      name: "Сантехника",
      description: "Протечки, неисправности кранов, туалетов, сифонов",
      keywords: ["протеч", "кран", "вод", "труб", "унита", "смеси", "сифон", "засор"],
      sortOrder: 10,
    },
    {
      slug: "electric",
      name: "Электрика",
      description: "Нет света, розетки, автоматы, проводка",
      keywords: ["свет", "розетк", "электр", "провод", "автомат", "щиток", "лампа"],
      sortOrder: 20,
    },
    {
      slug: "internet",
      name: "Интернет / сеть",
      description: "Пропал интернет, Wi-Fi, доступ к сервисам",
      keywords: ["интернет", "wi-fi", "wifi", "сеть", "интер", "вайфай", "роутер", "провайдер"],
      sortOrder: 30,
    },
    {
      slug: "hvac",
      name: "Климат",
      description: "Отопление, кондиционер, вентиляция, температура",
      keywords: ["кондиц", "жарко", "холодно", "отоплен", "вентил", "климат", "теплов"],
      sortOrder: 40,
    },
    {
      slug: "cleaning",
      name: "Уборка",
      description: "Вопросы уборки, мусор, клининг",
      keywords: ["убор", "мусор", "клинин", "грязно", "чист"],
      sortOrder: 50,
    },
    {
      slug: "other",
      name: "Другое",
      description: "Всё, что не попало в другие категории",
      keywords: [],
      sortOrder: 100,
    },
  ];

  for (const cat of taskCategories) {
    await prisma.taskCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        keywords: cat.keywords,
        sortOrder: cat.sortOrder,
      },
      create: cat,
    });
  }
  console.log(`  ✓ Task categories: ${taskCategories.map((c) => c.slug).join(", ")}`);

  console.log("\n✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
