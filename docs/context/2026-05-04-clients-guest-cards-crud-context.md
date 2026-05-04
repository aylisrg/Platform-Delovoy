# Context Log — 2026-05-04 — F4: Карточка гостя (CRM) — CRUD + autofill из Booking

> RUN_ID: `2026-05-04-clients-guest-cards-crud`
> Branch: `claude/fix-booking-session-closure-7SSOS` (общая для Wave 1)
> Wave 1 / 4 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Создать справочник гостей по аналогии с поставщиками: страница `/admin/clients` (список + поиск + фильтры), форма CRUD (имя, телефон, email, день рождения, теги, заметки), автоматический upsert User по `phoneNormalized` при `checkInBooking` (если у Booking есть `clientPhone`, но нет `userId`).

**Решение заказчика (через AskUserQuestion):** расширяем существующую `User` (role=USER) + `clients`-модуль, БЕЗ создания новой модели Guest.

## Scope

- `prisma/schema.prisma` — User: добавить поля `birthday DateTime?`, `tags String[]`, `notes String?` (если их нет).
- `src/modules/clients/service.ts` — `createClient`, `updateClient`, `upsertClientByPhone`.
- `src/modules/clients/validation.ts` — Zod-схемы.
- `src/app/admin/clients/page.tsx` — список + поиск.
- `src/app/api/clients/*` — CRUD endpoints.
- `src/components/admin/clients/client-form.tsx` — форма.
- `src/modules/ps-park/service.ts` — `checkInBooking` upsert по `phoneNormalized`.

## Out of scope

- Subscriptions (F6/F7), импорт/экспорт, merge дубликатов (отдельный feature, не требуется заказчиком).

## Stages

- [x] PO — PRD
- [x] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

---

## PO — Ключевые решения

**Автор**: PO Agent (claude-sonnet-4-6)  
**Дата**: 2026-05-04

### Решение 1: Не создаём новую модель Guest

Зафиксировано заказчиком явно. Карточка гостя = запись `User` с `role=USER`. Расширяем существующий модуль `clients`, а не создаём новый. Страница `/admin/clients/[id]` уже работает — нужно только добавить список `/admin/clients` и CRUD API.

Обоснование: модель `User` уже содержит все нужные поля (`birthday`, `tags`, `notes`, `phoneNormalized`, `source`). Введение отдельной модели `Guest` дублировало бы данные и сломало бы существующий `Booking.userId → User` FK.

### Решение 2: Скоуп auto-upsert ограничен Плей Парком

Auto-upsert при создании брони — только `ps-park` (`createAdminBooking`). Аналогичная логика для `gazebos` — отдельный тикет. Причина: избегаем scope creep, изменения точечные и покрываются тестами.

Важная находка из кода: `createAdminBooking` в ps-park уже пытается делать upsert, но использует сырое поле `phone` вместо `phoneNormalized` (строки 783–804 service.ts). Это источник дублей при разных форматах телефона. Исправление входит в данный тикет.

### Решение 3: phone — обязательный для ручного создания гостя

Телефон — единственный надёжный идентификатор для дедупликации (email необязателен, имя не уникально, Telegram не всегда есть). При ручном создании карточки через форму телефон обязателен. Email — опциональный.

При редактировании существующей карточки телефон заблокирован для изменения через UI: смена телефона — операция мерджа (реализован через `mergeClients`, вне скоупа).

### Решение 4: source фиксирует происхождение гостя

- Ручное создание через форму → `source="manual"`
- Создание через бронирование Плей Парка → `source="ps_park_booking"`
- Уже существующие значения из кода: `"telegram_bot"`, `"vk_id"`, `"email"`, `"import"`, `"legacy"` — не трогаем

Это позволит аналитике (Phase 5.3) считать, сколько гостей пришло через каждый канал.

### Решение 5: MoSCoW — Must have для всего скоупа

Без списка гостей и без исправления дедупликации по телефону нельзя запускать Phase 5.1 (программа лояльности), а аналитика по гостям недостоверна.

### Решение 6: Теги — не в форме создания/редактирования этого тикета

Поле `User.tags` (String[]) уже есть в схеме. UI для тегов (chip-input, автодополнение) — отдельная итерация. В данном тикете теги можно только читать в карточке. Scope не расширяем.

### Решение 7: Scope checkInBooking — НЕ входит в этот тикет

По итогам анализа кода: `checkInBooking` в ps-park (строки 884+) — это переход CONFIRMED → CHECKED_IN. Телефон гостя уже должен быть привязан на этапе `createAdminBooking`. Добавлять upsert в `checkInBooking` избыточно и создаёт риски (двойной upsert). Исходное требование задачи об upsert «при checkInBooking» пересмотрено: upsert делаем только в `createAdminBooking`, где телефон впервые появляется в системе.

---

## Что изучено при подготовке PRD

