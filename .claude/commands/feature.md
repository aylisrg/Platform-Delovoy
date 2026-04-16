# /feature — Agent Pipeline: PO → Architect → Developer → Reviewer → QA

Запусти полный pipeline разработки фичи для Platform Delovoy.
Описание задачи: $ARGUMENTS

---

## Рекомендуемый путь: автономный pipeline

Если на машине настроен `claude` CLI и есть бюджет на автономный прогон — просто запусти:

```bash
./scripts/pipeline.sh "$ARGUMENTS"
```

Скрипт сам выполнит все 5 стадий, включит feedback-loop (Reviewer↔Developer, QA↔Developer),
соберёт артефакты в `docs/` и создаст PR. Подробнее — `agents/README.md`.

---

## Ручная координация (если запускаешь стадии из чата Claude Code)

Ты координатор pipeline из 5 агентов. Каждый агент — отдельный субагент (Agent tool) или native sub-agent из `.claude/agents/`.
Выполняй стадии **строго последовательно** — каждая следующая зависит от артефактов предыдущей.

Сгенерируй RUN_ID в формате: `YYYY-MM-DD-slug-задачи` (slug — латиницей, через дефис, до 50 символов).

Инициализируй общий контекст-лог `docs/context/{RUN_ID}-context.md` с заголовком задачи.
Каждый стейдж дописывает туда свои решения — следующий стейдж читает для полного контекста.

---

### Stage 1: Product Owner (Sonnet)

Запусти Agent с subagent_type `product-owner` (или `general-purpose` с промптом из `agents/po.md`):
- Задача: написать PRD для описанной фичи
- Агент должен прочитать `CLAUDE.md`, изучить существующий код, проверить дорожную карту
- Сохранить результат в `docs/requirements/{RUN_ID}-prd.md`
- Добавить секцию "PO — Ключевые решения" в `docs/context/{RUN_ID}-context.md`
- Дождись завершения, прочитай созданный PRD

---

### Stage 2: Architect (Opus)

Запусти Agent с subagent_type `system-architect` (или `general-purpose` с промптом из `agents/architect.md`):
- Передай PRD из Stage 1 + context-log как контекст
- Задача: спроектировать техническое решение, написать ADR
- Агент должен прочитать текущий код проекта и схему БД
- Сохранить результат в `docs/architecture/{RUN_ID}-adr.md`
- Добавить секцию "Architect — Ключевые решения" в context-log
- Дождись завершения, прочитай созданный ADR

---

### Stage 3: Developer (Opus)

Это делаешь ТЫ САМ (не субагент) — тебе нужны все инструменты (Edit, Write, Bash).
- Прочитай `agents/developer.md` для правил кодирования
- Прочитай PRD, ADR и context-log
- Прочитай `.claude/feedback/qa-patterns.md` (если существует) — список частых ошибок прошлых прогонов
- Реализуй фичу согласно ADR:
  - Бизнес-логика в `src/modules/{slug}/service.ts`
  - Типы в `src/modules/{slug}/types.ts`
  - Валидация в `src/modules/{slug}/validation.ts`
  - API routes в `src/app/api/{slug}/`
  - UI компоненты если нужно
- Пиши тесты вместе с кодом (`__tests__/` рядом)
- Запусти `npm test` и убедись что всё зелёное
- Делай коммиты по ходу работы (conventional commits: `feat:`, `fix:`, etc.)

---

### Stage 4: Reviewer (Sonnet) — LLM-as-Judge

Запусти Agent с subagent_type `code-reviewer` (или `general-purpose` с промптом из `agents/reviewer.md`):
- Передай PRD и ADR как контекст
- Задача: независимая проверка — соответствует ли реализация требованиям
- Выполнить `git diff main...HEAD`, пройтись по чеклисту (AC, scope creep, качество, безопасность)
- Сохранить вердикт в `docs/qa-reports/{RUN_ID}-review.md`
- **Вердикт PASS** → переходи к Stage 5
- **Вердикт NEEDS_CHANGES** → вернись к Stage 3, исправь замечания, прогони Reviewer повторно (до 3 итераций)

---

### Stage 5: QA (Sonnet)

Запусти Agent с subagent_type `qa-engineer` (или `general-purpose` с промптом из `agents/qa.md`):
- Передай полный текст PRD (с acceptance criteria) как контекст
- Задача: проверить реализацию, запустить тесты, написать QA-отчёт
- Агент должен проверить все acceptance criteria из PRD
- Запустить `npm test`
- Проверить качество кода (TypeScript strict, no any, Zod, apiResponse/apiError)
- Проверить RBAC (USER/MANAGER/SUPERADMIN), rate limiting, edge cases
- Сохранить отчёт в `docs/qa-reports/{RUN_ID}-qa-report.md`
- **Вердикт PASS** → pipeline успешен
- **Вердикт FAIL** → вернись к Stage 3, исправь баги, прогони QA повторно (до 3 итераций)

---

### Self-improvement: обновление paттернов ошибок

После прогона QA (независимо от вердикта) выполни:

```bash
bash scripts/collect-qa-feedback.sh docs/qa-reports/{RUN_ID}-qa-report.md
```

Это обновит `.claude/feedback/qa-patterns.md` — Developer использует его в следующем прогоне.

---

## Отчёт

После завершения всех стадий выведи сводку:

```
Pipeline завершён: {RUN_ID}

Артефакты:
  PRD:       docs/requirements/{RUN_ID}-prd.md
  ADR:       docs/architecture/{RUN_ID}-adr.md
  Review:    docs/qa-reports/{RUN_ID}-review.md
  QA Report: docs/qa-reports/{RUN_ID}-qa-report.md
  Context:   docs/context/{RUN_ID}-context.md

Итерации:
  Reviewer: N
  QA:       N

Коммиты: [список коммитов]
Тесты:   [результат npm test]
```

После успешного QA создай Pull Request в `main` (только если пользователь явно попросил PR).
