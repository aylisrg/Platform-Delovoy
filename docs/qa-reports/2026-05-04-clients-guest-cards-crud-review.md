# Review: F4 — CRM Карточка гостя: справочник + автозаполнение из Booking

**RUN_ID**: `2026-05-04-clients-guest-cards-crud`
**Коммит**: `4a641a4` `feat(clients): manual guest CRUD, dedupe by E.164 phone`
**Дата**: 2026-05-04
**Reviewer**: Code Reviewer (claude-sonnet-4-6)

---

## Вердикт: NEEDS_CHANGES

Три блокирующих проблемы: (1) AC-11/AC-12 не реализованы — кнопка «Редактировать» и форма редактирования отсутствуют в `client-profile.tsx`; (2) rate limiting отсутствует на всех трёх новых endpoint'ах вопреки ADR §6; (3) тесты `createClientSchema` / `updateClientSchema` отсутствуют вопреки ADR §11 и CLAUDE.md (тест-план требует 5+ кейсов на новые Zod-схемы).

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1: `/admin/clients` существует, требует MANAGER/SUPERADMIN | PASS | Server component с `hasRole("MANAGER")` + redirect. |
| AC-2: Таблица USER с mergedIntoUserId=null, нужные колонки | PASS | `ClientsList` рендерит имя/телефон/email/брони/потрачено/последнюю активность. |
| AC-3: Поиск по имени/телефону/email, debounce | PASS | 300ms debounce, `GET /api/clients?search=…`. |
| AC-4: Пагинация по 50, Prev/Next | PASS | `totalPages` вычислен, кнопки навигации присутствуют. |
| AC-5: Клик по строке → `/admin/clients/[id]` | PASS | `router.push`. |
| AC-6: Кнопка «+ Создать гостя», форма с нужными полями | PASS | `ClientsList` → toggle `showForm` → `<ClientForm mode="create">`. |
| AC-7: Форма без телефона → клиентская ошибка, без запроса на сервер | PASS | `validate()` возвращает строку ошибки до `fetch`. |
| AC-8: Сервер 409 при дублирующем телефоне | PASS | `createClient` выбрасывает `CLIENT_PHONE_DUPLICATE`, route handler маппит в 409. |
| AC-9: После создания гость в списке без перезагрузки, форма закрывается | PASS | `onSuccess` → `router.push` на карточку нового гостя + `router.refresh()`. |
| AC-10: `role=USER`, `source="manual"`, AuditLog `client.create` | PASS | Подтверждено кодом сервиса и тестом. |
| AC-11: Кнопка «Редактировать» на карточке `/admin/clients/[id]` | **FAIL** | `client-profile.tsx` (558 строк) не содержит ни кнопки «Редактировать», ни `ClientForm`. ADR §10.4 явно требует добавить кнопку + edit-mode. |
| AC-12: PATCH сохраняет изменения, карточка обновляется без перехода | **FAIL** | API `PATCH /api/clients/:id` существует, но UI для его вызова (AC-11) не реализован. |
| AC-13: Телефон заблокирован при редактировании | PARTIAL | В `ClientForm` поле `disabled` при `mode="edit"` — корректно. Но AC-11 не реализовано, поэтому редактирование недоступно вовсе. |
| AC-14: AuditLog `client.update` с diff | PASS | `updateClient` пишет diff по полям, тест покрывает. |
| AC-15: `createAdminBooking` ищет по `phoneNormalized` | PASS | `upsertClientByPhone(clientPhone, …)` нормализует внутри, `findFirst` по `phoneNormalized`. |
| AC-16: Если не найден — создаёт User с `source="ps_park_booking"` | PASS | Реализовано в `upsertClientByPhone`. |
| AC-17: Если найден — не создаёт дубль | PASS | Optimistic find возвращает existing id. |
| AC-18: Без `clientPhone` → `userId=null`, без регрессии | PASS | Else-ветка создаёт анонимный User (сохранено старое поведение). |
| AC-19: Метрика (<10% броней с userId=null) | N/A | Бизнес-метрика, не верифицируется в ревью. |

**Итог AC**: 15/17 PASS, 2 FAIL (AC-11, AC-12).

---

## Scope Check

- Scope creep: Нет.
- Изменений схемы Booking нет — верно.
- Изменений в `gazebos`/`cafe`/`checkInBooking` нет — верно (PO Решение 7).
- Merge UI не добавлен — верно.
- Tags-input не в форме — верно (PO Решение 6).
- `client-profile.tsx` не изменён — что является **дефицитом реализации**, а не scope creep.

---

## Качество кода

- **TypeScript strict**: OK. `as unknown as Prisma.InputJsonValue` на строке 809 `service.ts` — допустимый двойной каст для JSON-колонки Prisma (паттерн используется в других сервисах проекта). Не `any`.
- **Zod валидация**: OK на API-слое. `createClientSchema` и `updateClientSchema` реализованы точно по ADR.
- **API формат**: OK. `apiResponse()` / `apiError()` везде.
- **AuditLog**: OK для `createClient` и `updateClient`. `upsertClientByPhone` не пишет лог — соответствует ADR §5.2.
- **Бизнес-логика в service.ts**: OK.

---

## Тесты

