import { describe, it, expect } from "vitest";
import { extractMentionTokens, resolveMentions } from "../mentions";

describe("extractMentionTokens", () => {
  it("returns empty for empty or no-mention input", () => {
    expect(extractMentionTokens("")).toEqual([]);
    expect(extractMentionTokens("no mentions here")).toEqual([]);
    expect(extractMentionTokens("email: foo@bar.com")).toEqual(["bar.com"]);
    // An email-like token counts — it's still "@word", caller filters by user list
  });

  it("extracts a single Latin mention", () => {
    expect(extractMentionTokens("@petr please check")).toEqual(["petr"]);
  });

  it("extracts multiple distinct mentions", () => {
    const tokens = extractMentionTokens("@petr and @ivan take a look");
    expect(tokens.sort()).toEqual(["ivan", "petr"]);
  });

  it("deduplicates repeated mentions", () => {
    expect(extractMentionTokens("@petr @petr @petr")).toEqual(["petr"]);
  });

  it("supports Cyrillic mentions", () => {
    expect(extractMentionTokens("@петр проверь")).toEqual(["петр"]);
  });

  it("allows dots, underscores, hyphens in handles", () => {
    expect(extractMentionTokens("@john.doe hi")).toEqual(["john.doe"]);
    expect(extractMentionTokens("@john_doe hi")).toEqual(["john_doe"]);
    expect(extractMentionTokens("@john-doe hi")).toEqual(["john-doe"]);
  });

  it("lowercases tokens", () => {
    expect(extractMentionTokens("@Petr")).toEqual(["petr"]);
    expect(extractMentionTokens("@Пётр")).toEqual(["пётр"]);
  });
});

describe("resolveMentions", () => {
  const users = [
    { id: "u1", name: "Пётр Иванов", email: "petr@delovoy.ru" },
    { id: "u2", name: "Ivan Petrov", email: "ivan.petrov@delovoy.ru" },
    { id: "u3", name: "Мария Сидорова", email: null },
    { id: "u4", name: null, email: "admin@delovoy.ru" },
  ];

  it("matches by email local-part", () => {
    const matched = resolveMentions("@petr посмотри", users);
    expect(matched.map((u) => u.id)).toEqual(["u1"]);
  });

  it("matches by a single-word Cyrillic name", () => {
    const matched = resolveMentions("@мария посмотри", users);
    expect(matched.map((u) => u.id)).toEqual(["u3"]);
  });

  it("matches across multiple mentions", () => {
    const matched = resolveMentions("@petr и @ivan.petrov", users);
    expect(matched.map((u) => u.id).sort()).toEqual(["u1", "u2"]);
  });

  it("returns empty on no mentions", () => {
    expect(resolveMentions("comment without mentions", users)).toEqual([]);
  });

  it("matches user without name via email", () => {
    const matched = resolveMentions("@admin проверь", users);
    expect(matched.map((u) => u.id)).toEqual(["u4"]);
  });

  it("ignores unknown handles", () => {
    expect(resolveMentions("@nobody_here", users)).toEqual([]);
  });
});
