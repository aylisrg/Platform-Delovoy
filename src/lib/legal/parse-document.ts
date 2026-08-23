import type { LegalBlock, LegalDocument, LegalSection } from "./types";

/**
 * Разбор markdown-редакции юридического документа в структуру для рендера.
 *
 * Парсер намеренно узкий: он понимает ровно тот набор конструкций, который
 * встречается в согласованных юристом документах (заголовки, нумерованные
 * пункты, абзацы, врезки-цитаты, таблицы прайса). Незнакомая строка не
 * теряется — она становится обычным абзацем.
 *
 * Текст редакции неизменяем и хешируется, поэтому размечать его служебными
 * аннотациями нельзя: якоря приложений задаются здесь, в коде.
 */

/**
 * Якоря приложений. `pravila` — не косметика: на `/oferta#pravila` ссылается
 * обязательный чекбокс акцепта (ТЗ §5.1.3), сломав его, мы сломаем ссылку,
 * которую клиент видел в момент заключения договора.
 */
const APPENDIX_ANCHORS: Record<string, string> = {
  "1": "pravila",
  "2": "price",
  "3": "akcept",
};

/** Префикс пунктов основного текста: `7.4.2.` → `p-7-4-2` (ТЗ §4.2). */
const MAIN_PREFIX = "p";

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CLAUSE_RE = /^(\d+(?:\.\d+)*)\.\s+(.+)$/;
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\.\s+(.+)$/;
const APPENDIX_RE = /^Приложение\s+№\s*(\d+)$/;
const TABLE_DELIM_RE = /^\|(?:\s*:?-{2,}:?\s*\|)+$/;

/** `7.4.2` + префикс → `p-7-4-2`. */
export function clauseAnchor(prefix: string, number: string): string {
  return `${prefix}-${number.replace(/\./g, "-")}`;
}

export function parseLegalDocument(markdown: string): LegalDocument {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  const doc: LegalDocument = { title: "", subtitle: null, preamble: [], sections: [] };

  // Куда складывать блоки прямо сейчас: преамбула или последний раздел.
  let current: LegalSection | null = null;
  // Префикс пунктов текущей части документа: основной текст или приложение.
  let prefix = MAIN_PREFIX;
  // Буфер строк, ещё не собранных в блок.
  let buffer: string[] = [];

  const target = (): LegalBlock[] => (current ? current.blocks : doc.preamble);

  function flush() {
    if (buffer.length === 0) return;
    const [first, ...rest] = buffer;
    buffer = [];

    // Номер пункта несёт только первая строка; продолжение абзаца — обычный
    // текст того же пункта.
    const clause = CLAUSE_RE.exec(first);
    if (clause) {
      target().push({
        kind: "clause",
        number: clause[1],
        id: clauseAnchor(prefix, clause[1]),
        html: renderInline([clause[2], ...rest].join("\n")),
      });
      return;
    }
    target().push({ kind: "paragraph", html: renderInline([first, ...rest].join("\n")) });
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flush();
      continue;
    }

    // Горизонтальные линейки в исходнике разделяют части — визуально не нужны.
    if (/^-{3,}$/.test(line.trim())) {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2].trim();

      const appendix = APPENDIX_RE.exec(stripInlineMarkers(text));
      if (appendix) {
        // Приложение начинает новую часть: и свой якорь, и свою нумерацию
        // пунктов (в Приложении № 1 снова есть п. 1.1 — с основным текстом
        // он не должен схлопнуться в один id).
        prefix = APPENDIX_ANCHORS[appendix[1]] ?? `prilozhenie-${appendix[1]}`;
        current = { id: prefix, number: null, title: text, level: 1, blocks: [] };
        doc.sections.push(current);
        continue;
      }

      if (level === 1) {
        doc.title = stripInlineMarkers(text);
        continue;
      }

      const numbered = NUMBERED_HEADING_RE.exec(text);

      // Ненумерованный h2 сразу под h1 и до первого раздела — подзаголовок
      // документа («о заключении договора…»), а не раздел. Нумерованный —
      // всегда раздел, даже если h1 в документе нет.
      if (
        level === 2 &&
        !numbered &&
        current === null &&
        doc.subtitle === null &&
        doc.preamble.length === 0
      ) {
        doc.subtitle = stripInlineMarkers(text);
        continue;
      }

      // `### 8.1. Исполнитель обязан:` — подзаголовок внутри раздела, не раздел.
      if (level >= 3 && numbered && current && current.level === 1 && prefix === MAIN_PREFIX) {
        current.blocks.push({
          kind: "subheading",
          id: clauseAnchor(prefix, numbered[1]),
          number: numbered[1],
          label: numbered[2],
        });
        continue;
      }

      const insideAppendix = prefix !== MAIN_PREFIX;
      const section: LegalSection = {
        id: numbered
          ? insideAppendix
            ? `${prefix}-${numbered[1].replace(/\./g, "-")}`
            : clauseAnchor(prefix, numbered[1])
          : `${prefix}-${slugify(text)}`,
        number: numbered ? numbered[1] : null,
        title: numbered ? numbered[2] : stripInlineMarkers(text),
        level: insideAppendix ? 2 : 1,
        blocks: [],
      };
      // Приложение № 2 в подзаголовке несёт своё название («ПРАЙС-ЛИСТ»):
      // это не отдельный раздел оглавления, а шапка уже открытой части.
      if (insideAppendix && level === 2 && current && current.blocks.length === 0 && current.level === 1) {
        current.title = `${current.title} — ${stripInlineMarkers(text)}`;
        continue;
      }
      current = section;
      doc.sections.push(section);
      continue;
    }

    if (line.startsWith(">")) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trimEnd().startsWith(">")) {
        quote.push(lines[i].trimEnd().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      target().push({ kind: "quote", html: renderInline(quote.join("\n")) });
      continue;
    }

    if (line.startsWith("|") && TABLE_DELIM_RE.test((lines[i + 1] ?? "").trim())) {
      flush();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      i--;
      target().push({ kind: "table", head, rows });
      continue;
    }

    buffer.push(line.trim());
  }
  flush();

  return doc;
}

/** Ячейки строки таблицы без внешних разделителей. */
function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => renderInline(cell.trim()));
}

/** Снимает `**жирный**` — для заголовков, где разметка не нужна. */
function stripInlineMarkers(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

function slugify(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return (
    stripInlineMarkers(text)
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * Инлайн-разметка → безопасный HTML.
 *
 * Экранируем ПЕРВЫМ делом, разметку накладываем уже на экранированный текст —
 * так произвольный html из документа не может доехать до страницы, даже если
 * когда-нибудь попадёт в текст редакции.
 */
export function renderInline(text: string): string {
  let html = escapeHtml(text);

  // [подпись](/ссылка) — только http(s) и относительные пути.
  html = html.replace(/\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, (_m, label, href) =>
    `<a href="${href}">${label}</a>`
  );

  // Голые URL и адреса почты — кликабельными: по ним идёт переписка с клиентом,
  // а в печатной версии CSS раскроет href в скобках.
  html = html.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;])/g,
    (_m, lead, url) => `${lead}<a href="${url}">${url}</a>`
  );
  html = html.replace(
    /(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+)/g,
    (_m, lead, mail) => `${lead}<a href="mailto:${mail}">${mail}</a>`
  );

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Мягкие переносы внутри абзаца (реквизиты, шапка редакции) — значимы.
  return html.replace(/\n/g, "<br />");
}
