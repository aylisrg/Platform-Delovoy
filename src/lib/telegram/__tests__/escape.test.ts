import { describe, it, expect } from "vitest";
import { escapeHtml } from "../escape";

describe("escapeHtml", () => {
  it("экранирует три символа, значимых для Telegram HTML", () => {
    expect(escapeHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("амперсанд экранируется первым — иначе получилось бы &amp;lt;", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("обезвреживает ссылку — основной вектор фишинга в админ-чате", () => {
    expect(escapeHtml('<a href="http://evil">клик</a>')).not.toContain("<a href=");
  });

  it("кавычки не трогает: в текстовых узлах Telegram их не интерпретирует", () => {
    expect(escapeHtml(`"'`)).toBe(`"'`);
  });

  it("null и undefined превращаются в пустую строку, а не в 'null'", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("нестроковые значения приводятся к строке", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(true)).toBe("true");
  });

  it("обычный текст остаётся нетронутым", () => {
    expect(escapeHtml("PS5 #3 — стол у окна")).toBe("PS5 #3 — стол у окна");
  });
});
