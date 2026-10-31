import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedLegalDocuments } from "../legal";
import { hashDocumentBody } from "../../../src/modules/booking/offer";
import { PUBLIC_CONTACTS } from "../../../src/lib/public-contacts";
import { createFakePrisma, asPrisma, type FakePrisma } from "./fake-prisma";

describe("seedLegalDocuments", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("сохраняет архивные редакции, актуальные контакты и оферту Плей Парка", async () => {
    await seedLegalDocuments(asPrisma(fake));

    const rows = fake.offerVersion.__store.rows;
    expect(rows).toHaveLength(6);
    expect([...new Set(rows.map((r) => r.documentKey))].sort()).toEqual(["gazebos-offer", "privacy-policy", "ps-park-offer"]);
    for (const row of rows) {
      expect(row.slug).toBe(`v${row.number}`);
      expect(row.isCurrent).toBe(row.number === 2);
      expect(String(row.body).length).toBeGreaterThan(1000);
      if (row.isCurrent) {
        const contact = row.documentKey === "gazebos-offer" ? "gazebos" : row.documentKey === "ps-park-offer" ? "ps-park" : "rental";
        const phone = PUBLIC_CONTACTS[contact].displayPhone;
        expect(row.body).toContain(phone);
        expect(row.body).not.toContain("+7 (499) 677-48-88");
      }
    }
  });

  it("кладёт в БД текст файла и его хеш", async () => {
    await seedLegalDocuments(asPrisma(fake));

    const offer = fake.offerVersion.__store.rows.find((r) => r.documentKey === "gazebos-offer")!;
    const file = readFileSync(join(process.cwd(), "content/legal/gazebos-offer/v1.md"), "utf-8");
    expect(offer.body).toBe(file);
    expect(offer.contentHash).toBe(hashDocumentBody(file));
  });

  it("при обновлении не переписывает принятые v1 и сохраняет действующие v2 других документов", async () => {
    await seedLegalDocuments(asPrisma(fake));
    const rows = fake.offerVersion.__store.rows;
    const previousPlayPark = rows.find((row) => row.documentKey === "ps-park-offer" && row.slug === "v1")!;
    const original = { body: previousPlayPark.body, contentHash: previousPlayPark.contentHash, id: previousPlayPark.id };
    // Состояние до выпуска контактной редакции Play Park: беседки/ПД уже v2.
    rows.splice(rows.findIndex((row) => row.documentKey === "ps-park-offer" && row.slug === "v2"), 1);
    previousPlayPark.isCurrent = true;

    await seedLegalDocuments(asPrisma(fake));

    expect(fake.offerVersion.__store.rows.find((row) => row.id === original.id)).toMatchObject({ ...original, isCurrent: false });
    for (const documentKey of ["gazebos-offer", "privacy-policy", "ps-park-offer"]) {
      expect(fake.offerVersion.__store.rows.filter((row) => row.documentKey === documentKey && row.isCurrent).map((row) => row.slug)).toEqual(["v2"]);
    }
  });

  it("идемпотентен: повторный прогон не плодит редакции и не меняет текст", async () => {
    await seedLegalDocuments(asPrisma(fake));
    const before = fake.offerVersion.__store.rows.map((r) => ({ ...r }));

    await seedLegalDocuments(asPrisma(fake));

    const after = fake.offerVersion.__store.rows;
    expect(after).toHaveLength(6);
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

    for (const key of ["gazebos-offer", "privacy-policy", "ps-park-offer"]) {
      const current = fake.offerVersion.__store.rows.filter(
        (r) => r.documentKey === key && r.isCurrent
      );
      expect(current).toHaveLength(1);
    }
  });
});
