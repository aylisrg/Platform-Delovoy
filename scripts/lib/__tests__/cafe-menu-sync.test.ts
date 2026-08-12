import { describe, it, expect, beforeEach } from "vitest";
import { syncCafeMenu } from "../cafe-menu-sync";
import { CAFE_MENU } from "../cafe-menu";
import {
  createFakePrisma,
  asPrisma,
  type FakePrisma,
} from "../../seeds/__tests__/fake-prisma";

/** Строка меню в БД — все поля явные, как их отдаёт Prisma. */
function menuRow(overrides: Record<string, unknown> = {}) {
  return {
    moduleSlug: "cafe",
    category: "Напитки",
    name: "Американо",
    description: null,
    price: 180,
    isAvailable: true,
    autoDisabledByStock: false,
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  };
}

/** Демо-меню, которое лежало в проде до перехода на настенный прайс. */
async function seedLegacyMenu(fake: FakePrisma) {
  await fake.menuItem.create({ data: menuRow({ name: "Американо", price: 180 }) });
  await fake.menuItem.create({
    data: menuRow({ name: "Капучино", price: 250 }),
  });
  await fake.menuItem.create({ data: menuRow({ name: "Латте", price: 280 }) });
  await fake.menuItem.create({
    data: menuRow({ name: "Чай чёрный", price: 120 }),
  });
  await fake.menuItem.create({
    data: menuRow({ category: "Пицца", name: "Пепперони", price: 650 }),
  });
  await fake.menuItem.create({
    data: menuRow({ category: "Основное", name: "Бизнес-ланч", price: 450 }),
  });
}

const rowByName = (fake: FakePrisma, name: string) =>
  fake.menuItem.__store.rows.find((r) => r.name === name);

describe("syncCafeMenu", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("на пустой БД создаёт всё меню с прайса", async () => {
    const changes = await syncCafeMenu(asPrisma(fake));

    expect(fake.menuItem.__store.rows.length).toBe(CAFE_MENU.length);
    expect(changes.every((c) => c.action === "создана")).toBe(true);
    expect(rowByName(fake, "Эспрессо")?.price).toBe(130);
  });

  it("идемпотентен: второй прогон ничего не меняет", async () => {
    await syncCafeMenu(asPrisma(fake));
    const snapshot = JSON.stringify(
      fake.menuItem.__store.rows.map((r) => [r.name, r.category, r.price, r.sortOrder]),
    );

    const changes = await syncCafeMenu(asPrisma(fake));

    expect(fake.menuItem.__store.rows.length).toBe(CAFE_MENU.length);
    expect(changes.every((c) => c.action === "без изменений")).toBe(true);
    expect(
      JSON.stringify(
        fake.menuItem.__store.rows.map((r) => [r.name, r.category, r.price, r.sortOrder]),
      ),
    ).toBe(snapshot);
  });

  it("обновляет цену и категорию существующей позиции, не плодя дубль", async () => {
    await seedLegacyMenu(fake);

    await syncCafeMenu(asPrisma(fake));

    const cappuccino = fake.menuItem.__store.rows.filter((r) => r.name === "Капучино");
    expect(cappuccino).toHaveLength(1);
    expect(cappuccino[0].price).toBe(200); // было 250
    expect(cappuccino[0].category).toBe("Кофе"); // было «Напитки»
    expect(rowByName(fake, "Пепперони")?.price).toBe(590); // было 650
  });

  it("скрывает позиции, которых нет на прайсе, но не удаляет их", async () => {
    await seedLegacyMenu(fake);

    const changes = await syncCafeMenu(asPrisma(fake));

    for (const name of ["Американо", "Чай чёрный", "Бизнес-ланч"]) {
      const row = rowByName(fake, name);
      expect(row, `${name} должна остаться в каталоге`).toBeDefined();
      expect(row?.isAvailable, `${name} должна быть скрыта`).toBe(false);
      expect(row?.deletedAt, `${name} не должна быть удалена`).toBeNull();
    }
    expect(changes.filter((c) => c.action === "скрыта")).toHaveLength(3);
  });

  it("кофе получает наименьший sortOrder — раздел выходит первым", async () => {
    await seedLegacyMenu(fake);

    await syncCafeMenu(asPrisma(fake));

    const visible = fake.menuItem.__store.rows
      .filter((r) => r.isAvailable)
      .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number));
    expect(visible.slice(0, 3).map((r) => r.name)).toEqual([
      "Эспрессо",
      "Капучино",
      "Латте",
    ]);
  });

  it("возвращает на витрину позицию, скрытую вручную", async () => {
    await fake.menuItem.create({
      data: menuRow({ category: "Кофе", name: "Латте", price: 200, isAvailable: false }),
    });

    await syncCafeMenu(asPrisma(fake));

    expect(rowByName(fake, "Латте")?.isAvailable).toBe(true);
  });

  it("оставляет скрытой позицию, которую спрятал инвентарь по остаткам", async () => {
    await fake.menuItem.create({
      data: menuRow({
        category: "Кофе",
        name: "Латте",
        price: 200,
        isAvailable: false,
        autoDisabledByStock: true,
      }),
    });

    await syncCafeMenu(asPrisma(fake));

    const latte = rowByName(fake, "Латте");
    expect(latte?.isAvailable).toBe(false);
    expect(latte?.autoDisabledByStock).toBe(true);
  });

  it("восстанавливает soft-deleted позицию, вернувшуюся на прайс", async () => {
    await fake.menuItem.create({
      data: menuRow({
        category: "Кофе",
        name: "Латте",
        price: 200,
        deletedAt: new Date("2026-01-01"),
      }),
    });

    await syncCafeMenu(asPrisma(fake));

    expect(fake.menuItem.__store.rows.filter((r) => r.name === "Латте")).toHaveLength(1);
    expect(rowByName(fake, "Латте")?.deletedAt).toBeNull();
  });

  it("при дублях по имени обновляет живую строку и скрывает лишние", async () => {
    await fake.menuItem.create({
      data: menuRow({ id: "dead", category: "Кофе", name: "Латте", price: 280, deletedAt: new Date("2026-01-01") }),
    });
    await fake.menuItem.create({
      data: menuRow({ id: "live", category: "Кофе", name: "Латте", price: 280 }),
    });
    await fake.menuItem.create({
      data: menuRow({ id: "dupe", category: "Кофе", name: "Латте", price: 999 }),
    });

    const changes = await syncCafeMenu(asPrisma(fake));

    const live = fake.menuItem.__store.rows.find((r) => r.id === "live");
    expect(live?.price).toBe(200);
    expect(live?.isAvailable).toBe(true);
    expect(fake.menuItem.__store.rows.find((r) => r.id === "dupe")?.isAvailable).toBe(false);
    // Soft-deleted тёзка не считается дублем на витрине — он и так невидим.
    expect(changes.filter((c) => c.action === "скрыт дубль")).toHaveLength(1);
  });

  it("dry-run ничего не пишет, но перечисляет те же изменения", async () => {
    await seedLegacyMenu(fake);
    const before = JSON.stringify(fake.menuItem.__store.rows);

    const changes = await syncCafeMenu(asPrisma(fake), { dryRun: true });

    expect(JSON.stringify(fake.menuItem.__store.rows)).toBe(before);
    expect(changes.filter((c) => c.action === "создана").length).toBeGreaterThan(0);
    expect(changes.filter((c) => c.action === "скрыта")).toHaveLength(3);
  });
});
