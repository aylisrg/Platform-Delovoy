# Context Log — 2026-05-04 — F5: Cafe Order ↔ Booking link

> RUN_ID: `2026-05-04-cafe-order-booking-link`
> Branch: `claude/fix-booking-session-closure-7SSOS` (общая для Wave 1)
> Wave 1 / 4 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Backend-миграция и связь: добавить `Order.bookingId String?` (опциональный FK), индекс. API `/api/cafe/orders` принимает опциональный `bookingId`. При создании заказа из активной PS-сессии (`add-items-button.tsx` уже есть) — `bookingId` передаётся автоматически. Цель — фундамент для F7 drill-down «что ел гость во время игры».

## Scope

- `prisma/schema.prisma` — `Order.bookingId String?` + index (миграция).
- `src/modules/cafe/service.ts` — `createOrder` принимает `bookingId`.
- `src/modules/cafe/validation.ts` — Zod-схема.
- `src/app/api/cafe/orders/route.ts` (POST) — пробрасывает `bookingId`.
- `src/components/admin/ps-park/add-items-button.tsx` — передаёт `bookingId` если открыта в контексте сессии.
- Тесты unit на `createOrder`.

## Out of scope

- Backfill исторических заказов (заказчик не просил).
- UI drill-down (F7).
- Изменения в menu/cart, самообслуживание.

## Stages

- [x] PO — PRD
- [x] Architect — ADR
- [x] Developer — implementation
- [x] Reviewer — audit
- [ ] QA — verify

---

## PO — Ключевые решения

> Автор: Product Owner (claude-sonnet-4-6)
> Дата: 2026-05-04

### 1. Приоритет: Must Have

F5 — фундаментальная миграция данных. Каждый кафе-заказ, созданный в контексте сессии без `bookingId`, теряет аналитическую привязку навсегда. Backfill технически невозможен. Поэтому задача решается до запуска F7, без возможности откладывания.

### 2. Поле `bookingId` — nullable, не обязательное

Кафе существует независимо от PS Park. Подавляющее большинство заказов (доставка в офис, обед без сессии) не имеют игровой сессии. Делать поле обязательным означало бы сломать текущий workflow. Решение: `bookingId String?` с `@default(null)`, миграция NULLable, обратная совместимость полная.

### 3. ON DELETE: SetNull, не Restrict и не Cascade

Если бронирование будет мягко или жёстко удалено — заказ должен остаться. Заказ — финансовый документ, его нельзя каскадно удалять. `SetNull` сохраняет заказ, разрывает связь с удалённой бронью. Это приемлемо для аналитики (F7 отобразит заказ как "сессия удалена").

### 4. Валидация статуса Booking — НЕ вводится

Намеренное решение: не ограничивать статус Booking (`PENDING`/`CONFIRMED`/`COMPLETED`/`CANCELLED`) при привязке заказа. Причина: менеджер часто создаёт или доначисляет заказ уже после завершения сессии (закрывает чек, обнаруживает добавленный кофе). Запрет создания заказа к завершённой сессии создаст операционную проблему. Проверять существование Booking — да, проверять его статус — нет.

### 5. Soft-deleted Booking — разрешить привязку

`Booking.deletedAt IS NOT NULL` — мягко удалённая бронь. Привязка заказа к ней разрешена. Причина: порядок операций непредсказуем, менеджер может сначала закрыть сессию (что ведёт к soft-delete), потом обнаружить незачтённый заказ. Запрет привязки к удалённой брони создаст тупик без возможности исправить чек.

### 6. UI: отдельный компонент, не расширение `add-items-button.tsx`

`add-items-button.tsx` — inventory-операция (списание склада через `/api/ps-park/bookings/{id}/add-items`). Кафе-заказ — другая бизнес-операция (через `/api/cafe/orders`), другой API, другая модель. Смешивать их в одном компоненте нарушает принцип Domain Modules. Решение: новый компонент `CafeOrderButton` (или `CreateCafeOrderModal`) — конкретное имя на усмотрение Architect. Оба компонента получают `bookingId` из контекста сессии.

### 7. Zod: `z.string().cuid()`, не `z.string()`

