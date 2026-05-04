# Review: F5 — Cafe Order ↔ Booking link

> RUN_ID: `2026-05-04-cafe-order-booking-link`
> Branch: `claude/fix-booking-session-closure-7SSOS`
> Commit: `1ea64d0 feat(cafe): link Order to Booking via optional FK + admin UI button`
> Reviewer: claude-sonnet-4-6
> Date: 2026-05-04

---

## Вердикт: PASS

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1.1: `Order.bookingId String?` + `@@index([bookingId])` + FK `onDelete: SetNull` | PASS | `prisma/schema.prisma`: поле добавлено, индекс `@@index([bookingId])` добавлен, relation `onDelete: SetNull` с именем `OrderBooking`. Миграция SQL: `ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT` + `CREATE INDEX` + `ADD CONSTRAINT … ON DELETE SET NULL ON UPDATE CASCADE`. |
| AC-1.2: `createOrder` с `bookingId` → `BOOKING_NOT_FOUND` при отсутствии; без `bookingId` → без изменений | PASS | `service.ts:79-87`: проверка через `prisma.booking.findUnique` без фильтра по `deletedAt`/статусу (PO Решения №4, №5). Ошибка `OrderError("BOOKING_NOT_FOUND", ...)` выбрасывается до запросов меню (cheap rejection). |
| AC-1.3: POST `/api/cafe/order` принимает `bookingId?: cuid`; 404 при `BOOKING_NOT_FOUND`; 400 при невалидном формате (Zod 422) | PASS | `validation.ts:25`: `z.string().cuid(...).optional()`. `route.ts:39-40`: `error.code === "BOOKING_NOT_FOUND" ? 404 : 400`. |
| AC-1.4: `CafeOrderButton` рядом с `AddItemsButton` в карточке сессии | PASS | `cafe-order-button.tsx` (231 строк): модальное окно с `GET /api/cafe` + qty-stepper + `POST /api/cafe/order { items, bookingId }`. В `active-session-card.tsx:161`: `<CafeOrderButton bookingId={session.bookingId} onCreated={onUpdate} />`. |
| AC-1.5: Все существующие вызовы `createOrder` без `bookingId` работают | PASS | `service.ts:120`: `...(bookingId && { bookingId })` — при `undefined` не передаётся. Существующие тесты не затронуты (2102 тестов пройдено). |
| AC-1.6: 4 unit-теста в `__tests__/service.test.ts` (без bookingId / с валидным / с несуществующим / с soft-deleted) | PASS | Все 4 теста реализованы и проходят. |
| AC-2.1: POST без `bookingId` → 201, `bookingId: null` | PASS | Backward compat подтверждён тестами и логикой spreading. |
| AC-2.2: Исторические строки `Order` нетронуты (NULLable migration) | PASS | `ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT` без `DEFAULT` и без `NOT NULL` — все существующие строки получают `NULL`. |

---

## Scope Check

- Scope creep: Нет
- Лишние изменения в F5-коммите: отсутствуют. Коммит трогает ровно 9 файлов: миграция SQL, schema.prisma, route.ts, active-session-card.tsx (2 строки: import + рендер), cafe-order-button.tsx (новый), service.test.ts, service.ts, types.ts, validation.ts. Изменения в `active-session-card.tsx` вне scope F5 (red card state) принадлежат предыдущему коммиту `f90d465` (F2) и в F5-коммите не фигурируют.
- `formatOverrun` и `STATE_STYLES` — часть F2, не F5 коммита. Проверено через `git show 1ea64d0 -- src/components/admin/ps-park/active-session-card.tsx`.

---

## Архитектура

- Бизнес-логика в `service.ts`: OK. Проверка `bookingId` перед меню-запросом в сервисе, не в route handler.
- Route handler: парсит через Zod → вызывает сервис → возвращает ответ. Логика error mapping (`BOOKING_NOT_FOUND → 404`) — корректно в handler (presentation concern).
- Двусторонняя relation `OrderBooking`: `Order.booking Booking?` + `Booking.orders Order[]` — соответствует ADR Вариант A.
- API path: `POST /api/cafe/order` (singular, существующий endpoint) — правильно, без дублей.
- `userId` берётся из `session.user.id`, не из body (`route.ts:19-20`).

---

## Качество кода

- TypeScript strict: OK. Нет `any`, нет `@ts-ignore`. Единственная `(i: MenuItem)` в `.filter()` — inline аннотация на локальный тип, не escape-хatch.
- Zod валидация: OK. `bookingId: z.string().cuid("bookingId должен быть валидным CUID").optional()`.
- API формат: OK. `apiResponse`, `apiError`, `apiValidationError`, `apiUnauthorized`, `apiServerError` — всё через хелперы.
- AuditLog: OK. `logAudit` вызывается с `bookingId: parsed.data.bookingId ?? null` в metadata (`route.ts:30-34`).
- Нет хардкода секретов: OK.
- Тесты: OK. 4 новых unit-теста, все проходят. `prisma.booking.findUnique` добавлен в mock. 132 файла / 2102 теста — зелёные.

---

## Security

**Secrets leakage:** `grep` по изменённым файлам на `password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key` — совпадений нет. Чисто.

**RBAC:** Endpoint `POST /api/cafe/order` — существующий, авторизованный. `session.user.id` проверяется первым (`route.ts:19-20`). RBAC не ослаблен и не изменён. Согласно ADR §7 и PRD: endpoint доступен USER/MANAGER/SUPERADMIN (любой авторизованный может создать заказ кафе). `hasModuleAccess` не требуется — это сознательное решение PO/Architect (не модульная операция, а клиентская).

**Injection:** Нет `$executeRawUnsafe`, нет raw SQL с пользовательским input, нет `dangerouslySetInnerHTML`. Данные из пользовательского input (item names, prices) рендерятся через React без innerHTML.

**Supply chain:** `package.json` не изменён. Изменения в `package-lock.json` — транзитивные peer/optional зависимости (`@prisma/config` → `magicast`, `vite-tsconfig-paths` → `typescript`) без добавления новых прямых зависимостей.

**Dangerous ops:** Миграция только добавляет NULLable колонку — нет DROP, нет потери данных.

---

## Что хорошо

- Cheap rejection: проверка `bookingId` до запросов меню экономит круг к БД при невалидном запросе. Правильная реализация ADR §6.
- 4-й тест на soft-deleted Booking явно документирует PO Решение №5 — ценно для будущих разработчиков.
- `CafeOrderButton` изолирован в `src/components/admin/ps-park/` — не в `admin/cafe/`, что семантически точно (компонент специфичен для контекста PS-сессии, требует обязательный `bookingId`).
- `cancelled` флаг в `useEffect` fetch — корректная защита от race condition при быстром открытии/закрытии модала.
- Relation name `"OrderBooking"` явное — защита от конфликтов при добавлении будущих FK Order↔Booking.
- Нет изменений в menu, корзине, ценообразовании, gazebos, rate-limit — scope строго соблюдён.
