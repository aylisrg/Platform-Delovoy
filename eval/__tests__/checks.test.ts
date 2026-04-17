import { describe, it, expect } from "vitest";
import { checkPrd } from "../checks/prd";
import { checkAdr } from "../checks/adr";
import { checkReview } from "../checks/review";
import { checkQaReport } from "../checks/qa-report";

const VALID_PRD = `# PRD: Пример

## Проблема
Боль описана.

## Решение
Решение описано.

## User Stories

### US-1: Оплата
- **Как** пользователь
- **Я хочу** оплатить
- **Чтобы** не терять время

**Acceptance Criteria:**
- [ ] AC-1: Кнопка появляется
- [ ] AC-2: Оплата работает

## Приоритет (MoSCoW)
Must have — без оплаты модуль не запустится.

## Метрики успеха
- Базовое: 0%
- Целевое: 60%

## Вне скоупа
Возвраты за > 24 часа.
`;

const VALID_ADR = `# ADR-001: Онлайн-оплата

## Статус
Принято

## Контекст
Нужно принимать деньги онлайн.

## Варианты

### Вариант A: ЮKassa
- Плюсы: проверенный, документация на русском
- Минусы: комиссия

### Вариант B: CloudPayments
- Плюсы: ниже комиссия
- Минусы: меньше документации

## Решение
Выбран Вариант A.

## Последствия
- Новая таблица Payment
- Новый endpoint POST /api/payments — доступ MANAGER / SUPERADMIN, hasModuleAccess проверка

## Миграция
prisma migrate dev --name add_payment
`;

const VALID_REVIEW = `# Review: Онлайн-оплата

## Вердикт: PASS

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | Кнопка появляется |
| AC-2 | PASS | Оплата работает |

## Security
- Secrets leakage: OK
- RBAC: OK
- Supply chain: OK
`;

const VALID_QA = `# QA Report

## Вердикт: PASS

## Acceptance Criteria
- AC-1: PASS
- AC-2: PASS

## RBAC
- USER → 200
- анонимный → 401

## Edge Cases
- Пустые данные
- Невалидные данные
`;

describe("eval/checks/prd", () => {
  it("passes on valid PRD", () => {
    const result = checkPrd(VALID_PRD);
    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing sections", () => {
    const result = checkPrd("# PRD\n## Решение\nfoo");
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("Проблема"))).toBe(true);
  });

  it("reports missing user story parts", () => {
    const result = checkPrd(VALID_PRD.replace("Я хочу", "хочу"));
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("action=false"))).toBe(true);
  });

  it("requires MoSCoW mention", () => {
    const result = checkPrd(
      VALID_PRD.replace("Must have — без оплаты модуль не запустится.", "—")
    );
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("MoSCoW"))).toBe(true);
  });
});

describe("eval/checks/adr", () => {
  it("passes on valid ADR", () => {
    const result = checkAdr(VALID_ADR);
    expect(result.pass).toBe(true);
  });

  it("requires 2+ variants", () => {
    const oneVariant = VALID_ADR.replace(
      /### Вариант B:[\s\S]*?## Решение/m,
      "## Решение"
    );
    const result = checkAdr(oneVariant);
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("at least 2 options"))).toBe(true);
  });

  it("requires RBAC mention when new endpoints introduced", () => {
    const noRbac = VALID_ADR.replace(
      /доступ MANAGER \/ SUPERADMIN, hasModuleAccess проверка/,
      "доступ всем"
    );
    const result = checkAdr(noRbac);
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("RBAC"))).toBe(true);
  });
});

describe("eval/checks/review", () => {
  it("passes on valid review", () => {
    const result = checkReview(VALID_REVIEW);
    expect(result.pass).toBe(true);
  });

  it("requires explicit verdict", () => {
    const result = checkReview(VALID_REVIEW.replace("## Вердикт: PASS", ""));
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("verdict"))).toBe(true);
  });
});

describe("eval/checks/qa-report", () => {
  it("passes on valid report", () => {
    const result = checkQaReport(VALID_QA);
    expect(result.pass).toBe(true);
  });

  it("requires verdict", () => {
    const result = checkQaReport(VALID_QA.replace("## Вердикт: PASS", ""));
    expect(result.pass).toBe(false);
  });

  it("requires RBAC coverage", () => {
    const noRbac = VALID_QA.replace(/## RBAC[\s\S]*?\n\n/, "");
    const result = checkQaReport(noRbac);
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.includes("RBAC"))).toBe(true);
  });
});
