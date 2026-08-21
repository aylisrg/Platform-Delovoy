import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedLegalDocuments } from "../legal";
import { hashDocumentBody } from "../../../src/modules/booking/offer";
import { createFakePrisma, asPrisma, type FakePrisma } from "./fake-prisma";

describe("seedLegalDocuments", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("на пустой БД публикует обе редакции", async () => {
    await seedLegalDocuments(asPrisma(fake));

    const rows = fake.offerVersion.__store.rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.documentKey).sort()).toEqual(["gazebos-offer", "privacy-policy"]);
    for (const row of rows) {
      expect(row.slug).toBe("v1");
      expect(row.number).toBe(1);
      expect(row.isCurrent).toBe(true);
      expect(String(row.body).length).toBeGreaterThan(1000);
    }
  });

  it("кладёт в БД текст файла и его хеш", async () => {
    await seedLegalDocuments(asPrisma(fake));

    const offer = fake.offerVersion.__store.rows.find((r) => r.documentKey === "gazebos-offer")!;
    const file = readFileSync(join(process.cwd(), "content/legal/gazebos-offer/v1.md"), "utf-8");
    expect(offer.body).toBe(file);
    expect(offer.contentHash).toBe(hashDocumentBody(file));
  });

  it("идемпотентен: повторный прогон не плодит редакции и не меняет текст", async () => {
    await seedLegalDocuments(asPrisma(fake));
    const before = fake.offerVersion.__store.rows.map((r) => ({ ...r }));

    await seedLegalDocuments(asPrisma(fake));

    const after = fake.offerVersion.__store.rows;
    expect(after).toHaveLength(2);
    expect(after.map((r) => r.body)).toEqual(before.map((r) => r.body));
    expect(after.map((r) => r.contentHash)).toEqual(before.map((r) => r.contentHash));
  });

  it("падает, если текст опубликованной редакции разошёлся с файлом", async () => {
    await seedLegalDocuments(asPrisma(fake));

    // Имитируем правку файла «на месте»: в БД остался старый хеш.
    const row = fake.offerVersion.__store.rows.find((r) => r.documentKey === "gazebos-offer")!;
    row.contentHash = "deadbeef";

    await expect(seedLegalDocuments(asPrisma(fake))).rejects.toThrow(
      /Опубликованная редакция неизменяема/
    );
  });

  it("держит ровно одну действующую редакцию на документ", async () => {
    await seedLegalDocuments(asPrisma(fake));

    // Кто-то переключил флаг руками — сидер возвращает состояние из кода.
    fake.offerVersion.__store.rows.forEach((r) => {
      r.isCurrent = false;
    });
    await seedLegalDocuments(asPrisma(fake));

    for (const key of ["gazebos-offer", "privacy-policy"]) {
      const current = fake.offerVersion.__store.rows.filter(
        (r) => r.documentKey === key && r.isCurrent
      );
      expect(current).toHaveLength(1);
    }
  });
});
