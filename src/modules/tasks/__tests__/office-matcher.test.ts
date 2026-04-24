import { describe, it, expect } from "vitest";
import {
  normalizeOfficeInput,
  matchOffice,
  levenshtein,
  type OfficeRecord,
} from "../office-matcher";

describe("normalizeOfficeInput", () => {
  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeOfficeInput("")).toBe("");
    expect(normalizeOfficeInput("   ")).toBe("");
  });

  it("keeps plain digits unchanged", () => {
    expect(normalizeOfficeInput("301")).toBe("301");
  });

  it("strips various 'office' prefixes", () => {
    expect(normalizeOfficeInput("Офис 301")).toBe("301");
    expect(normalizeOfficeInput("офис 301")).toBe("301");
    expect(normalizeOfficeInput("оф.301")).toBe("301");
    expect(normalizeOfficeInput("оф. 301")).toBe("301");
    expect(normalizeOfficeInput("оф 301")).toBe("301");
    expect(normalizeOfficeInput("кабинет 301")).toBe("301");
    expect(normalizeOfficeInput("каб. 301")).toBe("301");
    expect(normalizeOfficeInput("каб 301")).toBe("301");
    expect(normalizeOfficeInput("room 301")).toBe("301");
    expect(normalizeOfficeInput("Office 301")).toBe("301");
  });

  it("strips number sign and hash", () => {
    expect(normalizeOfficeInput("№301")).toBe("301");
    expect(normalizeOfficeInput("#301")).toBe("301");
  });

  it("transliterates Cyrillic homoglyphs to Latin", () => {
    expect(normalizeOfficeInput("А-12")).toBe("a12");
    expect(normalizeOfficeInput("A-12")).toBe("a12");
    expect(normalizeOfficeInput("а12")).toBe("a12");
    expect(normalizeOfficeInput("а 12")).toBe("a12");
    // Cyrillic В → Latin b
    expect(normalizeOfficeInput("В-5")).toBe("b5");
  });

  it("handles various dashes/underscores", () => {
    expect(normalizeOfficeInput("A-12")).toBe("a12");
    expect(normalizeOfficeInput("A—12")).toBe("a12");
    expect(normalizeOfficeInput("A–12")).toBe("a12");
    expect(normalizeOfficeInput("A_12")).toBe("a12");
  });

  it("ignores trailing garbage after the digits", () => {
    expect(normalizeOfficeInput("301abc!@#")).toBe("301abc");
    expect(normalizeOfficeInput("301!!!")).toBe("301");
  });

  it("handles uppercase-only Latin", () => {
    expect(normalizeOfficeInput("A12")).toBe("a12");
    expect(normalizeOfficeInput("a12")).toBe("a12");
  });

  it("handles complex combined cases", () => {
    expect(normalizeOfficeInput("  Офис №А-12  ")).toBe("a12");
    expect(normalizeOfficeInput("Кабинет № A-12")).toBe("a12");
  });
});

describe("levenshtein", () => {
  it("zero for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "")).toBe(0);
  });

  it("length for empty comparand", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("single insertion / deletion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("digit typos", () => {
    expect(levenshtein("301", "302")).toBe(1);
    expect(levenshtein("301", "310")).toBe(2);
  });
});

describe("matchOffice", () => {
  const offices: OfficeRecord[] = [
    { id: "o1", number: "301", building: 1, floor: 3 },
    { id: "o2", number: "302", building: 1, floor: 3 },
    { id: "o3", number: "303", building: 1, floor: 3 },
    { id: "o4", number: "A-12", building: 2, floor: 1 },
    { id: "o5", number: "B-5", building: 2, floor: 1 },
  ];

  it("returns empty result for empty input", () => {
    const result = matchOffice("", offices);
    expect(result.exact).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("returns empty for garbage", () => {
    const result = matchOffice("zzz!!!", offices);
    expect(result.exact).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("finds exact match for plain digits", () => {
    const result = matchOffice("301", offices);
    expect(result.exact?.id).toBe("o1");
  });

  it("finds exact match stripping prefixes", () => {
    expect(matchOffice("Офис 301", offices).exact?.id).toBe("o1");
    expect(matchOffice("оф.301", offices).exact?.id).toBe("o1");
    expect(matchOffice("каб. 301", offices).exact?.id).toBe("o1");
    expect(matchOffice("room 301", offices).exact?.id).toBe("o1");
  });

  it("finds exact match for Cyrillic/Latin office A-12", () => {
    expect(matchOffice("А-12", offices).exact?.id).toBe("o4");
    expect(matchOffice("A-12", offices).exact?.id).toBe("o4");
    expect(matchOffice("а12", offices).exact?.id).toBe("o4");
    expect(matchOffice("a12", offices).exact?.id).toBe("o4");
    expect(matchOffice("A 12", offices).exact?.id).toBe("o4");
  });

  it("returns fuzzy candidates when no exact match", () => {
    // "305" typo — nearest are 301/302/303 at distance 1
    const result = matchOffice("305", offices);
    expect(result.exact).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    const ids = result.candidates.map((c) => c.id);
    // Should include 301/302/303 as nearest
    expect(ids.some((id) => ["o1", "o2", "o3"].includes(id))).toBe(true);
  });

  it("respects maxCandidates option", () => {
    const result = matchOffice("305", offices, { maxCandidates: 2 });
    expect(result.candidates.length).toBeLessThanOrEqual(2);
  });

  it("respects maxDistance option", () => {
    const result = matchOffice("999", offices, { maxDistance: 1 });
    // No office within distance 1 of "999"
    expect(result.candidates).toEqual([]);
  });

  it("handles ambiguous exact matches as candidates", () => {
    const withDupes: OfficeRecord[] = [
      { id: "o1", number: "301", building: 1 },
      { id: "o2", number: "301", building: 2 },
    ];
    const result = matchOffice("301", withDupes);
    expect(result.exact).toBeNull();
    expect(result.candidates.length).toBe(2);
  });
});
