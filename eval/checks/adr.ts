import type { CheckResult } from "./prd";

const REQUIRED_SECTIONS = [
  /^##\s+Статус/m,
  /^##\s+Контекст/m,
  /^##\s+Варианты/m,
  /^##\s+Решение/m,
  /^##\s+Последствия/m,
];

export function checkAdr(content: string): CheckResult {
  const issues: string[] = [];

  for (const regex of REQUIRED_SECTIONS) {
    if (!regex.test(content)) {
      issues.push(`Missing required ADR section: ${regex.source}`);
    }
  }

  // At least 2 alternatives evaluated
  const variants = [...content.matchAll(/^###\s+Вариант\s+[A-Za-zА-Яа-я0-9]/gm)];
  if (variants.length < 2) {
    issues.push(
      `ADR should evaluate at least 2 options, found ${variants.length}`
    );
  }

  // If ADR proposes new endpoints — RBAC must be mentioned
  if (/POST|PATCH|DELETE|GET\s+\/api\//i.test(content)) {
    if (!/(RBAC|role|роль|SUPERADMIN|MANAGER|hasModuleAccess)/i.test(content)) {
      issues.push(
        "ADR defines new API endpoints but does not specify RBAC / roles"
      );
    }
  }

  // If schema changes — migrations mentioned
  if (/^model\s+\w+\s*\{/m.test(content) || /prisma/i.test(content)) {
    if (!/(миграц|migration|prisma migrate)/i.test(content)) {
      issues.push("ADR changes Prisma schema but does not mention migrations");
    }
  }

  return { pass: issues.length === 0, issues };
}