- `prisma/schema.prisma` строки 13–76: User содержит все нужные поля (birthday, tags, notes, phoneNormalized, source). Миграция потребуется только если Architect добавит partial UNIQUE на phoneNormalized (сейчас — только index).
- `src/modules/clients/service.ts`: `listClients()` поддерживает search/limit/offset — достаточно для списка. `getClientDetail()` полный — страница карточки работает.
- `src/modules/ps-park/service.ts` строки 783–804: `createAdminBooking` уже делает findFirst по `phone` и create/update User — логика правильная, но использует сырое `phone` вместо `phoneNormalized`. Исправление точечное.
- `src/app/api/clients/` — директория не существует. API создаётся с нуля.
- `src/app/admin/clients/` — директория существует (есть `[id]/page.tsx`), но нет `page.tsx` для списка.
- `src/components/admin/inventory/suppliers-list.tsx` — образец для UI: inline-форма создания/редактирования поверх таблицы.

---

## Open Questions для Architect

1. **phoneNormalized — partial UNIQUE сейчас?** В схеме есть `@@index([phoneNormalized])` и комментарий о partial unique, но нет явной аннотации `@@unique`. Нужно ли добавить partial UNIQUE constraint для защиты от конкурентного создания дублей?

2. **Алгоритм нормализации телефона**: какая функция `normalizePhone` уже используется? Покрывает ли она форматы `+7`, `8`, `007`, пробелы и дефисы? Уточнить перед изменением `createAdminBooking`.

3. **`ClientNote` — отдельная модель или строковое поле?** Для audit trail заметок (автор, время, текст) нужна отдельная модель. Для данного тикета достаточно строкового `User.notes`?

4. **`GET /api/clients` — route handler существует?** Директория `src/app/api/clients/` отсутствует при проверке. Developer создаёт с нуля.

---

## Architect — Ключевые решения

**Автор**: Architect Agent
**Дата**: 2026-05-04
**ADR**: `docs/architecture/2026-05-04-clients-guest-cards-crud-adr.md`

### Закрытие Open Questions

| # | Вопрос | Решение |
|---|---|---|
| Q1 | partial UNIQUE на `phoneNormalized` | **НЕ добавляем в этом тикете.** В production уже могут быть дубли — миграция упадёт. Защита — на app-уровне (см. Q4 ниже). UNIQUE + dedup-скрипт = отдельная op-задача, отдельный PR (Scope guard #3). |
| Q2 | алгоритм `normalizePhone` | **Существует**: `src/lib/phone.ts`. Покрывает все форматы из требований (`+7`, `8`, `7`, 10-значные, мусорные символы). Канонизирует в `+7XXXXXXXXXX`. Переиспользуем без изменений. |
| Q3 | `ClientNote` модель | **НЕ создаём.** Используем `User.notes` (String). Timeline заметок — future-PRD. Минимизируем миграции. |
| Q4 | API `src/app/api/clients/` | **Создаём с нуля**: `route.ts` (GET/POST), `[id]/route.ts` (GET/PATCH). Без DELETE. |

### Ключевые архитектурные решения

1. **Без миграций Prisma.** Все нужные поля уже в `User`. Нет новых моделей. Нет UNIQUE constraint.
2. **Race-condition в `upsertClientByPhone`** — стратегия optimistic find + create + post-create reconciliation через `MergeCandidate` (см. ADR §9). Без UNIQUE — без unique-violation. Победитель — старший по `createdAt asc`, дубли регистрируются для merge через `/admin/users/duplicates`.
3. **`createClient` (ручное) → 409 при существующем active phone**, не upsert. Явная семантика create-only API. `upsertClientByPhone` — внутренний хелпер только для авто-привязки из Booking.
4. **RBAC: `hasRole(user, "MANAGER")` напрямую**, БЕЗ добавления `clients` в `ADMIN_SECTIONS`. CRM — сквозная секция, доступна всем менеджерам без явного `AdminPermission`. ADMIN/SUPERADMIN получают доступ автоматически через иерархию.
5. **Rate limit**: GET 120/мин, PATCH 60/мин, POST 30/мин per user (защита от массового создания).
6. **Изменение в `ps-park/createAdminBooking`** — точечная замена строк 783–804: `findFirst({ phone })` → `upsertClientByPhone(normalized, { source: "ps_park_booking" })`. Upsert User вынесен ИЗ booking-транзакции (допустимая «сирота-карточка» при сбое booking).
7. **`source` в upsert обновляется только если был null** — не перезаписываем существующий канал происхождения. `name` — аналогично (PO мог отредактировать).
8. **Tags** — поле в Zod есть (на будущее), но **не в UI форме** (PO Решение 6).

### Что НЕ делаем (anti-scope)

- Partial UNIQUE миграция, dedup-скрипт по существующим дублям → op-задача.
- Merge UI, изменения `mergeClients` → отдельный feature.
- Tags-input UI, `ClientNote` модель → future-PRDs.
- Upsert в `gazebos`/`cafe`/`checkInBooking` → PO Решение 7.
- Изменения схемы `Booking`.
- DELETE endpoint.

### Чеклист передачи Developer

- ADR: `docs/architecture/2026-05-04-clients-guest-cards-crud-adr.md`
- Схема БД: без изменений
- API-контракты: 4 endpoints (GET list, POST, GET detail, PATCH)
- Zod-схемы: `createClientSchema`, `updateClientSchema`
- Test plan: 6+ unit (service), 5+ unit (validation), 6+ integration (API), 3+ regression (ps-park)
- Декомпозиция файлов — см. ADR §13