- **npm test**: 132 файла / 2102 тестов — зелёный.
- **service.test.ts**: 11 новых кейсов — соответствует ADR (6+ unit для service) — PASS.
- **validation.test.ts**: тесты для `createClientSchema` / `updateClientSchema` **отсутствуют**. Файл тестирует только `clientFilterSchema`, `mergeClientsSchema`, `mergePreviewSchema`. ADR §11 требовал 5+ кейсов: happy `+79991234567`, happy `8 (999) 123-45-67`, error без phone, error email `not-email`, error birthday `01.01.2000`. Это нарушение CLAUDE.md («Новая схема в `validation.ts` → тест в `__tests__/validation.test.ts`»).
- **API integration tests**: отсутствуют (нет `src/app/api/clients/__tests__/route.test.ts`). Developer задокументировал это в context-log как сознательное решение («тонкие обёртки, покрываются через unit service»). ADR §11 тем не менее явно требовал 6+ integration кейсов (GET без auth → 401, GET как USER → 403 и т.д.). Это нарушение ADR.
- **ps-park регрессионные тесты**: `createAdminBooking` с `upsertClientByPhone` **не покрыт** новыми кейсами. В `src/modules/ps-park/__tests__/service.test.ts` нет тестов на поведение createAdminBooking с разными форматами phone. ADR требовал минимум 3 регрессионных кейса.

**Итог тестов**: FAIL по 3 пунктам (validation schema unit, API integration, ps-park regression).

---

## Security

### Secrets leakage
- Grep по `password|token|secret|NEXTAUTH|TELEGRAM` в изменённых файлах: ничего не попадает в response или лог — **OK**.
- `existingClientId` в 409-ответе: публичный CUID, не internal secret — **допустимо** (ADR явно разрешает).

### RBAC
- `session.user.id` берётся из `auth()`, не из body — **OK**.
- `hasRole(session.user, "MANAGER")` проверяется ДО бизнес-логики на каждом из 4 endpoints — **OK**.
- `hasRole` использует числовую иерархию: USER=0, MANAGER=1, ADMIN=2, SUPERADMIN=3. `MANAGER` guard пропускает ADMIN и SUPERADMIN — **OK** (соответствует ADR §8).
- Страница `/admin/clients/page.tsx` имеет server-side `hasRole` guard — **OK**.

### Rate limiting
- ADR §6 явно предписывает: `POST /api/clients` → 30/мин, `PATCH` → 60/мин, `GET` → 120/мин.
- Ни на одном из трёх endpoint'ов `rateLimit()` не вызывается.
- `POST /api/clients` без rate limit — вектор для массового создания User-записей (DoS базы данных). **SECURITY ISSUE** — NEEDS_CHANGES.

### Injection
- Нет `$executeRawUnsafe`, нет raw SQL с user input — **OK**.
- `dangerouslySetInnerHTML` отсутствует в UI-компонентах — **OK**.
- Все query-параметры и body через Zod до Prisma — **OK**.

### Supply chain
- Новых зависимостей в `package.json` нет — **OK**.

---

## Что исправить

| # | Файл | Проблема | Приоритет |
|---|------|----------|-----------|
| 1 | `src/components/admin/clients/client-profile.tsx` | AC-11/AC-12 не реализованы: нет кнопки «Редактировать» и `<ClientForm mode="edit" initial={...} />`. По ADR §10.4 нужно добавить кнопку рядом с заголовком, при клике раскрывать `ClientForm` с текущими данными, после успешного PATCH делать `router.refresh()`. | Critical |
| 2 | `src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts` | Rate limiting отсутствует. Добавить `rateLimit(request, "authenticated")` из `src/lib/rate-limit.ts` для `GET` и `PATCH`; для `POST` — 30/мин (custom tier или `"authenticated"` если библиотека поддерживает). Паттерн см. `src/app/api/rental/send-email/route.ts`. | Critical (security) |
| 3 | `src/modules/clients/__tests__/validation.test.ts` | Отсутствуют тесты для `createClientSchema` и `updateClientSchema`. Добавить минимум 5 кейсов: happy `+79991234567`, happy `8 (999) 123-45-67`, error без phone (`min(1)`), error email `not-email`, error birthday `01.01.2000`. Также тест на `notes.length > 2000`. | High |
| 4 | `src/modules/ps-park/__tests__/service.test.ts` | Нет регрессионных тестов для обновлённого `createAdminBooking`. Добавить: (a) booking с `clientPhone="89991234567"` при существующем User по `+79991234567` → тот же `userId`; (b) booking без `clientPhone` → анонимный User (старое поведение); (c) booking с невалидным phone → `INVALID_PHONE`. Требует мока `upsertClientByPhone` из `@/modules/clients/service`. | High |
| 5 | `src/app/api/clients/__tests__/route.test.ts`, `src/app/api/clients/[id]/__tests__/route.test.ts` | API integration tests отсутствуют вопреки ADR §11. Добавить минимум: `GET` без auth → 401, `GET` как USER → 403, `GET` как MANAGER → 200; `POST` happy → 201, `POST` дубль → 409, `POST` без phone → 400; `PATCH` 404 при merged, `PATCH` happy → 200. | Medium |

---

## Что хорошо

- `upsertClientByPhone` с post-create reconciliation через `MergeCandidate` реализован точно по ADR §9: 11 строк post-create scan вместо сложного locking.
- `updateClient` с точечным diff — только изменённые поля попадают в `update`, нет лишних writes.
- 409 с `existingClientId` в metadata + ссылка в UI на карточку существующего гостя — хороший UX.
- Разделение `createClient` (явный 409) и `upsertClientByPhone` (idempotent) — корректная семантика.
- TypeScript чистый: `npx tsc --noEmit` — clean, `as unknown as Prisma.InputJsonValue` — допустимый паттерн.
- `createClientSchema` корректно не содержит поле `phone` в `updateClientSchema` — lock через Zod, а не только UI.
- Нет scope creep: Booking schema не тронута, gazebos/cafe/checkInBooking — не тронуты.
