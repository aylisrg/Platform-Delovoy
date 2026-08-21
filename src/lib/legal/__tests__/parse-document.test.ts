import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLegalDocument, clauseAnchor, renderInline } from "../parse-document";
import type { LegalBlock } from "../types";

const OFFER = readFileSync(
  join(process.cwd(), "content/legal/gazebos-offer/v1.md"),
  "utf-8"
);

const clauses = (blocks: LegalBlock[]) =>
  blocks.filter((b): b is Extract<LegalBlock, { kind: "clause" }> => b.kind === "clause");

describe("clauseAnchor", () => {
  it("превращает номер пункта в якорь по формату ТЗ §4.2", () => {
    expect(clauseAnchor("p", "7.4.2")).toBe("p-7-4-2");
    expect(clauseAnchor("p", "7")).toBe("p-7");
    expect(clauseAnchor("pravila", "3.1")).toBe("pravila-3-1");
  });
});

describe("renderInline", () => {
  it("экранирует html до наложения разметки", () => {
    expect(renderInline('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("рендерит жирный текст и markdown-ссылки", () => {
    expect(renderInline("**Сайт** — см. [оферту](/oferta)")).toBe(
      '<strong>Сайт</strong> — см. <a href="/oferta">оферту</a>'
    );
  });

  it("не пропускает javascript: в ссылку", () => {
    const html = renderInline("[клик](javascript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).toContain("javascript:alert(1)");
  });

  it("делает кликабельными голые URL и адреса почты", () => {
    expect(renderInline("сайт https://delovoy-park.ru работает")).toContain(
      '<a href="https://delovoy-park.ru">https://delovoy-park.ru</a>'
    );
    expect(renderInline("пишите на info@delovoy-park.ru")).toContain(
      '<a href="mailto:info@delovoy-park.ru">info@delovoy-park.ru</a>'
    );
  });

  it("сохраняет мягкие переносы внутри абзаца — реквизиты идут построчно", () => {
    expect(renderInline("ОГРНИП 305770002665641\nИНН 771802293300")).toBe(
      "ОГРНИП 305770002665641<br />ИНН 771802293300"
    );
  });
});

describe("parseLegalDocument — оферта Барбекю Парка", () => {
  const doc = parseLegalDocument(OFFER);

  it("разбирает шапку документа", () => {
    expect(doc.title).toBe("ПУБЛИЧНАЯ ОФЕРТА");
    expect(doc.subtitle).toContain("Барбекю Парк");
    expect(doc.preamble.length).toBeGreaterThan(0);
  });

  it("нумерует разделы основного текста как p-N", () => {
    const ids = doc.sections.filter((s) => s.level === 1).map((s) => s.id);
    expect(ids).toContain("p-7");
    expect(ids).toContain("p-1");
  });

  it("даёт каждому пункту свой якорь, включая вложенные", () => {
    const s7 = doc.sections.find((s) => s.id === "p-7");
    expect(s7).toBeDefined();
    const ids = clauses(s7!.blocks).map((c) => c.id);
    expect(ids).toContain("p-7-1");
    expect(ids).toContain("p-7-4-2");
    expect(ids).toContain("p-7-8");
  });

  it("сохраняет текст пункта 7.4.2 целиком", () => {
    const s7 = doc.sections.find((s) => s.id === "p-7")!;
    const clause = clauses(s7.blocks).find((c) => c.id === "p-7-4-2")!;
    expect(clause.number).toBe("7.4.2");
    expect(clause.html).toContain("стоимость Дополнительных услуг");
  });

  it("даёт Правилам посещения якорь pravila — на него ссылается чекбокс акцепта", () => {
    const rules = doc.sections.find((s) => s.id === "pravila");
    expect(rules).toBeDefined();
    expect(rules!.title).toContain("ПРАВИЛА ПОСЕЩЕНИЯ");
  });

  it("не схлопывает одноимённые пункты приложения и основного текста", () => {
    const all = doc.sections.flatMap((s) => clauses(s.blocks).map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("p-1-1");
    expect(all).toContain("pravila-1-1");
  });

  it("разбирает таблицы прайс-листа", () => {
    const tables = doc.sections
      .flatMap((s) => s.blocks)
      .filter((b): b is Extract<LegalBlock, { kind: "table" }> => b.kind === "table");
    expect(tables).toHaveLength(3);
    const gazebos = tables[0];
    expect(gazebos.head[0]).toBe("Беседка");
    expect(gazebos.rows[0]).toContain("до 20 чел.");
  });

  it("разбирает врезки Приложения № 3", () => {
    const quotes = doc.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.kind === "quote");
    expect(quotes.length).toBeGreaterThanOrEqual(4);
  });

  it("выносит `### 8.1. Исполнитель обязан:` в подзаголовок, а не в раздел", () => {
    const s8 = doc.sections.find((s) => s.id === "p-8")!;
    const subs = s8.blocks.filter((b) => b.kind === "subheading");
    expect(subs).toHaveLength(4);
    expect(doc.sections.map((s) => s.id)).not.toContain("p-8-1");
  });

  it("покрывает все 14 разделов основного текста и 3 приложения", () => {
    const main = doc.sections.filter((s) => s.level === 1 && s.number !== null);
    expect(main).toHaveLength(14);
    const appendices = doc.sections.filter((s) => s.title.includes("Приложение"));
    expect(appendices).toHaveLength(3);
  });
});

describe("parseLegalDocument — политика обработки ПД", () => {
  const doc = parseLegalDocument(
    readFileSync(join(process.cwd(), "content/legal/privacy-policy/v1.md"), "utf-8")
  );

  it("разбирается тем же парсером", () => {
    expect(doc.title).toBe("ПОЛИТИКА");
    expect(doc.sections.filter((s) => s.level === 1)).toHaveLength(13);
    const s5 = doc.sections.find((s) => s.id === "p-5")!;
    expect(clauses(s5.blocks).map((c) => c.id)).toContain("p-5-4");
  });
});

describe("parseLegalDocument — устойчивость", () => {
  it("не теряет незнакомую строку — она становится абзацем", () => {
    const doc = parseLegalDocument("## 1. Раздел\n\nПросто текст без номера.\n");
    expect(doc.sections[0].blocks).toEqual([
      { kind: "paragraph", html: "Просто текст без номера." },
    ]);
  });

  it("склеивает многострочный пункт в один блок", () => {
    const doc = parseLegalDocument("## 1. Раздел\n\n1.1. Первая строка\nвторая строка.\n");
    const [block] = clauses(doc.sections[0].blocks);
    expect(block.number).toBe("1.1");
    expect(block.html).toBe("Первая строка<br />вторая строка.");
  });

  it("переживает пустой документ", () => {
    const doc = parseLegalDocument("");
    expect(doc.sections).toHaveLength(0);
    expect(doc.title).toBe("");
  });
});
