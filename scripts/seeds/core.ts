/**
 * Core seed — справочные данные платформы:
 *   - SUPERADMIN (Telegram-based)
 *   - Module rows (cafe, ps-park, gazebos, parking, rental, inventory, management)
 *   - Resources: gazebos (5), PS tables (4)
 *   - MenuItem (cafe demo menu)
 *   - Office (5 demo offices)
 *   - RecurringExpense (3 IT-инфраструктура заглушек с amount=0)
 *
 * Идемпотентность: все upsert по уникальным ключам из ADR-0001 §"Идемпотентность".
 *   - update-блоки НЕ перезаписывают `isActive`, `createdAt`, `config`.
 *   - Никаких `prisma.$connect/$disconnect`, никаких `process.exit`.
 *
 * НЕ содержит PII.
 */
import type { PrismaClient } from "@prisma/client";

export async function seedCore(prisma: PrismaClient): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] 🌱 seedCore: started`);

  // === SYSTEM user (anchor for FK references in AuditLog from anonymous flows) ===
  // Required by /api/tasks/report (AC-013) and other public endpoints that need
  // to write AuditLog rows without an authenticated session. AuditLog.userId
  // has a non-nullable FK to User, so a real row with id="system" must exist.
  // Idempotent upsert by primary key; role left as USER, name "System".
  await prisma.user.upsert({
    where: { id: "system" },
    create: {
      id: "system",
      name: "System",
      role: "USER",
    },
    update: {},
  });

  // === SUPERADMIN (Telegram login) ===
  const superadminTelegramId =
    process.env.SUPERADMIN_TELEGRAM_ID ?? "694696";
  const superadminName = process.env.SUPERADMIN_NAME ?? "Elliott";

  // Migrate legacy email admin → Telegram-based admin (one-time migration safe to re-run).
  const legacyAdmin = await prisma.user.findUnique({
    where: { email: "admin@delovoy-park.ru" },
  });

  if (legacyAdmin) {
    const admin = await prisma.user.update({
      where: { id: legacyAdmin.id },
      data: {
        telegramId: superadminTelegramId,
        name: superadminName,
        role: "SUPERADMIN",
        email: null,
        passwordHash: null,
      },
    });
    console.log(
      `  ✓ Migrated legacy admin → telegramId=${admin.telegramId} (${admin.name})`,
    );
  } else {
    const admin = await prisma.user.upsert({
      where: { telegramId: superadminTelegramId },
      // role-only update: name мог быть изменён вручную, не перетираем.
      update: { role: "SUPERADMIN" },
      create: {
        telegramId: superadminTelegramId,
        name: superadminName,
        role: "SUPERADMIN",
      },
    });
    console.log(
      `  ✓ Admin user: telegramId=${admin.telegramId} (${admin.name})`,
    );
  }

  // === MODULES ===
  const modules: Array<{
    slug: string;
    name: string;
    description: string;
  }> = [
    {
      slug: "cafe",
      name: "Кафе",
      description: "Кафе бизнес-парка — меню, заказы, доставка в офис",
    },
    {
      slug: "ps-park",
      name: "Плей Парк",
      description: "Бронирование столов PlayStation, напитки и пицца",
    },
    {
      slug: "gazebos",
      name: "Барбекю Парк",
      description: "Бронирование беседок на территории парка",
    },
    {
      slug: "parking",
      name: "Парковка",
      description:
        "Информация о парковке, в будущем — управление шлагбаумом",
    },
    {
      slug: "rental",
      name: "Аренда офисов",
      description:
        "Каталог офисов, CRM арендаторов, управление договорами",
    },
    {
      slug: "inventory",
      name: "Инвентарь",
      description: "Учёт товаров: напитки, еда, аксессуары",
    },
    {
      slug: "management",
      name: "Управленка",
      description: "Управленческий учёт расходов",
    },
  ];

  for (const mod of modules) {
    await prisma.module.upsert({
      where: { slug: mod.slug },
      // ВАЖНО: НЕ перезаписываем isActive/createdAt/config — менеджер мог
      // выключить модуль через UI или подкрутить config; seed их обратно
      // включит/затрёт. Обновляем только описательные поля.
      update: { name: mod.name, description: mod.description },
      create: mod,
    });
  }
  console.log(`  ✓ Modules: ${modules.length} (${modules.map((m) => m.slug).join(", ")})`);

  // === RESOURCES: Барбекю Парк (5 шт) ===
  // У Resource нет составного unique → matchBy (moduleSlug, name).
  // Обновляем ТОЛЬКО googleCalendarId (бизнес-привязка к календарю), всё
  // остальное (capacity, price, description, isActive) могло быть отредактировано.
  const gazebos = [
    {
      moduleSlug: "gazebos",
      name: "Беседка №1",
      description: "Большая беседка на 12 человек",
      capacity: 12,
      pricePerHour: 1500,
      googleCalendarId:
        "eaefb36cdf5caba883230fa46c17ac4b22b637090e065803e5deeea46de1de18@group.calendar.google.com",
    },
    {
      moduleSlug: "gazebos",
      name: "Беседка №2",
      description: "Средняя беседка на 8 человек",
      capacity: 8,
      pricePerHour: 1000,
      googleCalendarId:
        "1bd7f0bbf9e8b25566be8f25208fdb9ef5b9e7d39a534798599f053a53a62de0@group.calendar.google.com",
    },
    {
      moduleSlug: "gazebos",
      name: "Беседка №3",
      description: "Малая беседка на 4 человека",
      capacity: 4,
      pricePerHour: 700,
      googleCalendarId:
        "c7e4b54bb43b456f2639026c7bb4474fd1b344680110f1c49ae0a036a24b308c@group.calendar.google.com",
    },
    {
      moduleSlug: "gazebos",
      name: "Беседка №4",
      description: "Средняя беседка на 6 человек",
      capacity: 6,
      pricePerHour: 900,
      googleCalendarId:
        "a8d72586159ad865d3b0953367c67576d86579859b9e3a7defb0b748f907e36b@group.calendar.google.com",
    },
    {
      moduleSlug: "gazebos",
      name: "Беседка №5",
      description: "Малая беседка на 4 человека",
      capacity: 4,
      pricePerHour: 700,
      googleCalendarId:
        "4ef725fad9adba09fb597ddd85bae2110f35df843c627b49b9041b2720e58d53@group.calendar.google.com",
    },
  ];

  for (const g of gazebos) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: g.moduleSlug, name: g.name },
    });
    if (existing) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: { googleCalendarId: g.googleCalendarId },
      });
    } else {
      await prisma.resource.create({ data: g });
    }
  }
  console.log(`  ✓ Gazebo resources: ${gazebos.length}`);

  // === RESOURCES: PlayStation столы (4 шт) ===
  const psTables = [
    {
      moduleSlug: "ps-park",
      name: "Стол PlayStation 1",
      description: 'PS5, 2 геймпада, монитор 55"',
      capacity: 4,
      pricePerHour: 800,
      googleCalendarId:
        "400e4a4538a03f7d0c1a5833b451b89c540cb99254a6fb7340cbc9e47b38d132@group.calendar.google.com",
    },
    {
      moduleSlug: "ps-park",
      name: "Стол PlayStation 2",
      description: 'PS5, 2 геймпада, монитор 55"',
      capacity: 4,
      pricePerHour: 800,
      googleCalendarId:
        "c5044a44f9a8a6ee3f36a9bcb99ae873d0cc9f1117ef35dc175a403755d79f34@group.calendar.google.com",
    },
    {
      moduleSlug: "ps-park",
      name: "Стол PlayStation 3",
      description: 'PS5, 4 геймпада, монитор 65"',
      capacity: 6,
      pricePerHour: 1200,
      googleCalendarId:
        "062e0d92f42fb876f033fd7e651072d3fdd63f779012b8a054183693840e6d3e@group.calendar.google.com",
    },
    {
      moduleSlug: "ps-park",
      name: "Стол PlayStation 4",
      description: 'PS5, 2 геймпада, монитор 55"',
      capacity: 4,
      pricePerHour: 800,
      googleCalendarId:
        "372c10ef4d3cdc778abeffe95baaf4646b11cade1dc1b19af1d715f7b18b09d8@group.calendar.google.com",
    },
  ];

  for (const t of psTables) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: t.moduleSlug, name: t.name },
    });
    if (existing) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: { googleCalendarId: t.googleCalendarId },
      });
    } else {
      await prisma.resource.create({ data: t });
    }
  }
  console.log(`  ✓ Плей Парк tables: ${psTables.length}`);

  // === MENU ITEMS: Кафе ===
  // У MenuItem нет уникального ограничения. Создаём только если name+moduleSlug
  // ещё не существует. Существующие записи НЕ обновляем — менеджер кафе мог
  // подкрутить цены и описания через UI.
  const menuItems = [
    { category: "Напитки", name: "Американо", price: 180 },
    { category: "Напитки", name: "Капучино", price: 250 },
    { category: "Напитки", name: "Латте", price: 280 },
    { category: "Напитки", name: "Чай чёрный", price: 120 },
    {
      category: "Пицца",
      name: "Маргарита",
      price: 550,
      description: "Томатный соус, моцарелла, базилик",
    },
    {
      category: "Пицца",
      name: "Пепперони",
      price: 650,
      description: "Томатный соус, моцарелла, пепперони",
    },
    {
      category: "Основное",
      name: "Бизнес-ланч",
      price: 450,
      description: "Суп + горячее + напиток",
    },
    {
      category: "Основное",
      name: "Цезарь с курицей",
      price: 420,
      description: "Салат Цезарь с куриной грудкой",
    },
  ];

  let menuCreated = 0;
  for (const [i, item] of menuItems.entries()) {
    const existing = await prisma.menuItem.findFirst({
      where: { name: item.name, moduleSlug: "cafe" },
    });
    if (!existing) {
      await prisma.menuItem.create({
        data: { ...item, moduleSlug: "cafe", sortOrder: i },
      });
      menuCreated += 1;
    }
  }
  console.log(`  ✓ Menu items: ${menuItems.length} total, ${menuCreated} new`);

  // === OFFICES (демо) ===
  // Office имеет составной unique (building, floor, number). Цена/площадь
  // могут быть скорректированы менеджером — не перезаписываем.
  const offices = [
    { number: "101", floor: 1, building: 1, area: 25, pricePerMonth: 35000 },
    { number: "102", floor: 1, building: 1, area: 40, pricePerMonth: 55000 },
    { number: "201", floor: 2, building: 1, area: 30, pricePerMonth: 42000 },
    { number: "202", floor: 2, building: 1, area: 50, pricePerMonth: 70000 },
    { number: "301", floor: 3, building: 1, area: 35, pricePerMonth: 48000 },
  ];

  for (const office of offices) {
    await prisma.office.upsert({
      where: {
        building_floor_number: {
          building: office.building,
          floor: office.floor,
          number: office.number,
        },
      },
      // Не перезаписываем area/pricePerMonth/status — это бизнес-данные.
      update: {},
      create: office,
    });
  }
  console.log(`  ✓ Offices: ${offices.length}`);

  // === RECURRING EXPENSES (заглушки для IT-инфраструктуры) ===
  // Создаются только если ещё нет — суммы менеджер обновляет вручную.
  const admin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
  });
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
      description:
        "GitHub Team/Pro — ОБНОВИТЕ СУММУ! Если Free, деактивируйте.",
      category: "IT_INFRASTRUCTURE" as const,
      frequency: "MONTHLY" as const,
      amount: 0,
      startDate: new Date("2026-04-17"),
      nextBillingDate: new Date("2026-05-17"),
    },
  ];

  let recurringCreated = 0;
  for (const r of initialRecurring) {
    const existing = await prisma.recurringExpense.findFirst({
      where: { name: r.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.recurringExpense.create({
        data: { ...r, createdById: adminId },
      });
      recurringCreated += 1;
    }
  }
  console.log(
    `  ✓ Recurring expenses: ${initialRecurring.length} total, ${recurringCreated} new`,
  );

  console.log(`[${new Date().toISOString()}] ✅ seedCore: done`);
}
