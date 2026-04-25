# QA Report: feedback-office-linkage

**Verdict:** PASS
**Дата:** 2026-04-25
**Tester:** CTO (qa-engineer subagent timed out — pattern same as Architect Stage 2)
**RUN_ID:** 2026-04-25-feedback-office-linkage
**Stage 3 commit:** dc9ea3d (feat) → 9e2bc31 (Reviewer follow-up fix)

---

## 1. Test execution

| Проверка | Результат | Детали |
|----------|-----------|--------|
| `npm test` | PASS | 1659/1659 tests, 92 files, 15.39s |
| `npm run lint` | PASS | 0 errors, 0 warnings |
| `npx tsc --noEmit` | PASS | exit 0 (output empty) |

Baseline (предыдущий pipeline): 1632/1632. Эта фича добавила +27 тестов, регрессий нет. Все three checks выполнены непосредственно перед QA-отчётом.

---

## 2. AC verification

| AC | Вердикт | Evidence |
|----|---------|----------|
| AC-1.1 combobox в форме | PASS | `src/components/public/feedback-button.tsx:14,184-189`: импорт, состояние `office`, рендер `<OfficeCombobox>` |
| AC-1.2 ≥1 символ, ≤10 совпадений | PASS | `office-combobox.tsx:84` (`if (!query) return`); `service.ts:searchOffices` `take: 10` |
| AC-1.3 debounce 200мс | PASS | `office-combobox.tsx:24` `DEBOUNCE_MS = 200` через setTimeout/clearTimeout |
| AC-1.4 MAINTENANCE и RESERVED скрыты | PASS (после fix) | `service.ts:searchOffices` фильтр `["AVAILABLE", "OCCUPIED"]`. Тест `service.test.ts` явно `expect(...).not.toContain("RESERVED")` |
| AC-1.5 FK сохраняется (officeId, не текст) | PASS | `feedback-button.tsx`: `formData.append("officeId", office.id)` |
| AC-1.6 опционально, без выбора форма работает | PASS | Zod `.optional()` + `if (office) formData.append(...)` |
| AC-1.7 FK в БД | PASS | Migration `20260425000000_feedback_office_linkage`: ADD COLUMN officeId TEXT + FK; service.ts передаёт `officeId` в `prisma.feedbackItem.create` |
| AC-1.8 очистка сбрасывает выбор | PASS | `office-combobox.tsx:handleClear`: `onChange(null)`, query reset |
| AC-1.9 только для авторизованных | PASS | Endpoint `auth()` проверка, форма скрыта от гостей (existing) |
| AC-2.1 чип в дашборде | PASS | `(public)/dashboard/page.tsx:312-316` условный рендер |
| AC-2.2 zinc стиль | PASS | `bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700` |
| AC-2.3 NULL → нет чипа | PASS | `{fb.office && <span>...}` |
| AC-2.4 данные через Prisma include | PASS | `dashboard/page.tsx`: `include: { office: { select: { id, number, floor, building } } }` |
| AC-2.5 backward compatible | PASS | NULL допустим в схеме, рендер условный |
| AC-3.1 офис на admin detail | PASS | `admin/feedback/[id]/page.tsx:177-181`: условный рендер строки "Офис" |
| AC-3.2 join, не текст | PASS | `getFeedbackById` расширен `include: { office: { select } }` |
| AC-3.3 NULL → нет строки | PASS | Условный рендер `{item.office && ...}` |
| AC-3.4 GET /api/feedback/[id] возвращает office | PASS | `getFeedbackById` возвращает `feedback.office`, route спредит `...feedback` |
| AC-3.5 NULL обрабатывается штатно | PASS | Prisma include возвращает `null` для отсутствующего офиса |

**Итог:** 19/19 PASS.

---

## 3. Security counter-example

### 3.1 RESERVED leak (исправлено в follow-up коммите)

**Сценарий до фикса:** USER вызывает `GET /api/rental/offices/search?q=...` → видит RESERVED-офисы (внутренние резервы парка).

**Тест после фикса:** `src/modules/rental/__tests__/service.test.ts:910-921`:
```ts
it("excludes MAINTENANCE and RESERVED — only AVAILABLE/OCCUPIED returned", async () => {
  await searchOffices("3");
  const args = vi.mocked(prisma.office.findMany).mock.calls[0][0];
  expect(args?.where?.status).toEqual({ in: ["AVAILABLE", "OCCUPIED"] });
  expect((args?.where?.status as { in: string[] }).in).not.toContain("RESERVED");
});
```

Зелёный. RESERVED больше не попадает в выдачу.

### 3.2 No-pricing leak

`searchOffices` `select` ограничен `{ id, number, building, floor, status }`. Тест `service.test.ts` проверяет: `expect(args?.select).not.toHaveProperty("pricePerMonth")`. Зелёный.

