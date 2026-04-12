# /feature — Agent Pipeline: PO -> Architect -> Developer -> QA

Запусти полный pipeline разработки фичи для Platform Delovoy.
Описание задачи: $ARGUMENTS

---

## Инструкции

Ты координатор pipeline из 4 агентов. Каждый агент — отдельный субагент (Agent tool).
Выполняй стадии **строго последовательно** — каждая следующая зависит от артефактов предыдущей.

Сгенерируй RUN_ID в формате: `YYYY-MM-DD-slug-задачи` (slug — латиницей, через дефис, до 50 символов).

---

### Stage 1: Product Owner

Запусти Agent с subagent_type "general-purpose":
- В промпте укажи полное содержимое файла `agents/po.md` как системные инструкции
- Задача: написать PRD для описанной фичи
- Агент должен прочитать CLAUDE.md, изучить существующий код, и создать PRD
- Сохранить результат в `docs/requirements/{RUN_ID}-prd.md`
- Дождись завершения, прочитай созданный PRD

---

### Stage 2: Architect

Запусти Agent с subagent_type "general-purpose":
- В промпте укажи полное содержимое файла `agents/architect.md` как системные инструкции
- Передай полный текст PRD из Stage 1 как контекст
- Задача: спроектировать техническое решение, написать ADR
- Агент должен прочитать текущий код проекта и схему БД
- Сохранить результат в `docs/architecture/{RUN_ID}-adr.md`
- Дождись завершения, прочитай созданный ADR

---

### Stage 3: Developer

Это делаешь ТЫ САМ (не субагент) — тебе нужны все инструменты (Edit, Write, Bash).
- Прочитай `agents/developer.md` для правил кодирования
- Прочитай PRD (docs/requirements/{RUN_ID}-prd.md) и ADR (docs/architecture/{RUN_ID}-adr.md)
- Реализуй фичу согласно ADR:
  - Бизнес-логика в `src/modules/{slug}/service.ts`
  - Типы в `src/modules/{slug}/types.ts`
  - Валидация в `src/modules/{slug}/validation.ts`
  - API routes в `src/app/api/{slug}/`
  - UI компоненты если нужно
- Пиши тесты вместе с кодом
- Запусти `npm test` и убедись что всё зелёное
- Делай коммиты по ходу работы (conventional commits: `feat:`, `fix:`, etc.)

---

### Stage 4: QA

Запусти Agent с subagent_type "general-purpose":
- В промпте укажи полное содержимое файла `agents/qa.md` как системные инструкции
- Передай полный текст PRD (с acceptance criteria) как контекст
- Задача: проверить реализацию, запустить тесты, написать QA-отчёт
- Агент должен проверить все acceptance criteria из PRD
- Запустить `npm test`
- Проверить качество кода (TypeScript strict, no any, Zod, apiResponse/apiError)
- Сохранить отчёт в `docs/qa-reports/{RUN_ID}-qa-report.md`

---

## Отчёт

После завершения всех стадий выведи сводку:

```
Pipeline завершён: {RUN_ID}

Артефакты:
  PRD:       docs/requirements/{RUN_ID}-prd.md
  ADR:       docs/architecture/{RUN_ID}-adr.md
  QA Report: docs/qa-reports/{RUN_ID}-qa-report.md

Коммиты: [список коммитов]
Тесты: [результат npm test]
```

Если QA нашёл баги — исправь их сам (Stage 3 повтор) и перезапусти QA.
