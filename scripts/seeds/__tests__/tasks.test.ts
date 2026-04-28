import { describe, it, expect, beforeEach } from "vitest";
import { seedTasks } from "../tasks";
import { createFakePrisma, asPrisma, type FakePrisma } from "./fake-prisma";

describe("seedTasks", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("empty DB: creates 1 module + 1 board + 6 columns + 9 categories", async () => {
    await seedTasks(asPrisma(fake));

    expect(fake.module.__store.rows.length).toBe(1);
    expect(fake.module.__store.rows[0]?.slug).toBe("tasks");

    expect(fake.taskBoard.__store.rows.length).toBe(1);
    expect(fake.taskBoard.__store.rows[0]?.slug).toBe("general");
    expect(fake.taskBoard.__store.rows[0]?.isDefault).toBe(true);

    expect(fake.taskColumn.__store.rows.length).toBe(6);
    const sortOrders = fake.taskColumn.__store.rows
      .map((r) => r.sortOrder)
      .sort((a, b) => Number(a) - Number(b));
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5]);

    expect(fake.taskCategory.__store.rows.length).toBe(9);
    const catSlugs = fake.taskCategory.__store.rows.map((r) => r.slug).sort();
    expect(catSlugs).toEqual([
      "cafe",
      "cleaning",
      "gazebos",
      "it",
      "parking",
      "ps-park",
      "rental",
      "security",
      "uncategorized",
    ]);
  });

  it("idempotency: double invocation produces same row counts", async () => {
    await seedTasks(asPrisma(fake));
    const after1 = {
      modules: fake.module.__store.rows.length,
      boards: fake.taskBoard.__store.rows.length,
      columns: fake.taskColumn.__store.rows.length,
      categories: fake.taskCategory.__store.rows.length,
    };

    await seedTasks(asPrisma(fake));
    const after2 = {
      modules: fake.module.__store.rows.length,
      boards: fake.taskBoard.__store.rows.length,
      columns: fake.taskColumn.__store.rows.length,
      categories: fake.taskCategory.__store.rows.length,
    };

    expect(after2).toEqual(after1);
  });

  it("partial state: pre-existing custom column name is NOT overwritten", async () => {
    // Manager renamed column at sortOrder=0 from "Входящие" to "Inbox".
    // Create board first so we have boardId.
    const board = await fake.taskBoard.create({
      data: {
        slug: "general",
        name: "Задачи Делового",
        description: "...",
        isDefault: true,
        sortOrder: 0,
      },
    });
    await fake.taskColumn.create({
      data: {
        boardId: board.id,
        name: "Inbox", // custom rename
        color: "#000000", // custom color
        sortOrder: 0,
        isTerminal: false,
        wipLimit: null,
      },
    });

    await seedTasks(asPrisma(fake));

    const col0 = fake.taskColumn.__store.rows.find((r) => r.sortOrder === 0);
    // Existing column was NOT overwritten (UI may have renamed it).
    expect(col0?.name).toBe("Inbox");
    expect(col0?.color).toBe("#000000");

    // The other 5 missing columns were created.
    expect(fake.taskColumn.__store.rows.length).toBe(6);
  });

  it("partial state: TaskCategory.name is NOT overwritten (UI rename allowed)", async () => {
    // Manager renamed category 'rental' via PATCH endpoint.
    await fake.taskCategory.create({
      data: {
        slug: "rental",
        name: "Custom Renamed",
        color: "#FF0000",
        keywords: ["custom"],
        sortOrder: 1,
      },
    });

    await seedTasks(asPrisma(fake));

    const rental = fake.taskCategory.__store.rows.find(
      (r) => r.slug === "rental",
    );
    // name preserved (UI rename intent honoured)
    expect(rental?.name).toBe("Custom Renamed");
    // color and keywords ARE updated by seed (they're routing/branding)
    expect(rental?.color).toBe("#0EA5E9");
    expect(rental?.keywords).toEqual([
      "аренда",
      "офис",
      "договор",
      "оплата",
    ]);
  });

  it("partial state: Module(tasks).isActive is NOT re-enabled if manager disabled it", async () => {
    await fake.module.create({
      data: {
        slug: "tasks",
        name: "Old Name",
        description: "Old",
        isActive: false, // manager disabled
      },
    });

    await seedTasks(asPrisma(fake));

    const tasksMod = fake.module.__store.rows.find((r) => r.slug === "tasks");
    expect(tasksMod?.isActive).toBe(false);
    // descriptive fields refreshed
    expect(tasksMod?.name).toBe("Задачи");
  });

  it("no duplicate columns by (boardId, sortOrder) unique-key", async () => {
    await seedTasks(asPrisma(fake));
    await seedTasks(asPrisma(fake));
    await seedTasks(asPrisma(fake));

    expect(fake.taskColumn.__store.rows.length).toBe(6);
  });
});
