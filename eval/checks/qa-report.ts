import type { CheckResult } from "./prd";

export function checkQaReport(content: string): CheckResult {
  const issues: string[] = [];

  const verdictRegex = /(вердикт|verdict|итог)\s*[:*]*\s*\**\s*(pass|fail)/i;
  if (!verdictRegex.test(content)) {
    issues.push("QA report missing explicit verdict (PASS / FAIL)");
  }

  // Edge cases enumerated
  if (!/edge\s*cases?|граничн/i.test(content)) {
    issues.push("QA report should mention edge cases");
  }

  // RBAC verification mentioned
  if (!/(RBAC|роль|role|USER|MANAGER|SUPERADMIN)/i.test(content)) {
    issues.push("QA report must verify RBAC");
  }

  // AC coverage
  if (!/AC-\d+/i.test(content)) {
    issues.push("QA report should reference AC-N identifiers");
  }

  return { pass: issues.length === 0, issues };
}
