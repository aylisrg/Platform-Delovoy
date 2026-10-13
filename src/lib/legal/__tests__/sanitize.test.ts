import { describe, it, expect } from "vitest";
import { sanitizeLegalHtml } from "../sanitize";

describe("sanitizeLegalHtml", () => {
  it("сохраняет разметку, которую выдаёт parse-document", () => {
    const safe = `<strong>1</strong> <a href="/oferta">о</a> <a href="mailto:a@b.ru">a@b.ru</a><br />`;
    const out = sanitizeLegalHtml(safe);
    expect(out).toContain("<strong>1</strong>");
    expect(out).toContain('href="/oferta"');
    expect(out).toContain('href="mailto:a@b.ru"');
    expect(out).toContain("<br>");
  });
});
