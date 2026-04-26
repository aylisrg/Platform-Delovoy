import { describe, expect, it } from "vitest";
import { categorizeByKeywords } from "../routing";

describe("categorizeByKeywords", () => {
  const categories = [
    { id: "cat-rental", slug: "rental", keywords: ["аренда", "офис"], sortOrder: 1 },
    { id: "cat-it", slug: "it", keywords: ["wi-fi", "интернет"], sortOrder: 2 },
    { id: "cat-clean", slug: "cleaning", keywords: ["уборка", "мусор"], sortOrder: 3 },
  ];

  it("matches first keyword in lowest sortOrder category", () => {
    expect(
      categorizeByKeywords("Не работает интернет в офисе 301", categories)
    ).toBe("cat-rental"); // 'офис' wins because sortOrder 1
  });

  it("falls back to next category if first has no match", () => {
    expect(categorizeByKeywords("Wi-Fi пропал", categories)).toBe("cat-it");
  });

  it("returns null for unmatched text", () => {
    expect(categorizeByKeywords("Просто хорошее настроение", categories)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(categorizeByKeywords("УБОРКА на этаже", categories)).toBe("cat-clean");
  });

  it("returns null for empty text", () => {
    expect(categorizeByKeywords("", categories)).toBeNull();
  });

  it("ignores empty keywords", () => {
    const cats = [{ id: "x", slug: "x", keywords: ["", "ok"], sortOrder: 0 }];
    expect(categorizeByKeywords("ok", cats)).toBe("x");
    expect(categorizeByKeywords("anything", cats)).toBeNull();
  });
});