`bookingId` — это CUID, генерируемый Prisma. Ограничение формата на уровне API защищает от случайного передачи произвольной строки и возврата менее информативной ошибки из БД. Если Architect считает `.cuid()` избыточным (например, в тестах используются не-CUID заглушки) — можно опустить до `z.string().min(1)`, но причину нужно зафиксировать в ADR.

### 8. Что НЕ делаем в этом тикете

- Никакого backfill — исторические заказы остаются с `bookingId: null` навсегда.
- Никакого drill-down UI — это F7.
- Никаких изменений в кафе-меню, корзине, ценах.
- Никаких изменений в модуле газебо (беседки) — `bookingId` технически работает для любого `moduleSlug`, но UI не добавляем.
- Никаких подписок и уведомлений, связанных с привязкой заказа к сессии.

---

## Чеклист PO перед передачей Architect

- [x] Проблема описана и понятна без дополнительного контекста
- [x] Целевая аудитория (персона) определена — MANAGER PS Park
- [x] Все user stories содержат роль, действие и ценность
- [x] У каждой story есть проверяемые acceptance criteria (6 AC в US-1, 2 AC в US-2)
- [x] Приоритет обоснован по MoSCoW — Must Have, обосновано потерей аналитики навсегда
- [x] Метрики успеха определены — доля заказов с bookingId, регрессия 5xx, покрытие тестами
- [x] Секция "Вне скоупа" заполнена — 6 пунктов
- [x] Проверено, что функционал не дублирует существующий — поле `bookingId` в `Order` отсутствует (подтверждено чтением schema.prisma строки 299-314)
- [x] Открытые вопросы для Architect зафиксированы — 3 вопроса в конце PRD
- [x] Все решения PO зафиксированы (пп. 1-8 выше)

## Артефакты

- PRD: `docs/requirements/2026-05-04-cafe-order-booking-link-prd.md`
- Контекст: `docs/context/2026-05-04-cafe-order-booking-link-context.md` (этот файл)
- ADR: `docs/architecture/2026-05-04-cafe-order-booking-link-adr.md`

---

## Architect — Ключевые решения

> Автор: System Architect (claude-opus-4-7)
> Дата: 2026-05-04

### 1. Двусторонняя relation `Order ↔ Booking` с явным именем

`booking Booking? @relation("OrderBooking", fields: [bookingId], references: [id], onDelete: SetNull)` в `Order`, обратная `orders Order[] @relation("OrderBooking")` в `Booking`. Имя `OrderBooking` явно — защита от будущих конфликтов FK (если когда-нибудь добавится вторая связь Order↔Booking, например `paymentBookingId`). Стоимость двусторонней relation — нулевая, выгода для F7 (drill-down) — реальная: `prisma.booking.findUnique({ include: { orders: true } })` без ручных join.

### 2. POST handler уже существует — НЕ дублируем

PO искал в `src/app/api/cafe/orders/route.ts` (plural) — там только GET. POST живёт в `src/app/api/cafe/order/route.ts` (singular). Это исторический разнобой именования, **в F5 не трогаем** (вне scope). Расширяем существующий POST на `/api/cafe/order`. UI вызывает `POST /api/cafe/order`.

### 3. Error mapping: `BOOKING_NOT_FOUND` → HTTP 404

PO в PRD дал «404 (или 422?)». Решение — **404**. Семантика: «ресурс, на который ссылается запрос, не существует». 422 строго за валидацией формата (Zod). В handler нужен conditional mapping:
```ts
const status = error.code === "BOOKING_NOT_FOUND" ? 404 : 400;
return apiError(error.code, error.message, status);
```

### 4. UI компонент — `CafeOrderButton` рядом с `AddItemsButton`

Файл: `src/components/admin/ps-park/cafe-order-button.tsx`. НЕ в `src/components/admin/cafe/` — компонент специфичен для контекста PS-сессии (требует `bookingId` обязательно как prop). Кафе-админка использует свои workflow без `bookingId`. Логика — fetch меню → modal с qty-stepper → POST `/api/cafe/order`. Не переиспользуем публичную корзину (`/cafe`) — там localStorage, мобильная вёрстка, лишняя сложность для админского flow.

