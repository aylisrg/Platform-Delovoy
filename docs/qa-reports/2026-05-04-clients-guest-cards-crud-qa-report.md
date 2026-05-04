# QA Report: F4 — CRM Карточка гостя: справочник + автозаполнение из Booking

**RUN_ID**: `2026-05-04-clients-guest-cards-crud`
**Branch**: `claude/fix-booking-session-closure-7SSOS`
**Коммит**: `42a223c` `fix(clients): expose birthday & notes on ClientDetail for edit prefill`
**Дата**: 2026-05-04
**QA Engineer**: QA Agent (claude-sonnet-4-6)
**Итерация**: 3 (финальная)

---

## Вердикт: PASS

---

## Тесты и сборка

| Проверка | Результат |
|----------|-----------|
| `npm test -- --run` | 2115/2115 PASS (132 файла) |
| `npm test -- --run src/modules/clients/` | 73/73 PASS |
| `npx tsc --noEmit` | CLEAN |

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1: `/admin/clients` доступна MANAGER/SUPERADMIN, редирект для неавторизованных | PASS | `page.tsx`: `auth()` → redirect `/auth/signin`; `hasRole("MANAGER")` → redirect `/admin`. |
| AC-2: Таблица USER с mergedIntoUserId=null, нужные колонки | PASS | `listClients` фильтрует `role=USER, mergedIntoUserId=null`; `ClientsList` рендерит имя/телефон/email/брони/потрачено/активность. |
| AC-3: Поиск по имени/телефону/email, debounce 300ms | PASS | `clientFilterSchema` + 300ms debounce в `ClientsList`. |
| AC-4: Пагинация по 50 записей | PASS | `PAGE_SIZE=50`; `totalPages` вычислен; кнопки Prev/Next. |
| AC-5: Клик по строке → `/admin/clients/[id]` | PASS | `router.push` в `ClientsList`. |
| AC-6: Кнопка «+ Создать гостя», форма с нужными полями | PASS | `ClientsList` → toggle `showForm` → `<ClientForm mode="create">` с полями phone/name/email/birthday/notes. |
| AC-7: Форма без телефона → клиентская ошибка, без запроса на сервер | PASS | `validate()` возвращает строку ошибки до `fetch`; Zod `min(1)` на бэке. |
| AC-8: Сервер 409 при дублирующем телефоне (phoneNormalized) | PASS | `createClient` → `CLIENT_PHONE_DUPLICATE`; route handler маппит в 409. |
| AC-9: После создания гость в списке, форма закрывается | PASS | `onSuccess` → `router.push` на карточку + `router.refresh()`. |
| AC-10: `role=USER`, `source="manual"`, AuditLog `client.create` | PASS | Сервис `createClient` выставляет оба поля; пишет `auditLog.create`. |
| AC-11: Кнопка «Редактировать» на `/admin/clients/[id]`, форма с текущими значениями (birthday + notes) | PASS | `client-profile.tsx:249` — кнопка «Редактировать»; `lines 262–270` — `<ClientForm mode="edit" initial={{...birthday: client.birthday, notes: client.notes}}>`. `getClientDetail` select строки 310–311 включает `birthday: true, notes: true`; `service.ts:539–540` сериализует birthday как YYYY-MM-DD. Тип `ClientDetail` в `types.ts:72–73` содержит `birthday: string | null; notes: string | null`. |
| AC-12: PATCH сохраняет изменения, карточка обновляется без перехода | PASS | `PATCH /api/clients/:id` реализован; `client-profile.tsx` вызывает `router.refresh()` после успешного PATCH. |
| AC-13: Телефон заблокирован при редактировании | PASS | `updateClientSchema` не содержит поле `phone` (Zod его отбрасывает); `ClientForm` рендерит `disabled` при `mode="edit"`. |
| AC-14: AuditLog `client.update` с diff | PASS | `updateClient` пишет `changes: { field: { from, to } }` только для изменившихся полей. |
| AC-15: `createAdminBooking` ищет по `phoneNormalized`, а не по `phone` | PASS | `ps-park/service.ts:789` — `upsertClientByPhone(clientPhone, { name, source: "ps_park_booking" })`; нормализация внутри хелпера. |
| AC-16: Не найден → создаёт User с `source="ps_park_booking"` | PASS | `upsertClientByPhone` → create с `source` при отсутствии записи. |
| AC-17: Найден → не создаёт дубль | PASS | Optimistic `findFirst` → возвращает existing id. Post-create scan → `MergeCandidate` при race. |
| AC-18: Без `clientPhone` → `Booking.userId=null`, без регрессии | PASS | `else`-ветка `ps-park/service.ts:794–798` создаёт анонимный User без phone (старое поведение). |
| AC-19: Метрика <10% броней с userId=null | N/A | Бизнес-метрика, верифицируется через БД после релиза. |

