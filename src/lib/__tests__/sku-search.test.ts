import { describe, it, expect } from "vitest";
import { searchSkus, cyrToLat, latToCyr, normalize } from "../sku-search";

const SKUS = [
  { id: "1", name: "Red Bull 0.25", category: "Напитки", unit: "шт", stockQuantity: 10 },
  { id: "2", name: "Adrenalin Rush 0.5", category: "Напитки", unit: "шт", stockQuantity: 5 },
  { id: "3", name: "Coca-Cola 0.5", category: "Напитки", unit: "шт", stockQuantity: 20 },
  { id: "4", name: "Вода Nestle 0.5", category: "Напитки", unit: "шт", stockQuantity: 15 },
  { id: "5", name: "Чипсы Lays", category: "Снеки", unit: "шт", stockQuantity: 8 },
];

describe("normalize", () => {
  it("trims and collapses whitespace", () => {
    expect(normalize("  Red  Bull ")).toBe("red bull");
  });
});

describe("cyrToLat", () => {
  it("transliterates Cyrillic to Latin", () => {
    expect(cyrToLat("ред бул")).toBe("red bul");
    expect(cyrToLat("адреналин")).toBe("adrenalin");
    expect(cyrToLat("вода")).toBe("voda");
  });
});

describe("latToCyr", () => {
  it("transliterates Latin to Cyrillic", () => {
    expect(latToCyr("adrenalin")).toBe("адреналин");
    expect(latToCyr("voda")).toBe("вода");
  });
  it("handles digraphs before single chars", () => {
    expect(latToCyr("sh")).toBe("ш");
    expect(latToCyr("zh")).toBe("ж");
    expect(latToCyr("ch")).toBe("ч");
  });
});

describe("searchSkus", () => {
  it("returns empty for query shorter than 2 chars", () => {
    expect(searchSkus("r", SKUS)).toHaveLength(0);
  });

  it("finds exact Latin match", () => {
    const r = searchSkus("Red Bull 0.25", SKUS);
    expect(r[0].id).toBe("1");
    expect(r[0].matchReason).toBe("exact");
  });

  it("finds substring match: Red Bull → Red Bull 0.25", () => {
    const r = searchSkus("Red Bull", SKUS);
    expect(r.some((c) => c.id === "1")).toBe(true);
    expect(r.find((c) => c.id === "1")?.matchReason).toBe("substring");
  });

  it("catches Cyrillic variant of Latin brand: Ред Бул → Red Bull", () => {
    const r = searchSkus("Ред Бул", SKUS);
    expect(r.some((c) => c.id === "1")).toBe(true);
  });

  it("catches Latin variant of Cyrillic brand: Adrenalin → Адреналин", () => {
    const r = searchSkus("Адреналин", SKUS);
    expect(r.some((c) => c.id === "2")).toBe(true);
  });

  it("catches Latin input for Cyrillic brand: adrenalin → Adrenalin Rush", () => {
    const r = searchSkus("adrenalin", SKUS);
    expect(r.some((c) => c.id === "2")).toBe(true);
  });

  it("is case-insensitive", () => {
    const r = searchSkus("red bull", SKUS);
    expect(r[0].id).toBe("1");
  });

  it("catches substring match: cola → Coca-Cola", () => {
    const r = searchSkus("cola", SKUS);
    expect(r.some((c) => c.id === "3")).toBe(true);
  });

  it("finds Cyrillic brand by Cyrillic query: Вода", () => {
    const r = searchSkus("Вода", SKUS);
    expect(r.some((c) => c.id === "4")).toBe(true);
  });

  it("handles typos: Red Bul → Red Bull (1 edit)", () => {
    const r = searchSkus("Red Bul", SKUS);
    expect(r.some((c) => c.id === "1")).toBe(true);
  });

  it("marks transliteration matches correctly", () => {
    const r = searchSkus("Ред Бул", SKUS);
    const match = r.find((c) => c.id === "1");
    expect(match?.matchReason).toBe("transliteration");
  });

  it("returns at most 6 results", () => {
    const r = searchSkus("0.5", SKUS);
    expect(r.length).toBeLessThanOrEqual(6);
  });

  it("doesn't return unrelated results below threshold", () => {
    const r = searchSkus("Lays", SKUS);
    expect(r.every((c) => c.id === "5")).toBe(true);
  });
});

describe("searchSkus — dynamic threshold (length-based)", () => {
  const SHORT_SKUS = [
    { id: "rice", name: "Рис", category: "Крупы", unit: "кг", stockQuantity: 10 },
    { id: "fox",  name: "Лис", category: "Игрушки", unit: "шт", stockQuantity: 3 },
    { id: "rb",   name: "Red Bull 0.25", category: "Напитки", unit: "шт", stockQuantity: 10 },
    { id: "red",  name: "Редиска", category: "Овощи", unit: "кг", stockQuantity: 4 },
  ];

  it('does not produce false positive: "рис" should NOT match "Лис" (Levenshtein 0.67)', () => {
    const r = searchSkus("рис", SHORT_SKUS);
    // Should match "Рис" exactly, but not "Лис".
    expect(r.some((c) => c.id === "rice")).toBe(true);
    expect(r.some((c) => c.id === "fox")).toBe(false);
  });

  it('"Red Bul" (5 chars) still finds "Red Bull 0.25" via substring', () => {
    const r = searchSkus("Red Bul", SHORT_SKUS);
    expect(r.some((c) => c.id === "rb")).toBe(true);
  });

  it('"Ред" (3 chars) does not return fuzzy noise — only substring/exact allowed at this length', () => {
    const r = searchSkus("Ред", SHORT_SKUS);
    // "Ред" is a substring of "Редиска" → should match.
    expect(r.some((c) => c.id === "red")).toBe(true);
    // Should NOT pull in unrelated short fuzzy matches.
    expect(r.some((c) => c.id === "fox")).toBe(false);
    expect(r.some((c) => c.id === "rice")).toBe(false);
  });

  it("explicit threshold overrides the dynamic default", () => {
    // With dynamic threshold "рис" wouldn't match "Лис". Force a low threshold to opt back in.
    const r = searchSkus("рис", SHORT_SKUS, 0.5);
    expect(r.some((c) => c.id === "fox")).toBe(true);
  });
});