### 5. Валидация `z.string().cuid()` подтверждена

Защита от мусорных строк до удара в БД. В unit-тестах сервиса проблем нет (мокаем `prisma.booking.findUnique` напрямую, минуя Zod). В integration-тестах route handler — используем валидные CUID-подобные строки или генерируем через `cuid()`.

### 6. Проверка существования Booking — `findUnique` без фильтра по `deletedAt`

Согласно PO решениям №4 и №5: статус и soft-delete не блокируют привязку. `prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } })` — минимальный select для производительности. Проверка ДО запросов меню — экономит круг к БД при невалидном `bookingId`.

### 7. RBAC: без изменений

POST `/api/cafe/order` — авторизованный endpoint без модульных ограничений (USER создаёт свой заказ, MANAGER PS Park — для гостя сессии). `hasModuleAccess` НЕ требуется. Rate limiting на этот endpoint сейчас не настроен — добавление вне scope F5 (PO не запрашивал, регрессии не вводим).

### 8. Audit log — добавить `bookingId` в metadata

Существующий `logAudit(userId, "order.create", "Order", order.id, {...})` расширяем `bookingId: parsed.data.bookingId ?? null` для traceability. Это минимальное изменение, помогает в дальнейшем дебаге привязок.

### 9. Миграция безопасна для prod

`ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT` (NULLable) + FK на пустую колонку = instant в Postgres. Никаких table scan, locks, downtime. Rollback: `git revert` + `prisma migrate resolve --rolled-back add_order_booking_id` (+ ручной DROP, если миграция уже в prod).

### 10. Анти-scope подтверждение

В ADR явно зафиксировано 8 пунктов «не делаем»: subscriptions, F7 UI, изменения меню/корзины, backfill, gazebos UI, Telegram-flow, rate limiting, валидация статуса/deletedAt. Если Developer сталкивается с искушением расширить scope — stop, открыть отдельный issue.

## Чеклист Architect перед передачей Developer

- [x] ADR написан и зафиксирован (`docs/architecture/2026-05-04-cafe-order-booking-link-adr.md`)
- [x] Схема данных описана (Prisma diff: `Order.bookingId` + relation, обратная `Booking.orders`, индекс)
- [x] API-контракты определены (POST `/api/cafe/order`, request/response, error codes, status mapping)
- [x] Zod-схема размечена (`bookingId: z.string().cuid().optional()`)
- [x] Миграция данных описана (имя, SQL, prod-safety, rollback)
- [x] RBAC описан (USER/MANAGER/SUPERADMIN, без `hasModuleAccess`, без нового rate limit)
- [x] Влияние на существующие модули оценено (cafe, ps-park, booking, notifications)
- [x] Все 3 open questions PO закрыты решениями 1, 2/3, 4

---

## Reviewer — Вердикт

> Автор: Code Reviewer (claude-sonnet-4-6)
> Дата: 2026-05-04

**PASS**

Все 8 AC реализованы без отклонений. Scope строго соблюдён: F5-коммит трогает ровно 9 файлов, все изменения в `active-session-card.tsx` из F5 сводятся к двум строкам (import + рендер `CafeOrderButton`). 132 файла / 2102 теста — зелёные.

Ключевые проверки:
- Prisma schema: `Order.bookingId String?` + `@@index([bookingId])` + `onDelete: SetNull` + обратная relation `Booking.orders Order[] @relation("OrderBooking")` — полное соответствие ADR Вариант A.
- Migration SQL: NULLable ADD COLUMN + INDEX + FK SET NULL — prod-safe, instant.
- Service: `findUnique` без `deletedAt`/статус-фильтра (PO Решения №4, №5), cheap rejection ДО меню-запроса.
- API: 404 для `BOOKING_NOT_FOUND`, 400 для прочих `OrderError`, 422 для Zod (через `apiValidationError`).
- Security: нет утечек секретов, RBAC не ослаблен, нет injection, нет новых прямых зависимостей.
- 4 unit-теста покрывают все ветки (без bookingId, с валидным, с несуществующим, с soft-deleted).

Отчёт: `docs/qa-reports/2026-05-04-cafe-order-booking-link-review.md`
