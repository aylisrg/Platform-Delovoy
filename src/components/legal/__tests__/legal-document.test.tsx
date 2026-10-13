import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocumentView } from "../legal-document";
import type { LegalDocument } from "@/lib/legal/types";

const XSS = `ok <img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;

function doc(): LegalDocument {
  return {
    title: "Оферта",
    subtitle: null,
    preamble: [{ kind: "paragraph", html: XSS }],
    sections: [
      {
        id: "p-1",
        number: "1",
        title: "Раздел",
        level: 1,
        blocks: [
          { kind: "clause", number: "1.1", id: "p-1-1", html: XSS },
          { kind: "quote", html: XSS },
          { kind: "table", head: [XSS], rows: [[XSS]] },
        ],
      },
    ],
  };
}

describe("LegalDocumentView: санитизация HTML", () => {
  it("вырезает script, обработчики событий и javascript: ссылки во всех блоках", () => {
    const html = renderToStaticMarkup(
      <LegalDocumentView
        doc={doc()}
        badge={{ number: 1, effectiveAt: new Date("2026-01-01"), archiveHref: null }}
        colophon="c"
      />
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("ok ");
  });
});
