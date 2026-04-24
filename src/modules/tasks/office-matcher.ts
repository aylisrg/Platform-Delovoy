// Office number normalization + fuzzy matching for tenant issue reports.
// Tenants send office numbers in wildly different formats: "Офис 301", "оф.301",
// "А-12" (Cyrillic), "A-12" (Latin), "каб. 301", "room 301", "№301".
// This module turns free-form input into a canonical form and finds the best
// match against a list of known Office.number values.
//
// Pure functions only — no DB access, fully testable in isolation.

export type OfficeRecord = {
  id: string;
  number: string;
  building?: number | null;
  floor?: number | null;
};

export type OfficeMatchResult = {
  exact: OfficeRecord | null;
  candidates: OfficeRecord[];
};

const PREFIX_WORDS = [
  "кабинет",
  "кабинета",
  "офиса",
  "офис",
  "office",
  "room",
  "каб",
  "оф",
];

// Cyrillic → Latin homoglyph map.
// Only letters visually identical / near-identical in uppercase or lowercase.
const CYR_TO_LAT: Record<string, string> = {
  а: "a", А: "A",
  в: "b", В: "B",
  е: "e", Е: "E",
  к: "k", К: "K",
  м: "m", М: "M",
  н: "h", Н: "H",
  о: "o", О: "O",
  р: "p", Р: "P",
  с: "c", С: "C",
  т: "t", Т: "T",
  у: "y", У: "Y",
  х: "x", Х: "X",
};

function transliterateHomoglyphs(input: string): string {
  let out = "";
  for (const ch of input) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
}

/**
 * Reduce an office-number string to canonical form:
 *   lowercase, homoglyph-transliterated, prefix-words stripped,
 *   dashes/spaces removed. Returns "" for empty/garbage input.
 */
export function normalizeOfficeInput(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();

  // Strip prefix words with optional trailing punctuation/whitespace.
  // Order matters — strip longer phrases first.
  const sortedPrefixes = [...PREFIX_WORDS].sort((a, b) => b.length - a.length);
  for (const word of sortedPrefixes) {
    // "офис 301" / "офис.301" / "офис301" / "оф. 301"
    const re = new RegExp(`(^|\\s|[.,:;])${word}\\.?\\s*`, "gi");
    s = s.replace(re, " ");
  }

  // Strip number sign / hash
  s = s.replace(/[№#]/g, "");

  // Homoglyphs Cyrillic → Latin
  s = transliterateHomoglyphs(s);

  // Unify dash-like chars
  s = s.replace(/[—–_]/g, "-");

  // Drop all whitespace
  s = s.replace(/\s+/g, "");

  // Also drop dashes for "relaxed" compare, but we keep dashes for primary form —
  // callers may want both. Here we produce the most-aggressive form: no dashes.
  s = s.replace(/-/g, "");

  // Strip any residual non-alphanumeric tail (e.g. "!" "?"), keep a-z0-9
  s = s.replace(/[^a-z0-9]/g, "");

  return s;
}

/**
 * Classic iterative Levenshtein distance.
 * O(m*n) time, O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Ensure a is the shorter one
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  let prev = new Array(a.length + 1);
  let cur = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    cur[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[i] = Math.min(cur[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }

  return prev[a.length];
}

type MatchOptions = {
  /** Max candidates to return when no exact match is found. Default 3. */
  maxCandidates?: number;
  /** Max Levenshtein distance for fuzzy candidates. Default 2. */
  maxDistance?: number;
};

/**
 * Find the best-matching office for a free-form user input.
 *
 * Strategy:
 *   1. Normalize input. If empty — return no matches.
 *   2. Exact match on normalized office numbers. If exactly one — that's the answer.
 *      If multiple (e.g. same number in different buildings) — return them as candidates.
 *   3. Otherwise fuzzy match via Levenshtein with maxDistance, sort by distance asc,
 *      return up to maxCandidates.
 */
export function matchOffice(
  input: string,
  offices: OfficeRecord[],
  options: MatchOptions = {}
): OfficeMatchResult {
  const maxCandidates = options.maxCandidates ?? 3;
  const maxDistance = options.maxDistance ?? 2;

  const normInput = normalizeOfficeInput(input);
  if (!normInput) {
    return { exact: null, candidates: [] };
  }

  const normalized = offices.map((o) => ({
    office: o,
    norm: normalizeOfficeInput(o.number),
  }));

  const exactMatches = normalized.filter((x) => x.norm === normInput);

  if (exactMatches.length === 1) {
    return { exact: exactMatches[0].office, candidates: [] };
  }

  if (exactMatches.length > 1) {
    // Ambiguous — same number in different buildings. Surface as candidates.
    return {
      exact: null,
      candidates: exactMatches.slice(0, maxCandidates).map((x) => x.office),
    };
  }

  // No exact — fall back to fuzzy.
  const scored = normalized
    .map((x) => ({ office: x.office, distance: levenshtein(normInput, x.norm) }))
    .filter((x) => x.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  return {
    exact: null,
    candidates: scored.slice(0, maxCandidates).map((x) => x.office),
  };
}
