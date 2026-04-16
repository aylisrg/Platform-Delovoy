import type { CheckResult } from "./prd";

export function checkReview(content: string): CheckResult {
  const issues: string[] = [];

  const verdictRegex = /(вердикт|verdict)\s*[:*]*\s*\**\s*(pass|needs[_ ]changes)/i;
  if (!verdictRegex.test(content)) {
    issues.push("Review report missing explicit verdict (PASS / NEEDS_CHANGES)");
  }

  if (!/^##\s+Security/im.test(content)) {
    issues.push("Review report missing mandatory ## Security section");
  }

  // AC table with statuses
  const hasAcTable =
    /^\|\s*AC\b.*\|/im.test(content) || /AC-\d+.*(PASS|FAIL)/i.test(content);
  if (!hasAcTable) {
    issues.push("Review report should reference AC statuses (table or inline)");
  }

  return { pass: issues.length === 0, issues };
}
