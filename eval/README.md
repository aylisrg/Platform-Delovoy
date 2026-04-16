# Agent Evals — Platform Delovoy

Регрессионные проверки артефактов агентов. Защищают от деградации качества при изменении промптов (`agents/*.md`).

## Что проверяется

Eval-фреймворк — это **структурные** проверки артефактов:

| Агент | Что чекаем |
|-------|-----------|
| PO (PRD) | Обязательные секции (Проблема, Решение, User Stories, AC, MoSCoW, Метрики, Вне скоупа). Каждая US имеет роль/действие/ценность. Каждый AC чек-бокс. |
| Architect (ADR) | Секции Статус, Контекст, Варианты (≥2), Решение, Последствия. Упоминание RBAC для новых endpoint'ов. |
| Reviewer (Review) | Явный вердикт PASS/NEEDS_CHANGES. Раздел Security. Таблица AC с статусами. |
| QA (QA-report) | Явный вердикт PASS/FAIL. Раздел про RBAC, rate limiting, edge cases. Привязка к AC. |

Эти проверки НЕ запускают модели — они парсят готовые артефакты. Дёшево, быстро, детерминированно. Полные end-to-end прогоны с моделью — отдельная задача (дорого, не для каждого PR).

## Структура

```
eval/
├── README.md              # этот файл
├── fixtures/              # золотой набор артефактов прошлых фич
│   ├── 2026-04-01-gazebo-payment/
│   │   ├── prd.md
│   │   ├── adr.md
│   │   ├── review.md
│   │   └── qa-report.md
│   └── ...
├── checks/                # функции-чекеры
│   ├── prd.ts
│   ├── adr.ts
│   ├── review.ts
│   └── qa-report.ts
├── runner.ts              # главный раннер
└── __tests__/             # vitest тесты на сами чекеры
    └── checks.test.ts
```

## Запуск

```bash
# Весь eval
npm run agents:eval

# Только для одного агента
npm run agents:eval -- --agent po

# На конкретном fixture
npm run agents:eval -- --fixture 2026-04-01-gazebo-payment
```

## Добавление нового fixture

1. Возьми реальные артефакты хорошего pipeline run (status = success) из `docs/`.
2. Скопируй в `eval/fixtures/<RUN_ID>/{prd,adr,review,qa-report}.md`.
3. Прогони `npm run agents:eval -- --fixture <RUN_ID>` — должно быть зелёное.
4. Закоммить.

## CI

`.github/workflows/agents-eval.yml` запускает eval при изменении `agents/*.md` или `.claude/agents/*.md`. При регрессии — PR блокируется.
