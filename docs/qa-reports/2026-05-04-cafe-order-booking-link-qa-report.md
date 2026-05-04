# QA Report: F5 — Cafe Order ↔ Booking link

> RUN_ID: `2026-05-04-cafe-order-booking-link`
> Branch: `claude/fix-booking-session-closure-7SSOS`
> Commit: `1ea64d0 feat(cafe): link Order to Booking via optional FK + admin UI button`
> QA Engineer: claude-sonnet-4-6
> Date: 2026-05-04

---

## Вердикт: PASS

---

## Тест-прогоны

| Команда | Результат |
|---------|-----------|
| `npm test -- src/modules/cafe/` | 2 файла / **40 тестов** — все зелёные |
| `npm test -- --run` (full suite) | 132 файла / **2115 тестов** — все зелёные |
| `npx tsc --noEmit` | **Чисто** — ни одной ошибки типов |

---

## AC-чеклист

| AC | Проверка | Статус |
|----|----------|--------|
| AC-1.1: `Order.bookingId String?` + `@@index([bookingId])` + FK `onDelete: SetNull` | `prisma/schema.prisma` строки 305-317: поле `String?`, relation `"OrderBooking"` с `onDelete: SetNull`, `@@index([bookingId])`. Миграция `20260504120000`: `ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT` + `CREATE INDEX` + `ADD CONSTRAINT … ON DELETE SET NULL ON UPDATE CASCADE`. `Booking` получает `orders Order[] @relation("OrderBooking")`. | PASS |
| AC-1.2: `createOrder` с несуществующим `bookingId` → `BOOKING_NOT_FOUND`; без `bookingId` → без изменений | `service.ts:79-87`: `prisma.booking.findUnique` без фильтра по `deletedAt`/статусу (PO Решения №4, №5). Cheap rejection до запроса меню. `...(bookingId && { bookingId })` при `undefined` ничего не передаёт. | PASS |
| AC-1.3: POST `/api/cafe/order` принимает `bookingId?: cuid`; 404 при `BOOKING_NOT_FOUND`; 400 при невалидном Zod | `validation.ts:25`: `z.string().cuid("bookingId должен быть валидным CUID").optional()`. `route.ts:39-40`: `error.code === "BOOKING_NOT_FOUND" ? 404 : 400`. | PASS |
| AC-1.4: `CafeOrderButton` интегрирован в `active-session-card.tsx` | `active-session-card.tsx:161`: `<CafeOrderButton bookingId={session.bookingId} onCreated={onUpdate} />`. `cafe-order-button.tsx`: 231 строка, модальное окно с `GET /api/cafe` + qty-stepper + `POST /api/cafe/order { items, bookingId }`. `bookingId` передаётся автоматически из prop, менеджер не вводит вручную. | PASS |
| AC-1.5: Существующие вызовы без `bookingId` работают без изменений | Тест `"creates order without bookingId — does not query Booking"` подтверждает: `prisma.booking.findUnique` не вызывается, `bookingId` не попадает в `order.create`. Полный suite 2115 тестов — зелёный. | PASS |
| AC-1.6: 4 unit-теста в `__tests__/service.test.ts` | (a) без `bookingId` → `bookingId` отсутствует в data; (b) с валидным `bookingId` → проверяет Booking и линкует; (c) несуществующий `bookingId` → `BOOKING_NOT_FOUND`, меню и `order.create` НЕ вызваны; (d) soft-deleted Booking → разрешён (PO Решение №5). Все 4 теста проходят. `prisma.booking` добавлен в vi.mock. | PASS |
| AC-2.1: POST без `bookingId` → 201, `bookingId: null` | Подтверждено тестом и spreading-логикой в `service.ts:120`. | PASS |
| AC-2.2: Историческая миграция NULLable — существующие строки нетронуты | `ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT` без `DEFAULT` и без `NOT NULL` — все исторические строки получают `NULL` автоматически. | PASS |

**Итого: 8/8 AC — PASS**

---

## Anti-scope

F5-коммит `1ea64d0` затрагивает ровно **9 файлов**: migration.sql, schema.prisma, route.ts, active-session-card.tsx (2 строки), cafe-order-button.tsx, service.test.ts, service.ts, types.ts, validation.ts. Нет изменений в:
- меню, корзине, ценообразовании cafe
- auth/RBAC логике
- rate-limit на существующем endpoint
- модулях gazebos, rental, ps-park service
- UI drill-down (F7 — вне скоупа)

**Anti-scope: PASS**

---

## Security

| Кейс | Результат |
|------|-----------|
| Secrets leakage: grep на `password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key` по всем F5-файлам | Нет совпадений — **PASS** |
| RBAC: `userId` из `session.user.id`, не из body (`route.ts:19-20`) | **PASS** |
| Аутентификация: `if (!session?.user?.id) return apiUnauthorized()` — первая проверка | **PASS** |
| Injection: нет `$executeRawUnsafe`, нет raw SQL с user input | **PASS** |
| `bookingId` Zod cuid-валидация до БД | **PASS** |
| ON DELETE SET NULL: финансовый документ (Order) не теряется при удалении Booking | **PASS** |
| `AuditLog`: `bookingId` записывается в metadata при создании заказа (`route.ts:30-34`) | **PASS** |

**Security: все кейсы PASS**

---

## Migration safety

Миграция является safe для production:
- `ADD COLUMN "bookingId" TEXT` — NULLable, без DEFAULT, без NOT NULL → instant DDL в Postgres 16
- FK добавляется на пустую колонку (все значения NULL) → проверка FK не касается исторических строк
- `ON DELETE SET NULL` — при hard-delete Booking Order сохраняется как финансовый документ с `bookingId = null`
- Обратный путь: DROP COLUMN + DROP CONSTRAINT — полностью обратимо

---

## Edge cases

| Сценарий | Ожидание | Факт |
|----------|----------|------|
| `bookingId` — невалидный cuid (не CUID-формат) | 400 + Zod error | Zod `z.string().cuid()` отклоняет до БД |
| `bookingId` — несуществующий CUID | 404 + `BOOKING_NOT_FOUND` | `service.ts:84-86` + `route.ts:39` |
| `bookingId` — soft-deleted Booking | Разрешено (PO Решение №5) | Тест (d) подтверждает |
| Без `bookingId` | 201, `bookingId: null` | Тест (a) + backward compat |
| `items` — пустой массив | 400 (Zod `min(1)`) | Существующая валидация |
