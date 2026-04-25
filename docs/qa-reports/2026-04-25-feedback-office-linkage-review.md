# Review: feedback-office-linkage

**RUN_ID:** 2026-04-25-feedback-office-linkage
**Reviewer:** code-reviewer subagent
**Дата:** 2026-04-25
**Stage:** 4 / 5
**Stage 3 commit:** dc9ea3d — feat(feedback): link office to feedback items via FK + autocomplete

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1.1 combobox в форме | PASS | Интегрирован в `feedback-button.tsx`, поле "необязательно" |
| AC-1.2 ≥1 символ, до 10 совпадений | PASS | `query.length >= 1` и `take: 10` |
| AC-1.3 debounce 200мс | PASS | `DEBOUNCE_MS = 200` через setTimeout |
| AC-1.4 MAINTENANCE и неактивные скрыты | **FAIL** | `searchOffices` включает `"RESERVED"` в фильтр. PRD PO Decision 4 требует исключить и MAINTENANCE, и RESERVED |
| AC-1.5 officeId (FK) | PASS | `formData.append("officeId", office.id)` |
| AC-1.6 опционально | PASS | Zod `.optional()` |
| AC-1.7 FK сохраняется в БД | PASS | Миграция + `data: { officeId: ... }` |
| AC-1.8 очистка сбрасывает выбор | PASS | `handleClear()` |
| AC-1.9 только для авторизованных | PASS | Endpoint требует `auth()` |
| AC-2.1 чип в дашборде | PASS | Условный рендер |
| AC-2.2 zinc стиль | PASS | `bg-zinc-100 text-zinc-700 text-xs` |
| AC-2.3 NULL → нет чипа | PASS | Условный рендер |
| AC-2.4 данные из Office | PASS | `include: { office: { select } }` |
| AC-2.5 backward compatible | PASS | NULL допустим |
| AC-3.1 офис на admin detail | PASS | Условный рендер |
| AC-3.2 join, не текст | PASS | `include: { office }` |
| AC-3.3 NULL → нет строки | PASS | Условный рендер |
| AC-3.4 GET /api/feedback/[id] возвращает office | PASS | `getFeedbackById` расширён |
| AC-3.5 NULL обрабатывается штатно | PASS | Prisma include возвращает `null` |

---

## Качество кода

- TypeScript strict — OK, нет `any`
- Zod валидация — OK (`searchOfficeSchema` + `createFeedbackSchema.officeId` с preprocess)
- API формат — OK
- Тесты функциональные — **FAIL** (см. ниже)

---

## Тесты

`npm test`: 1659/1659 PASS, +27 от baseline.

**Проблемы:**

1. Тест в `src/modules/rental/__tests__/service.test.ts` ("excludes MAINTENANCE — only AVAILABLE/OCCUPIED/RESERVED returned") утверждает `{ in: ["AVAILABLE", "OCCUPIED", "RESERVED"] }` — соответствует сломанной реализации, не PRD. Тест закрепляет дефект.
2. RTL-тесты на combobox (ADR §7 п.4) отсутствуют. Senior Dev сослался на отсутствие `@testing-library/react`/`jsdom` в репо. Reviewer квалифицирует как ЖЕЛАТЕЛЬНО.

---

## Security

- Secrets: OK
- RBAC: OK (anon → 401, auth() check)
- SQL injection: OK (Prisma ORM)
- XSS: OK (React JSX escaping)
- Supply chain: OK (новых deps нет)
- Migration: OK (nullable + ON DELETE SET NULL)
- **RESERVED leak**: searchOffices возвращает RESERVED-офисы, которые по PRD скрыты от пользователей. Не классический security incident, но нарушение бизнес-правила.

---

## Scope

- 20 файлов в коммите, все в рамках ADR §10
- Не тронуты: RentalContract, Tenant, RentalInquiry, RentalDeal, Telegram WebApp, /admin/feedback/page.tsx
- Новых модулей в src/modules/ нет
- Формат apiResponse не изменён

---

## Что исправить (по версии Reviewer)

1. **КРИТИЧНО:** `searchOffices` — убрать `"RESERVED"` из фильтра.
2. **КРИТИЧНО:** Тест в `service.test.ts` — переписать под `{ in: ["AVAILABLE", "OCCUPIED"] }`.
3. **ВАЖНО:** `OfficeOption.status` и `STATUS_LABEL` в combobox — убрать `"RESERVED"`.
4. **ЖЕЛАТЕЛЬНО:** RTL-тесты на combobox или решение Architect об исключении ADR §7 п.4.

---

## CTO follow-up actions

В коммите follow-up все три критичных и важных пункта исправлены:
1. `src/modules/rental/service.ts` — фильтр `["AVAILABLE", "OCCUPIED"]`.
2. `src/modules/rental/__tests__/service.test.ts` — тест переписан + явный `not.toContain("RESERVED")`.
3. `src/components/ui/office-combobox.tsx` — `OfficeOption.status` сужен, `STATUS_LABEL.RESERVED` удалён.

По п.4 (RTL-тесты): CTO принял решение пропустить в этой итерации (см. context-log "Stage 4 follow-up — Решение CTO по RTL-тестам combobox"). Зафиксировано как техдолг для следующего pipeline.

---

**Verdict: NEEDS_CHANGES** (зафиксирован, далее CTO follow-up — см. выше)
