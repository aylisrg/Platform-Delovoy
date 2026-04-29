import { describe, it, expect, beforeEach } from "vitest";
import { seedCore } from "../core";
import { createFakePrisma, asPrisma, type FakePrisma } from "./fake-prisma";

describe("seedCore", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("empty DB: creates expected reference rows", async () => {
    await seedCore(asPrisma(fake));

    // 1 system user (id="system") + 1 superadmin = 2
    expect(fake.user.__store.rows.length).toBe(2);
    const system = fake.user.__store.rows.find((r) => r.id === "system");
    expect(system?.role).toBe("USER");
    expect(system?.name).toBe("System");
    const superadmin = fake.user.__store.rows.find((r) => r.role === "SUPERADMIN");
    expect(superadmin).toBeDefined();

    // 7 modules: cafe, ps-park, gazebos, parking, rental, inventory, management
    expect(fake.module.__store.rows.length).toBe(7);
    const slugs = fake.module.__store.rows.map((r) => r.slug).sort();
    expect(slugs).toEqual([
      "cafe",
      "gazebos",
      "inventory",
      "management",
      "parking",
      "ps-park",
      "rental",
    ]);

    // 5 gazebos + 4 ps-park tables = 9 resources
    expect(fake.resource.__store.rows.length).toBe(9);

    // 8 menu items
    expect(fake.menuItem.__store.rows.length).toBe(8);

    // 5 demo offices
    expect(fake.office.__store.rows.length).toBe(5);

    // 3 recurring expenses
    expect(fake.recurringExpense.__store.rows.length).toBe(3);
  });

  it("idempotency: double invocation produces same row counts", async () => {
    await seedCore(asPrisma(fake));
    const after1 = {
      users: fake.user.__store.rows.length,
      modules: fake.module.__store.rows.length,
      resources: fake.resource.__store.rows.length,
      menu: fake.menuItem.__store.rows.length,
      offices: fake.office.__store.rows.length,
      recurring: fake.recurringExpense.__store.rows.length,
    };

    await seedCore(asPrisma(fake));
    const after2 = {
      users: fake.user.__store.rows.length,
      modules: fake.module.__store.rows.length,
      resources: fake.resource.__store.rows.length,
      menu: fake.menuItem.__store.rows.length,
      offices: fake.office.__store.rows.length,
      recurring: fake.recurringExpense.__store.rows.length,
    };

    expect(after2).toEqual(after1);
  });

  it("partial state: does NOT overwrite Module.isActive, Office.pricePerMonth, MenuItem.price", async () => {
    // Pre-seed state: a manager has manually disabled `cafe` module via UI,
    // edited an office price, and edited a menu item price.
    await fake.module.create({
      data: {
        slug: "cafe",
        name: "Old Cafe Name",
        description: "Old desc",
        isActive: false, // manager disabled
      },
    });
    await fake.office.create({
      data: {
        number: "101",
        floor: 1,
        building: 1,
        area: 25,
        pricePerMonth: 99999, // edited price
      },
    });
    await fake.menuItem.create({
      data: {
        moduleSlug: "cafe",
        category: "Напитки",
        name: "Американо",
        price: 9999, // edited price
        sortOrder: 0,
      },
    });

    await seedCore(asPrisma(fake));

    // Module: name/description обновились (это описательные поля),
    // но isActive остался false.
    const cafeModule = fake.module.__store.rows.find((r) => r.slug === "cafe");
    expect(cafeModule?.isActive).toBe(false);
    expect(cafeModule?.name).toBe("Кафе");

    // Office: цена сохранилась.
    const office101 = fake.office.__store.rows.find(
      (r) => r.number === "101" && r.floor === 1 && r.building === 1,
    );
    expect(office101?.pricePerMonth).toBe(99999);

    // MenuItem: цена сохранилась — найденный existing просто пропускается.
    const americano = fake.menuItem.__store.rows.find(
      (r) => r.name === "Американо",
    );
    expect(americano?.price).toBe(9999);
  });

  it("legacy admin migration: converts email-admin to telegram-admin", async () => {
    // Legacy: pre-existing admin with email and no telegramId
    await fake.user.create({
      data: {
        email: "admin@delovoy-park.ru",
        passwordHash: "old-hash",
        role: "SUPERADMIN",
        name: "Legacy",
      },
    });

    await seedCore(asPrisma(fake));

    // legacy admin (migrated) + system user = 2
    expect(fake.user.__store.rows.length).toBe(2);
    const admin = fake.user.__store.rows.find((r) => r.role === "SUPERADMIN");
    expect(admin?.email).toBeNull();
    expect(admin?.passwordHash).toBeNull();
    expect(admin?.telegramId).toBe("694696");
    expect(admin?.role).toBe("SUPERADMIN");
  });

  it("respects SUPERADMIN_TELEGRAM_ID env override", async () => {
    const original = process.env.SUPERADMIN_TELEGRAM_ID;
    process.env.SUPERADMIN_TELEGRAM_ID = "111222333";
    try {
      await seedCore(asPrisma(fake));
      const admin = fake.user.__store.rows.find((r) => r.role === "SUPERADMIN");
      expect(admin?.telegramId).toBe("111222333");
    } finally {
      if (original === undefined) delete process.env.SUPERADMIN_TELEGRAM_ID;
      else process.env.SUPERADMIN_TELEGRAM_ID = original;
    }
  });
});
