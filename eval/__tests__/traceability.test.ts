import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkTraceability, extractAcIds, formatCoverageTable } from "../checks/traceability";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "sample-ac-traceability");
const prd = readFileSync(path.join(FIXTURE_DIR, "sample-prd.md"), "utf-8");
const partiallyCoveredTest = readFileSync(
  path.join(FIXTURE_DIR, "sample-booking-tests.ts"),
  "utf-8"
);

describe("eval/checks/traceability — extractAcIds", () => {
  it("extracts AC-N ids from the PRD checklist, deduped in order of first appearance", () => {
    const { ids } = extractAcIds(prd);
    expect(ids).toEqual(["AC-1", "AC-2", "AC-3"]);
  });

  it("flags AC-N reused across multiple User Stories as duplicates", () => {
    const { duplicates } = extractAcIds(prd);
    expect(duplicates).toEqual(["AC-1"]);
  });

  it("returns no ids for a PRD without an AC checklist", () => {
    const { ids, duplicates } = extractAcIds("# PRD\n## Проблема\nNo AC items here.");
    expect(ids).toEqual([]);
    expect(duplicates).toEqual([]);
  });
});

describe("eval/checks/traceability — checkTraceability", () => {
  it("reports coverage from both // AC-N comments and it(...) titles", () => {
    const result = checkTraceability(prd, { "sample-booking-tests.ts": partiallyCoveredTest });
    const ac1 = result.coverage.find((c) => c.ac === "AC-1");
    const ac2 = result.coverage.find((c) => c.ac === "AC-2");
    expect(ac1?.covered).toBe(true);
    expect(ac1?.files).toEqual(["sample-booking-tests.ts"]);
    expect(ac2?.covered).toBe(true);
  });

  it("fails and lists issues when an AC is not referenced by any test", () => {
    const result = checkTraceability(prd, { "sample-booking-tests.ts": partiallyCoveredTest });
    expect(result.pass).toBe(false);
    expect(result.issues).toEqual([
      `AC-3: not referenced by any test file (expected "// AC-3" comment or it("...AC-3...") title)`,
    ]);
  });

  it("notes when the PRD reuses an AC-N id across User Stories", () => {
    const result = checkTraceability(prd, { "sample-booking-tests.ts": partiallyCoveredTest });
    expect(result.notes.some((n) => n.includes("AC-1"))).toBe(true);
  });

  it("passes with no issues once every AC is covered", () => {
    const fullyCovered =
      partiallyCoveredTest + `\nit("refunds automatically on cancellation (AC-3)", () => {});\n`;
    const result = checkTraceability(prd, { "sample-booking-tests.ts": fullyCovered });
    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not count a bare mention of AC-N outside a comment or test title", () => {
    const noise = `const message = "Refund policy references AC-3 indirectly";`;
    const result = checkTraceability(prd, { "sample-booking-tests.ts": noise });
    const ac3 = result.coverage.find((c) => c.ac === "AC-3");
    expect(ac3?.covered).toBe(false);
  });

  it("does not match AC-N inside identifiers merely ending in it/test (submit, contest)", () => {
    // Regression: an earlier version of the title-marker regex had no word
    // boundary before (it|test), so it matched inside "submit(" / "contest(".
    const noise = `function submit("... AC-3 ...") {}\nfunction contest("... AC-3 ...") {}`;
    const result = checkTraceability(prd, { "sample-booking-tests.ts": noise });
    const ac3 = result.coverage.find((c) => c.ac === "AC-3");
    expect(ac3?.covered).toBe(false);
  });

  it("does not count // appearing mid-line (e.g. inside a URL string) as a comment marker", () => {
    const noise = `const link = "https://park.example.com/AC-3";`;
    const result = checkTraceability(prd, { "sample-booking-tests.ts": noise });
    const ac3 = result.coverage.find((c) => c.ac === "AC-3");
    expect(ac3?.covered).toBe(false);
  });

  it("fails with a single explanatory issue when the PRD has no AC-N items", () => {
    const result = checkTraceability("# PRD\n## Проблема\nfoo", {});
    expect(result.pass).toBe(false);
    expect(result.issues).toEqual(["PRD has no AC-N checklist items to trace (expected - [ ] AC-1: ...)"]);
    expect(result.coverage).toEqual([]);
  });
});

describe("eval/checks/traceability — formatCoverageTable", () => {
  it("renders a markdown table with one row per AC", () => {
    const result = checkTraceability(prd, { "sample-booking-tests.ts": partiallyCoveredTest });
    const table = formatCoverageTable(result.coverage);
    expect(table).toContain("| AC | Covered | Tests |");
    expect(table).toContain("| AC-1 | ✅ | sample-booking-tests.ts |");
    expect(table).toContain("| AC-3 | ❌ | — |");
  });

  it("renders a placeholder when there is no coverage data", () => {
    expect(formatCoverageTable([])).toBe("_No AC-N items found in PRD._");
  });
});
