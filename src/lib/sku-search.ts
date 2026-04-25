/**
 * Client-safe SKU fuzzy search with bidirectional transliteration.
 *
 * Handles:
 *  - Case/whitespace normalization
 *  - Cyrillic → Latin:  "Ред Бул" → "red bul"  (close to "red bull")
 *  - Latin → Cyrillic:  "adrenalin" → "адреналин"
 *  - Levenshtein distance for typos and brand spelling differences
 *    ("Бул" vs "Bull" = 1 edit away after transliteration)
 */

// ── Transliteration tables ─────────────────────────────────────────────────

const CYR_TO_LAT: Record<string, string> = {
  а: "a",  б: "b",  в: "v",  г: "g",  д: "d",  е: "e",  ё: "yo",
  ж: "zh", з: "z",  и: "i",  й: "j",  к: "k",  л: "l",  м: "m",
  н: "n",  о: "o",  п: "p",  р: "r",  с: "s",  т: "t",  у: "u",
  ф: "f",  х: "h",  ц: "c",  ч: "ch", ш: "sh", щ: "sch",
  ъ: "",   ы: "y",  ь: "",   э: "e",  ю: "yu", я: "ya",
};

// Digraphs must come before single chars (order matters for replace)
const LAT_DIGRAPHS: [RegExp, string][] = [
  [/sch/g, "щ"],
  [/sh/g,  "ш"],
  [/zh/g,  "ж"],
  [/ch/g,  "ч"],
  [/yu/g,  "ю"],
  [/ya/g,  "я"],
  [/yo/g,  "ё"],
  [/ts/g,  "ц"],
  [/kh/g,  "х"],
];

const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф",
  g: "г", h: "х", i: "и", j: "й", k: "к", l: "л",
  m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "й", z: "з",
};

// ── Core utilities ─────────────────────────────────────────────────────────

export function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function cyrToLat(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((c) => CYR_TO_LAT[c] ?? c)
    .join("");
}

export function latToCyr(s: string): string {
  let r = s.toLowerCase();
  for (const [pat, rep] of LAT_DIGRAPHS) r = r.replace(pat, rep);
  return r
    .split("")
    .map((c) => LAT_TO_CYR[c] ?? c)
    .join("");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row DP — O(n) space
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function pairSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Public API ─────────────────────────────────────────────────────────────

export type MatchReason = "exact" | "substring" | "transliteration" | "fuzzy";

export type SkuSearchCandidate = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stockQuantity: number;
  matchReason: MatchReason;
  score: number;
};

export type SkuInput = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stockQuantity?: number;
};

/**
 * Dynamic similarity threshold by query length.
 * Short queries (≤3 chars) need very high similarity to avoid false positives
 * like "рис" → "лис" (0.67 similarity, but obviously different products).
 */
function dynamicThreshold(qLen: number): number {
  // 0.88 lets a 3-char query be a substring of a longer name (substring score
  // floor for that case is ~0.89), but rejects raw Levenshtein matches like
  // "рис" vs "лис" (similarity 0.67).
  if (qLen <= 3) return 0.88;
  if (qLen <= 5) return 0.74;
  return 0.62;
}

/**
 * Find SKUs similar to `query` from a pre-loaded list.
 * Runs entirely in-browser — no API call required.
 *
 * @param query     - raw user input
 * @param skus      - full list of SKUs to search through
 * @param threshold - minimum similarity score (0–1). When omitted, a dynamic
 *                   threshold is applied based on query length (stricter for short queries).
 * @param limit     - max results to return, default 6
 */
export function searchSkus(
  query: string,
  skus: SkuInput[],
  threshold?: number,
  limit = 6
): SkuSearchCandidate[] {
  const q = normalize(query);
  if (q.length < 2) return [];

  const effectiveThreshold = threshold ?? dynamicThreshold(q.length);

  const qLat = cyrToLat(q);
  const qCyr = latToCyr(q);

  const results: SkuSearchCandidate[] = [];

  for (const sku of skus) {
    const n    = normalize(sku.name);
    const nLat = cyrToLat(n);
    const nCyr = latToCyr(n);

    let bestScore = 0;
    let matchReason: MatchReason = "fuzzy";

    // All (queryVariant, skuVariant) pairs to compare
    const pairs: Array<[string, string, MatchReason]> = [
      [q,    n,    "fuzzy"],
      [q,    nLat, "transliteration"],
      [q,    nCyr, "transliteration"],
      [qLat, n,    "transliteration"],
      [qLat, nLat, "fuzzy"],
      [qCyr, n,    "transliteration"],
      [qCyr, nCyr, "fuzzy"],
    ];

    for (const [qa, na, reason] of pairs) {
      if (qa.length === 0 || na.length === 0) continue;

      // Exact match
      if (qa === na) {
        bestScore = 1;
        matchReason = reason === "fuzzy" ? "exact" : "transliteration";
        break;
      }

      // Substring match (penalised by length ratio so short queries don't dominate).
      // Keep transliteration label when the substring hit came from a translit pair.
      if (na.includes(qa) || qa.includes(na)) {
        const ratio = Math.min(qa.length, na.length) / Math.max(qa.length, na.length);
        const s = 0.85 + 0.1 * ratio; // 0.85–0.95 range
        if (s > bestScore) {
          bestScore = s;
          matchReason = reason !== "fuzzy" ? reason : "substring";
        }
        continue;
      }

      // Levenshtein similarity.
      // Skip pure Levenshtein for very short queries (<4 chars) — noisy at that length.
      // Substring + exact still applies and is enough for legitimate short matches.
      if (q.length < 4 && reason === "fuzzy") continue;

      const s = pairSimilarity(qa, na);
      if (s > bestScore) { bestScore = s; matchReason = reason; }
    }

    if (bestScore >= effectiveThreshold) {
      results.push({
        id: sku.id,
        name: sku.name,
        category: sku.category,
        unit: sku.unit,
        stockQuantity: sku.stockQuantity ?? 0,
        matchReason,
        score: bestScore,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