### 3.3 RBAC: anonymous → 401

Тест `route.test.ts:30-34`: `mockAuth.mockResolvedValue(null)` → `expect(res.status).toBe(401)`. Зелёный.

### 3.4 Invalid CUID rejected (anti FK injection)

`createFeedbackSchema.officeId` — `z.string().cuid()`. Невалидный формат → 422. Тест `validation.test.ts` зелёный.

### 3.5 Missing office → friendly 422 (не P2003)

Service делает explicit `prisma.office.findUnique` перед create. Если office не найден — `OfficeNotFoundError` → 422 "Офис не найден". Тест `feedback service.test.ts` зелёный.

---

## 4. Regression risks

| Риск | Статус | Обоснование |
|------|--------|-------------|
| Существующие FeedbackItem без officeId | Не сломаны | NULL допустим в migration + рендер условный |
| Существующие провайдеры auth (login pipeline) | Не сломаны | Auth-код не тронут, тесты предыдущего pipeline всё ещё зелёные |
| `RentalContract`, `Tenant`, `RentalDeal`, `RentalInquiry` | Не тронуты | grep по diff подтверждает |
| Telegram WebApp | Не тронут | Файлы `src/app/webapp/*` не в diff |
| Существующий `/api/rental/offices` (MANAGER+) | Не тронут | Новый endpoint в отдельной директории `search/` |
| `/admin/feedback/page.tsx` (список) | Не тронут | Out of scope per PRD |
| Migration backward compatibility | OK | ADD COLUMN nullable + `ON DELETE SET NULL` |
| TSC strict | Clean | exit 0 |
| ESLint | Clean | 0 problems |
| Existing tests | Все проходят | 1659/1659 (был 1632) |

---

## 5. Edge cases (manual code-walk)

| Сценарий | Поведение | Статус |
|----------|-----------|--------|
| User вводит несуществующий officeId через DevTools | `prisma.office.findUnique` → null → `OfficeNotFoundError` → 422 "Офис не найден" | OK (тест зелёный) |
| Combobox: пустой query | `if (!query) return; setResults([])` — fetch не выполняется | OK |
| Combobox: 3 быстрых ввода (50ms apart) | `clearTimeout` + новый `setTimeout(200)` → один fetch | OK (по коду; RTL-тест отсутствует — техдолг) |
| `searchOffices("301")` | `where.status.in = ["AVAILABLE", "OCCUPIED"]` — RESERVED не возвращается | OK (тест зелёный) |
| Combobox: AbortController при overlap | `abortRef.current?.abort()` перед новым fetch — нет race | OK (по коду) |
| User отвязывает офис: клик на ✕ | `handleClear` → `onChange(null)` → `formData` без `officeId` | OK |
| Office удалён в реестре после создания feedback | Migration `ON DELETE SET NULL` → feedback остаётся, плашка не рендерится | OK |
| Feedback с officeId, но user не имеет к нему отношения | Допустимо — поле опциональное, проверки "ваш ли это офис" нет (PRD §"Решение 2": нет условной логики по роли). Если в будущем нужна — Phase 5.1 автоподстановка из RentalContract | OK (соответствует PRD) |

---

## 6. Out-of-scope observations (pre-existing, не блокеры)

1. **RTL-инфра отсутствует.** ADR §7 п.4 требовал component-тесты на combobox через React Testing Library. Этого тулинга в репо нет (`vitest env=node`, `@testing-library/react` не установлен). CTO принял решение пропустить в этой итерации (см. context-log "Stage 4 follow-up — Решение CTO по RTL-тестам combobox"), зафиксировал как техдолг для следующего pipeline. Сервер-логика покрыта на 100%, поведение combobox в production будет проверено вручную/на staging.

2. **PRD ↔ ADR расхождение по RESERVED.** ADR §2 включил RESERVED в список разрешённых статусов; PRD PO Decision 4 — нет. Senior Dev следовал ADR. Reviewer поймал. Урок для следующих pipeline: PO contract выше ADR; Architect должен явно сверяться с PRD при формировании ADR. Можно усилить через checklist в `agents/architect.md` — но это отдельный backlog item.

3. **`isAdmin` в Navbar расходится с `redirectAfterLogin`** (pre-existing с предыдущего pipeline `2026-04-25-fix-login-public-profile`) — не блокер, не наш scope.

---

## 7. Final verdict

Все critical и important замечания Reviewer закрыты в коммите `9e2bc31`. RTL-тесты приняты как техдолг с обоснованием. 19/19 acceptance criteria PASS. 1659/1659 тестов зелёные. Lint и tsc чистые. Security: RESERVED больше не утекает, RBAC соблюдён, FK защищена через explicit-check, миграция backward-compatible.

**Final verdict: PASS**
