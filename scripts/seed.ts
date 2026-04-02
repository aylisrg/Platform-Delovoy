import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // === SUPERADMIN ===
  const admin = await prisma.user.upsert({
    where: { email: "admin@delovoy-park.ru" },
    update: {},
    create: {
      email: "admin@delovoy-park.ru",
      name: "Администратор",
      role: "SUPERADMIN",
    },
  });
  console.log(`  ✓ Admin user: ${admin.email}`);

  // === MODULES ===
  const modules = [
    { slug: "cafe", name: "Кафе", description: "Кафе бизнес-парка — меню, заказы, доставка в офис" },
    { slug: "ps-park", name: "PlayStation Park", description: "Бронирование столов PlayStation, напитки и пицца" },
    { slug: "gazebos", name: "Беседки", description: "Бронирование беседок на территории парка" },
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

  // === RESOURCES: Беседки ===
  const gazebos = [
    { moduleSlug: "gazebos", name: "Беседка №1", description: "Большая беседка на 12 человек", capacity: 12, pricePerHour: 1500 },
    { moduleSlug: "gazebos", name: "Беседка №2", description: "Средняя беседка на 8 человек", capacity: 8, pricePerHour: 1000 },
    { moduleSlug: "gazebos", name: "Беседка №3", description: "Малая беседка на 4 человека", capacity: 4, pricePerHour: 700 },
  ];

  for (const g of gazebos) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: g.moduleSlug, name: g.name },
    });
    if (!existing) {
      await prisma.resource.create({ data: g });
    }
  }
  console.log(`  ✓ Gazebo resources: ${gazebos.length}`);

  // === RESOURCES: PlayStation столы ===
  const psTables = [
    { moduleSlug: "ps-park", name: "Стол PlayStation 1", description: "PS5, 2 геймпада, монитор 55\"", capacity: 4, pricePerHour: 800 },
    { moduleSlug: "ps-park", name: "Стол PlayStation 2", description: "PS5, 2 геймпада, монитор 55\"", capacity: 4, pricePerHour: 800 },
    { moduleSlug: "ps-park", name: "Стол PlayStation 3", description: "PS5, 4 геймпада, монитор 65\"", capacity: 6, pricePerHour: 1200 },
  ];

  for (const t of psTables) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: t.moduleSlug, name: t.name },
    });
    if (!existing) {
      await prisma.resource.create({ data: t });
    }
  }
  console.log(`  ✓ PS Park tables: ${psTables.length}`);

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
    { number: "101", floor: 1, area: 25, pricePerMonth: 35000 },
    { number: "102", floor: 1, area: 40, pricePerMonth: 55000 },
    { number: "201", floor: 2, area: 30, pricePerMonth: 42000 },
    { number: "202", floor: 2, area: 50, pricePerMonth: 70000 },
    { number: "301", floor: 3, area: 35, pricePerMonth: 48000 },
  ];

  for (const office of offices) {
    await prisma.office.upsert({
      where: { number: office.number },
      update: { floor: office.floor, area: office.area, pricePerMonth: office.pricePerMonth },
      create: office,
    });
  }
  console.log(`  ✓ Offices: ${offices.length}`);

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
