import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  afterEach(() => vi.useRealTimers());

  it("сохраняет архивные редакции и публикует новые с актуальными телефонами", async () => {
    await seedLegalDocuments(asPrisma(fake));

    const rows = fake.offerVersion.__store.rows;
    expect(rows).toHaveLength(5);
    expect([...new Set(rows.map((r) => r.documentKey))].sort()).toEqual(["gazebos-offer", "privacy-policy", "ps-park-offer"]);
    for (const row of rows) {
      expect(row.slug).toBe(`v${row.number}`);
      expect(row.isCurrent).toBe(row.number === 2);
      expect(String(row.body).length).toBeGreaterThan(1000);
      if (row.isCurrent) {
        const phone = row.documentKey === "gazebos-offer" ? "+7 (926) 900-81-20" : row.documentKey === "ps-park-offer" ? "+7 (985) 244-46-24" : "+7 (499) 647-71-42";
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

  it("не публикует отдельный проект вместо согласованной редакции Плей Парка", async () => {
    const draft = await fake.offerVersion.create({ data: {
      documentKey: "ps-park-offer", number: 1, slug: "held-test-draft",
      title: "Test fixture only", body: "Synthetic unpublished document",
      contentHash: hashDocumentBody("Synthetic unpublished document"), isCurrent: false,
    } });
    const before = { ...draft };

    await seedLegalDocuments(asPrisma(fake));

    expect(fake.offerVersion.__store.rows.filter((row) => row.slug === "held-test-draft"))
      .toEqual([before]);
    expect(fake.offerVersion.__store.rows.find((row) => row.documentKey === "ps-park-offer" && row.isCurrent)?.slug).toBe("v2");
  });

  it("фиксирует фактическую первую публикацию Плей Парка и сохраняет её при повторном seed", async () => {
    vi.useFakeTimers();
    const publishedAt = new Date("2026-11-02T10:05:00Z");
    vi.setSystemTime(publishedAt);
    await seedLegalDocuments(asPrisma(fake));
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    await seedLegalDocuments(asPrisma(fake));
    const offer = fake.offerVersion.__store.rows.find((row) => row.documentKey === "ps-park-offer")!;
    expect(offer.publishedAt).toEqual(publishedAt);
    expect(offer.effectiveAt).toEqual(publishedAt);
    expect(offer.body).toContain("/gazebos/oferta/v2#p-14");
    expect(offer.body).not.toMatch(/\b\d{12,15}\b|31 октября|ПРОЕКТ/);
    expect(offer.contentHash).toBe(hashDocumentBody(String(offer.body)));
  });

  it("отклоняет расхождение согласованной редакции Плей Парка без перезаписи", async () => {
    await seedLegalDocuments(asPrisma(fake));
    const offer = fake.offerVersion.__store.rows.find((row) => row.documentKey === "ps-park-offer")!;
    offer.contentHash = "unapproved-draft-hash";
    await expect(seedLegalDocuments(asPrisma(fake))).rejects.toThrow(/Опубликованная редакция неизменяема/);
    expect(offer.contentHash).toBe("unapproved-draft-hash");
  });

  it("идемпотентен: повторный прогон не плодит редакции и не меняет текст", async () => {
    await seedLegalDocuments(asPrisma(fake));
    const before = fake.offerVersion.__store.rows.map((r) => ({ ...r }));

    await seedLegalDocuments(asPrisma(fake));

    const after = fake.offerVersion.__store.rows;
    expect(after).toHaveLength(5);
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
