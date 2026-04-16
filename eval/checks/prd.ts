export type CheckResult = {
  pass: boolean;
  issues: string[];
};

const REQUIRED_SECTIONS = [
  /^##\s+Проблема/m,
  /^##\s+Решение/m,
  /^##\s+User Stories/m,
  /^##\s+Приоритет/m,
  /^##\s+Метрики/m,
  /^##\s+Вне скоупа/m,
];

export function checkPrd(content: string): CheckResult {
  const issues: string[] = [];

  for (const regex of REQUIRED_SECTIONS) {
    if (!regex.test(content)) {
      issues.push(`Missing required section: ${regex.source}`);
    }
  }

  const userStories = [...content.matchAll(/^###\s+US-\d+/gm)];
  if (userStories.length === 0) {
    issues.push("No user stories found (expected ### US-1, US-2, …)");
  }

  // Each US section should have a role / action / value
  // Note: the "Как / Я хочу / Чтобы" markers may be wrapped in **bold**.
  // Use simple substring checks — JS regex \b does not handle Cyrillic.
  const usSections = content.split(/^###\s+US-\d+/m).slice(1);
  usSections.forEach((section, i) => {
    const hasRole = /(?:^|[\s*])Как[\s*]/.test(section);
    const hasAction = /(?:^|[\s*])Я\s+хочу[\s*]/.test(section);
    const hasValue = /(?:^|[\s*])Чтобы[\s*]/.test(section);
    if (!hasRole || !hasAction || !hasValue) {
      issues.push(
        `US-${i + 1}: missing parts (role=${hasRole} action=${hasAction} value=${hasValue})`
      );
    }
    const acs = [...section.matchAll(/^-\s*\[\s?\]\s+AC-\d+/gm)];
    if (acs.length === 0) {
      issues.push(`US-${i + 1}: no acceptance criteria (expected - [ ] AC-1: ...)`);
    }
  });

  // MoSCoW
  if (!/(Must have|Should have|Could have|Won['’]t have)/i.test(content)) {
    issues.push("Приоритет section does not reference MoSCoW categories");
  }

  // Metrics — at least one baseline / target
  if (!/(базовое|baseline)/i.test(content) || !/(целевое|target)/i.test(content)) {
    issues.push("Метрики section missing baseline or target value");
  }

  return { pass: issues.length === 0, issues };
}