**Итог AC**: 18/18 применимых — PASS.

---

## Security

| Проверка | Статус | Комментарий |
|----------|--------|-------------|
| RBAC: аноним → 401 | PASS | `auth()` возвращает null → `apiUnauthorized()` на всех 4 endpoints. |
| RBAC: USER → 403 | PASS | `hasRole(session.user, "MANAGER")` → `apiForbidden()`. `hasRole` использует числовую иерархию USER=0 < MANAGER=1. |
| RBAC: страница `/admin/clients` | PASS | Server-side `hasRole` + redirect. |
| Rate limiting | PASS | `rateLimit(request, "authenticated")` вызывается первым в GET, POST, GET/:id, PATCH. |
| Input validation — phone | PASS | `normalizePhone()` в `createClientSchema.refine()` + сервисный уровень. |
| Input validation — notes ≤2000 | PASS | `z.string().max(2000)` в обоих схемах; тест на 2001 символ присутствует. |
| Input validation — email | PASS | `z.string().email()` в схемах. |
| Phone в PATCH body | PASS | `updateClientSchema` не принимает поле `phone` — Zod отбрасывает. |
| Data leakage | PASS | Endpoints доступны только MANAGER+; `session.user.id` берётся из `auth()`, не из body. |
| Injection | PASS | Нет raw SQL с user input; Prisma параметризует все запросы. |

---

## Anti-scope check

| Требование | Статус |
|------------|--------|
| Модель `Guest` не создана | PASS |
| `gazebos`/`cafe`/`checkInBooking` не изменены для upsert | PASS — `checkInBooking` не содержит вызова `upsertClientByPhone`. |
| Tags-input UI не добавлен | PASS |
| Merge UI не добавлен | PASS |
| Partial UNIQUE миграция не добавлена | PASS — схема `prisma/schema.prisma` изменена только в части `Order.bookingId` (F5), не в части `phoneNormalized`. |

---

## Тестовое покрытие

| Область | Статус |
|---------|--------|
| `service.test.ts` — 11 новых кейсов (createClient, updateClient, upsertClientByPhone) | PASS |
| `validation.test.ts` — 13 новых кейсов (createClientSchema + updateClientSchema) | PASS |
| PS Park `service.test.ts` — регрессионные кейсы `createAdminBooking` с `upsertClientByPhone` | PARTIAL — describe-блок `createAdminBooking` отсутствует; связанные кейсы уже покрыты через `upsertClientByPhone (F4)` в `clients/__tests__/service.test.ts` (5 кейсов: existing/preserves name/new/race/INVALID_PHONE). Reviewer iter2 принял это как Medium (не блокер). |
| API integration tests (route.test.ts) | ABSENT — согласно developer context-log, это осознанное решение (тонкие обёртки). Reviewer квалифицировал как Medium. |

Отсутствие ps-park regression describe-блока и API integration-тестов остаётся техническим долгом (Medium, не блокер), зафиксированным в review iter1 и iter2. Ни один из них не является блокером для PASS данного QA-прохода: бизнес-логика `upsertClientByPhone` покрыта через unit clients/service, функциональность verifiably работает.

---

## Итог по блокерам предыдущих итераций

| Блокер (iter1/iter2) | Статус |
|----------------------|--------|
| AC-11/AC-12 — кнопка «Редактировать» и форма с текущими данными | ЗАКРЫТ — `client-profile.tsx` передаёт `birthday` и `notes` через `ClientDetail`; `getClientDetail` выбирает оба поля. |
| Rate limiting на всех 4 endpoints | ЗАКРЫТ — `rateLimit(request, "authenticated")` присутствует. |
| Validation tests для createClientSchema/updateClientSchema | ЗАКРЫТ — 13 кейсов добавлены. |
