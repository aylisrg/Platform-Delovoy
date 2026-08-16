import type { CheckResult } from "./prd";

export type AcCoverage = {
  ac: string;
  covered: boolean;
  files: string[];
};

export type TraceabilityResult = CheckResult & {
  coverage: AcCoverage[];
  /** Информационные заметки, не влияющие на pass/fail (напр. дублирующиеся AC-N в разных US). */
  notes: string[];
};

// `AC-\d+(?:\.\d+)*` — PRDs commonly nest sub-criteria as AC-1.1, AC-1.2, ...
// (14/34 docs/requirements/*-prd.md at the time of issue #639). Each dotted
// id is tracked as its own identifier, distinct from its parent AC-N.
const AC_CHECKLIST_RE = /^-\s*\[\s?\]\s*(AC-\d+(?:\.\d+)*)/gm;

/** Escapes regex metacharacters in an AC id (the `.` in "AC-1.1" is literal, not "any char"). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PRD переиспользует AC-1, AC-2, ... в каждой User Story (это видно по реальным
 * PRD в docs/requirements/) — идентификаторы не уникальны на уровне всего файла.
 * duplicates перечисляет AC-N, встретившиеся более одного раза: для трассировки
 * это не ошибка (маркер в тесте — тоже просто "AC-N" без привязки к US), но
 * репортится как заметка, чтобы автор теста знал про неоднозначность.
 */
export function extractAcIds(prdContent: string): { ids: string[]; duplicates: string[] } {
  const counts = new Map<string, number>();
  const ids: string[] = [];
  for (const m of prdContent.matchAll(AC_CHECKLIST_RE)) {
    const id = m[1];
    if (!counts.has(id)) ids.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicates = ids.filter((id) => (counts.get(id) ?? 0) > 1);
  return { ids, duplicates };
}

// `\b` alone treats `.` as a valid terminator, so `\bAC-1\b` would also match
// the "AC-1" prefix inside "AC-1.2" — a marker for the sub-criterion would
// wrongly satisfy its (distinct) parent id too. `(?!\.\d)` rejects that.
function idBoundaryPattern(ac: string): string {
  return `\\b${escapeRegExp(ac)}\\b(?!\\.\\d)`;
}

function hasCommentMarker(testContent: string, ac: string): boolean {
  const idRe = new RegExp(idBoundaryPattern(ac));
  // Line must actually start with `//` (after trimming) — a bare `//` later on
  // the line (e.g. inside a URL string like "https://park.example.com/AC-1")
  // is not a comment marker.
  return testContent.split("\n").some((line) => line.trimStart().startsWith("//") && idRe.test(line));
}

function hasTitleMarker(testContent: string, ac: string): boolean {
  // `\b` before the (it|test) group is required — without it this would also
  // match inside unrelated identifiers ending in "it"/"test", e.g. `submit(`,
  // `commit(`, `contest(`. `(?<!\.)` additionally rejects member access like
  // `regex.test(...)` — a real call to RegExp.prototype.test, not a test title.
  const titleMarker = new RegExp(
    `(?<!\\.)\\b(?:it|test)\\s*(?:\\.\\w+)?\\s*\\(\\s*[\`'"][^\`'"]*${idBoundaryPattern(ac)}`
  );
  return titleMarker.test(testContent);
}

function referencesAc(testContent: string, ac: string): boolean {
  return hasCommentMarker(testContent, ac) || hasTitleMarker(testContent, ac);
}

/**
 * Структурная проверка: каждый AC-N чек-бокс из PRD должен встретиться хотя бы
 * в одном тестовом файле — маркером `// AC-N` в комментарии или `AC-N` в
 * названии `it(...)`/`test(...)`. Модели не запускаются, только парсинг текста.
 */
export function checkTraceability(
  prdContent: string,
  testFiles: Record<string, string>
): TraceabilityResult {
  const { ids: acIds, duplicates } = extractAcIds(prdContent);
  const issues: string[] = [];
  const notes: string[] = [];

  if (acIds.length === 0) {
    return {
      pass: false,
      issues: ["PRD has no AC-N checklist items to trace (expected - [ ] AC-1: ...)"],
      coverage: [],
      notes: [],
    };
  }

  const coverage: AcCoverage[] = acIds.map((ac) => {
    const files = Object.entries(testFiles)
      .filter(([, content]) => referencesAc(content, ac))
      .map(([file]) => file);
    return { ac, covered: files.length > 0, files };
  });

  for (const c of coverage) {
    if (!c.covered) {
      issues.push(
        `${c.ac}: not referenced by any test file (expected "// ${c.ac}" comment or it("...${c.ac}...") title)`
      );
    }
  }

  if (duplicates.length > 0) {
    notes.push(
      `PRD reuses ${[...new Set(duplicates)].join(", ")} across multiple User Stories — coverage is tracked per identifier, not per User Story.`
    );
  }

  return { pass: issues.length === 0, issues, coverage, notes };
}

export function formatCoverageTable(coverage: AcCoverage[]): string {
  if (coverage.length === 0) return "_No AC-N items found in PRD._";
  const header = "| AC | Covered | Tests |\n|----|---------|-------|";
  const rows = coverage.map(
    (c) => `| ${c.ac} | ${c.covered ? "✅" : "❌"} | ${c.files.length ? c.files.join(", ") : "—"} |`
  );
  return [header, ...rows].join("\n");
}
