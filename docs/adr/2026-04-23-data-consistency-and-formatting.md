# ADR 2026-04-23: Data Consistency & Formatting Standards

## Статус
Принято (2026-04-23)

## Контекст

Владелец обнаружил три симптома, которые на первый взгляд не связаны, но имеют общую корневую причину — **отсутствие единых контрактов мутаций и отображения**:

1. **Форматы дат/времени не унифицированы.** В разных частях продукта (публичный фронт, админка, письма, Telegram-бот, экспорт) одна и та же дата выглядит по-разному: `dd.MM.yyyy`, `yyyy-MM-dd`, `MM/dd/yyyy`, `15 апр. 2026 г.`, время то с AM/PM, то без, разные таймзоны. Это путает клиентов, мешает парсингу экспорта и ломает ощущение цельного продукта.
2. **PS Park: удаление брони возвращается.** SUPERADMIN нажимает «удалить» в админке — бронь пропадает со страницы, но после перезагрузки возвращается и продолжает учитываться в аналитике.
3. **Склад: правка прихода не меняет остатки.** В ветке `fix/inventory-save-dates-stocks` частично починено, но системной гарантии нет — пересчёт остатков размазан по route handlers.

Все три проблемы — проявление трёх отсутствующих инженерных контрактов:
- **Contract 1: formatting as a single source of truth.** Нет одной точки форматирования → каждый компонент изобретает свой формат.
- **Contract 2: deletion model (soft vs hard) per role.** Soft-delete `deletedAt` есть в схеме, но read-queries его не фильтруют.
- **Contract 3: stock recalculation as a single service function.** Остаток считается в разных местах по-разному (incremental update в SKU + параллельно batches), мутации прихода не гарантированно синхронизируют обе ветки.

Этот ADR вводит три дисциплины сразу — потому что чинить их по одной бессмысленно, баги будут плодиться.

---

## Проблема 1 — Единый формат дат и времени

### Требования владельца (жёсткие)
- **Время:** 24-часовой формат, `HH:mm` (например `09:00`, `18:30`). Никакого AM/PM.
- **Дата:** `дд-мм-гггг` через дефис (например `23-04-2026`). Запрещены `MM/DD/YYYY`, `YYYY-MM-DD`, `DD.MM.YYYY` в UI.
- **Дата+время:** `дд-мм-гггг HH:mm` (например `23-04-2026 18:30`).
- **Timezone:** Europe/Moscow для всего отображения; в БД — UTC (Prisma default).
- **Где ISO допустим:** JSON payload API, значения `<input type="datetime-local">`, SQL/Prisma. Это «internal transport», не UI.

### Варианты

#### Вариант A: Централизованный `src/lib/format.ts` + ESLint guard
Одна точка истины. Весь код (UI, emails, bot, exports) импортирует из `@/lib/format`. ESLint-rule `no-restricted-syntax` запрещает `Date.prototype.toLocaleString|toLocaleDateString|toLocaleTimeString` и `new Intl.DateTimeFormat` вне `src/lib/format.ts`.

- ➕ Одно место для изменений (если в будущем владелец захочет `dd.MM.yyyy` — правим в одном файле)
- ➕ ESLint ловит регрессии на стадии CI
- ➕ Легко тестируется (pure functions + зависимость от `Europe/Moscow`)
- ➖ Одномоментная миграция ~30+ файлов

#### Вариант B: Просто задокументировать стандарт, править точечно
- ➕ Быстро
- ➖ Через месяц снова расползётся — так и произошло в Phase 1–4
- ➖ Нет technical enforcement

**Решение: Вариант A.** Без ESLint-rule мы через месяц опять найдём `toLocaleDateString` в новом коде.

### Модуль `src/lib/format.ts`

```typescript
// Все функции принимают Date | string (ISO) | number (epoch ms) | null | undefined.
// Для null/undefined возвращают "" — UI сам решает, показывать "—" или пусто.

export const TZ = "Europe/Moscow" as const;

/** "23-04-2026" */
export function formatDate(value: Date | string | number | null | undefined): string;

/** "18:30" (24h, HH:mm) */
export function formatTime(value: Date | string | number | null | undefined): string;

/** "23-04-2026 18:30" */
export function formatDateTime(value: Date | string | number | null | undefined): string;

/** "23-04-2026" → Date (UTC midnight of that Moscow day). Бросает Error при невалидном вводе. */
export function parseDate(ddmmyyyy: string): Date;

/** Для input[type=date]: "2026-04-23" (HTML5 требует ISO). */
export function toISODate(value: Date | string | number): string;

/** Для input[type=datetime-local]: "2026-04-23T18:30" (локальное время без таймзоны). */
export function toISODateTimeLocal(value: Date | string | number): string;

/** "через 5 минут", "2 часа назад" — только если реально нужно; в отчётах запрещено. */
export function formatRelative(value: Date | string | number): string;
```

Реализация — через `date-fns-tz` (`formatInTimeZone`, `toZonedTime`). Уже в deps по CLAUDE.md.

### Интеграция с `src/lib/booking-time.ts`
Оставляем как есть — `booking-time.ts` оперирует строками `"HH:MM"` в локальном контексте одного дня (slots/chips), это _domain helper_, не форматирование. Добавляем в его шапку ссылку: «Для форматирования `Date → string` в UI используй `@/lib/format`. Этот файл — только slot-логика.»

### Места форматирования, которые нужно мигрировать

Из гит-статуса и Glob по кодовой базе — опорные находки. Developer обязан пройти `grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString\|Intl.DateTimeFormat\|hour12\|\.toISOString().split" src/ bot/ scripts/` и заменить ВСЕ вхождения, кроме `src/lib/format.ts` и `src/modules/ps-park/service.ts` (internal `formatMoscowTime`/`getMoscowHour` → перенести в `format.ts`).

**Категории (ориентировочно, точные номера строк developer должен получить grep'ом):**

- **Публичный фронт:**
  - `src/components/public/gazebos/booking-flow.tsx` — отображение выбранной даты бронирования
  - `src/components/public/ps-park/dark-availability-grid.tsx` — подписи часов/дней
  - `src/components/public/rental/rental-page-content.tsx` — даты договоров
  - `src/components/public/cafe/**` — часы работы
- **Админка:**
  - `src/app/(admin)/**/page.tsx` — все таблицы списков (бронирования, заказы, приходы склада)
  - `src/components/admin/**` — виджеты дашборда, графики
  - Особо: receipt-таблица склада (commit 2972d3e частично чинил)
- **Emails (`src/lib/email/templates/**` или `src/modules/notifications/**`):**
  - Шаблоны «подтверждение брони», «напоминание», «договор истекает» — сейчас могут использовать `toLocaleString("ru-RU")` напрямую
- **Telegram bot (`bot/handlers/**`):**
  - Текстовые сообщения о бронях, статусах, напоминаниях
- **Exports / reports:**
  - `src/modules/rental/reports.ts` (если есть)
  - Экспорт day-report PS Park, экспорт транзакций inventory
  - CSV-хедеры с датами — обязательно `дд-мм-гггг`
- **Внутренние service-функции (требуют аккуратности, это не UI, но отдают в UI):**
  - `src/modules/ps-park/service.ts:314, 489, 604, 1127, 1376, 1382, 994` — `.toISOString().split("T")[0]` как _date key_. Это internal, **оставить ISO** (используется как ключ Map и для Prisma-запросов), но для UI mapping использовать `formatDate`.
  - `src/modules/ps-park/service.ts:490–491, 605–606` — `toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })` в notification payload → заменить на `formatTime`.

### ESLint rule (добавить в `.eslintrc.js`)
```js
{
  "no-restricted-syntax": [
    "error",
    {
      "selector": "CallExpression[callee.property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString)$/]",
      "message": "Используй @/lib/format вместо toLocale*. См. ADR 2026-04-23."
    },
    {
      "selector": "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
      "message": "Используй @/lib/format вместо Intl.DateTimeFormat."
    }
  ]
}
```
С overrides для `src/lib/format.ts` и `src/lib/format.test.ts` — там rule отключается.

---

## Проблема 2 — PS Park: удалённая бронь возвращается

### Диагностика

В `src/app/api/ps-park/bookings/[id]/route.ts` (DELETE handler, строки 125–155):

```typescript
await prisma.booking.update({
  where: { id },
  data: { deletedAt: new Date() },
});
```

DELETE делает soft-delete через `deletedAt`. **Корневой баг:** ни одна из read-функций в `src/modules/ps-park/service.ts` не фильтрует `deletedAt: null`:

- `listBookings` (97) — нет фильтра
- `getBooking` (125) — нет фильтра
- `getTimeline` (943) — нет фильтра
- `getAvailability` (904) — нет фильтра
- `getActiveSessions` (992) — нет фильтра
- `getAnalytics` (1340) — нет фильтра
- `listBookingsPaginated` (1425) — нет фильтра

Поэтому после F5: бронь всё ещё в таблице (`deletedAt` проставлен, но не учитывается), в аналитике, в timeline, в availability (блокирует слот), и даже `saleBookingItems` мог её вернуть.

На фронте, видимо, происходит optimistic update (удалили из локального state), `deletedAt` проставился — но следующий запрос её возвращает.

### Решение — двухуровневая модель удаления

| Роль   | Операция         | Эффект                                                                                          |
|--------|------------------|-------------------------------------------------------------------------------------------------|
| USER   | Отмена           | `status = CANCELLED`, логируется в AuditLog. Учитывается в аналитике «cancelled».               |
| MANAGER| Отмена           | То же, что USER, но без штрафа (actor=admin).                                                   |
| SUPERADMIN | Hard remove | `deletedAt = now()`, строка исключена из ВСЕХ read-query, исключена из ВСЕХ аналитик/отчётов. |

Почему soft-delete (а не `prisma.booking.delete`):
- Сохранение истории для аудита и юридических споров.
- Восстановление при ошибочном удалении (есть `deletedAt` → можно обнулить).
- FK-constraints: `FinancialTransaction.bookingId`, `InventoryTransaction.bookingId` перестанут указывать в никуда.

### План исправления

**1. `src/modules/ps-park/service.ts` — добавить `deletedAt: null` во ВСЕ `where`:**

- `listBookings` → `where: { moduleSlug: MODULE_SLUG, deletedAt: null, ... }`
- `getBooking` → same
- `getTimeline` → same
- `getAvailability` (конкретно bookings query на строке 911)
- `getActiveSessions` (строка 996)
- `getAnalytics` — bookings (1352) **и** transactions через `booking: { deletedAt: null }` join, либо агрегировать только по не-удалённым
- `listBookingsPaginated` (1437)
- `createBooking` / `createAdminBooking` / `extendBooking` — conflict check (156, 645, 1070) тоже `deletedAt: null`, чтобы удалённая бронь не блокировала слот

**2. Аналогично аудит по всем модулям с soft-delete:**
- `src/modules/gazebos/service.ts` — если есть `deletedAt`
- `src/modules/cafe/service.ts` (Order)
- `src/modules/rental/service.ts` (RentalContract)
- `src/modules/inventory/service.ts` — в listReceipts уже есть `isVoided: false`, это аналог; нужен общий аудит

**3. DELETE handler `src/app/api/ps-park/bookings/[id]/route.ts` — нормализовать:**
- Уже требует SUPERADMIN через `authorizeSuperadminDeletion` ✓
- Добавить: при delete если booking.status был `CONFIRMED` и содержал items — восстановить остатки через `returnBookingItems` в транзакции. Иначе items «потеряются из мира»: они не вернулись на склад, бронь исчезла из отчёта.
- Audit log уже есть (`logDeletion`) ✓

**4. Frontend `src/components/admin/ps-park/**` — убрать optimistic update без подтверждения:**
- После DELETE вызвать `router.refresh()` / SWR `mutate()` — чтобы пересчитать с сервера.
- Показать toast «Удалено» только после 200 от API.

**5. RBAC контракт (обязательно в ADR):**

```
DELETE /api/ps-park/bookings/:id
- Роль: SUPERADMIN (строгая проверка через authorizeSuperadminDeletion — уже есть)
- MANAGER получает 403
- Требует re-auth паролем (password в body) — уже реализовано
- Rate limit: 10/мин на SUPERADMIN (sensitive)
- Body: { password: string, reason?: string }
- Ошибки: 401 INVALID_PASSWORD, 403 FORBIDDEN, 404 NOT_FOUND, 400 BOOKING_ALREADY_DELETED
```

**6. Тесты (обязательные):**
- `src/modules/ps-park/__tests__/service.test.ts` — добавить:
  - `listBookings` не возвращает записи с `deletedAt != null`
  - `getAvailability` не блокирует слот удалённой бронью
  - `getAnalytics` не учитывает удалённые в `totalBookings`, `totalRevenue`
  - `createBooking` не конфликтует с удалённой бронью на то же время
- Integration test `src/app/api/ps-park/bookings/[id]/__tests__/delete.test.ts`:
  - SUPERADMIN DELETE → 200, GET list → пусто
  - MANAGER DELETE → 403
  - DELETE подтверждённой брони с items → items возвращены на склад

---

## Проблема 3 — Склад: приход не обновляет остатки

### Диагностика

В `src/modules/inventory/service.ts`:
- `receiveStockByName` (151–250) — создаёт `InventoryTransaction` + инкрементит `InventorySku.stockQuantity` + создаёт `StockBatch` + `StockMovement`. Всё в одной транзакции. **Это работает при создании.**
- **Отсутствует функция `updateReceipt` / `editReceiptQuantity`.** Нет `src/app/api/inventory/receipts/[id]/route.ts` с PATCH. Commit 2972d3e фиксил UI save, но судя по репозиторию, серверного единого пути пересчёта при редактировании прихода нет.
- `voidTransaction` (369) корректирует `stockQuantity`, но не трогает `StockBatch.remainingQty` и не создаёт compensating `StockMovement`. Значит, после void-а batches и главный счётчик расходятся.

### Две ветки истины для остатков

В схеме сейчас:
- `InventorySku.stockQuantity` (denormalized counter, инкремент/декремент)
- `StockBatch.remainingQty` (FIFO batches, сумма по всем batches должна равняться stockQuantity)
- `StockMovement` (ledger, immutable лог всех движений)

**Инвариант (нарушается):** `SUM(StockBatch.remainingQty WHERE skuId=X) === InventorySku.stockQuantity` для каждого SKU.

Нарушается, потому что:
1. `receiveStock` (118) обновляет `stockQuantity`, но НЕ создаёт `StockBatch` (в отличие от `receiveStockByName`)
2. `adjustStock` (292) меняет `stockQuantity`, но не трогает batches
3. `saleBookingItems` (503) и `returnBookingItems` (547) обновляют `stockQuantity`, но не трогают batches
4. `voidTransaction` (369) — тоже только `stockQuantity`

### Решение — единая функция пересчёта + уборка денормализации

#### Вариант A: Убрать `stockQuantity`, считать только через batches
- ➕ Один источник истины — FIFO batches
- ➖ Дорогие аналитические запросы (аггрегация по batches)
- ➖ Миграция рискованная

#### Вариант B: Оставить денормализацию, гарантировать синхронизацию через `recalculateStock(skuId, tx)`
- ➕ Быстрые селекты остатка
- ➕ Мягкая миграция (сначала добавим функцию, потом выпилим прямые инкременты)
- ➖ Нужна дисциплина вызова

**Решение: Вариант B.**

#### Контракт новой функции

```typescript
// src/modules/inventory/stock.ts (новый файл)

/**
 * Пересчитывает stockQuantity у SKU как сумму batches с learningQty > 0.
 * Проверяет инвариант: sum(batches) === stockQuantity после update.
 * ДОЛЖЕН вызываться внутри prisma.$transaction из любой мутации, меняющей батчи.
 *
 * @throws InventoryError STOCK_INVARIANT_BROKEN — если инвариант нарушен до начала
 */
export async function recalculateStock(
  tx: Prisma.TransactionClient,
  skuId: string
): Promise<{ skuId: string; newStockQuantity: number; batchesCount: number }>;

/**
 * При UPDATE existing receipt:
 *  - найти batch, созданный этим receipt'ом (по receiptId / linked txId)
 *  - обновить initialQty и remainingQty (если из batch уже не продали больше, чем новый initialQty)
 *  - создать StockMovement type=ADJUSTMENT с delta = new - old
 *  - обновить родительскую InventoryTransaction (quantity, note, receivedAt)
 *  - recalculateStock(skuId)
 */
export async function updateReceipt(
  receiptId: string,
  input: { quantity?: number; receivedAt?: Date; note?: string },
  performedById: string
): Promise<{ receiptId: string; skuId: string; newStockQuantity: number }>;

/** Hard-delete receipt — только SUPERADMIN, строгие проверки, что товар не продан. */
export async function deleteReceipt(
  receiptId: string,
  performedById: string,
  reason: string
): Promise<{ receiptId: string; skuId: string; newStockQuantity: number }>;
```

#### Схема (миграция)

Связать `StockBatch` с `InventoryTransaction` (родительский receipt):

```prisma
model StockBatch {
  id            String   @id @default(cuid())
  skuId         String
  sku           InventorySku @relation(fields: [skuId], references: [id])
  receiptTxId   String?  @unique  // NEW — ссылка на родительский RECEIPT/INITIAL
  receiptTx     InventoryTransaction? @relation("BatchReceipt", fields: [receiptTxId], references: [id])
  initialQty    Int
  remainingQty  Int
  receiptDate   DateTime
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model InventoryTransaction {
  // ... existing fields
  batch StockBatch? @relation("BatchReceipt")
}
```

Миграция данных: backfill `StockBatch.receiptTxId` для существующих batches через match по `skuId + initialQty + receiptDate` (лучший effort, может потребовать ручной проверки менеджером).

#### API-контракт

```
PATCH /api/inventory/receipts/:id
- Роль: MANAGER (со своим модулем склада) | SUPERADMIN
- hasModuleAccess(userId, "inventory") для MANAGER
- Rate limit: 30/мин (обычный админский)
- Body (Zod):
    { quantity?: number (int, 1..100000),
      receivedAt?: string (ISO date),
      note?: string (max 500 chars) }
- Response: { success, data: { receiptId, skuId, newStockQuantity, deltaApplied } }
- Errors:
    404 RECEIPT_NOT_FOUND
    409 RECEIPT_PARTIALLY_SOLD — нельзя уменьшить quantity ниже уже проданного
    422 VALIDATION_ERROR
    423 RECEIPT_LOCKED — закрыта смена/месяц, нельзя редактировать задним числом

DELETE /api/inventory/receipts/:id
- Роль: SUPERADMIN ONLY (через authorizeSuperadminDeletion)
- Требует password в body + reason
- Rate limit: 10/мин
- Логика: если из batch ничего не продано → hard-delete batch + tx; иначе 409
```

#### Route handlers к созданию
- `src/app/api/inventory/receipts/[id]/route.ts` (PATCH, DELETE) — новый
- `src/app/api/inventory/receipts/[id]/history/route.ts` (GET) — опц., аудит изменений receipt'а (достать из `AuditLog`)

#### Распространить правило "каждая мутация → `recalculateStock`"

Все функции мутации в `src/modules/inventory/service.ts` должны вызывать `recalculateStock(tx, skuId)` в конце своей транзакции:

- `receiveStock` (118) — фикс: добавить создание `StockBatch` (сейчас забыто!) + `recalculateStock`
- `receiveStockByName` (151) — добавить `recalculateStock` (batches уже создаются)
- `adjustStock` (292) — добавить создание `StockMovement` type=ADJUSTMENT, пересчёт batches (списать с последнего batch) + `recalculateStock`
- `voidTransaction` (369) — после корректировки добавить `recalculateStock` + compensating batch update
- `saleBookingItems` (503) — списать FIFO с batches (сейчас НЕ списывает!) + `recalculateStock`
- `returnBookingItems` (547) — вернуть в batches (в last-used batch) + `recalculateStock`
- `updateReceipt` (новая) — обязательно

#### Ledger-инвариант — тест

`src/modules/inventory/__tests__/invariant.test.ts`:
- После любой мутации `SUM(batch.remainingQty) === sku.stockQuantity`
- Property-based тест (`fast-check`): случайная последовательность mutations → invariant держится

---

## Последствия

### Изменения в схеме БД
- `StockBatch.receiptTxId String? @unique` + relation → `InventoryTransaction.batch`
- Миграция `prisma/migrations/20260423_link_batch_to_receipt/` (add column + backfill + add FK)
- Остальное — без изменений схемы

### Новые endpoints
- `PATCH /api/inventory/receipts/:id` — редактирование прихода
- `DELETE /api/inventory/receipts/:id` — удаление прихода (SUPERADMIN)
- (опц.) `GET /api/inventory/receipts/:id/history` — аудит

### Влияние на существующие модули
- **Все модули, отображающие даты/время** — пересаживаются на `@/lib/format` (одно PR, коснётся ~30+ файлов)
- **PS Park** — read-queries получают `deletedAt: null` (минор, но везде)
- **Inventory** — все мутации оборачиваются `recalculateStock`
- **Gazebos / Cafe / Rental** — аудит soft-delete фильтров (tracker task)
- **Bot (`bot/handlers/**`)** — импорты format из `@/lib/format` (допустимо в Node.js ESM)
- **Emails** — то же

### Миграции данных
- Backfill `StockBatch.receiptTxId` (один SQL по match `skuId + initialQty + receiptDate`). Часть записей может остаться NULL — это OK, значит созданы до v2.
- Ничего не удаляется, backward-compatible.

### Security / RBAC
- Все новые endpoints проходят RBAC-чеклист из `agents/SECURITY.md`
- DELETE требует `authorizeSuperadminDeletion` (паттерн уже используется)
- Zod-валидация на всём входе
- Audit log на каждой мутации receipt'а

---

## Implementation Plan

### Phase 1 — Форматирование (1 PR, ~½ дня)
- [ ] Создать `src/lib/format.ts` с функциями из ADR, зависимость `date-fns-tz` (уже может быть в deps)
- [ ] Тесты `src/lib/__tests__/format.test.ts` — покрыть все функции + DST + null/undefined + epoch/ISO/Date
- [ ] Добавить ESLint rule в `.eslintrc` + overrides для format.ts
- [ ] Прогнать `npm run lint` — получить список всех нарушений, пройти по нему
- [ ] Заменить во всех файлах (grep по паттернам из раздела «Места»)
- [ ] Обновить `src/lib/booking-time.ts` шапку (ссылка на format.ts, scope clarified)
- [ ] Обновить email-шаблоны `src/modules/notifications/**` и `bot/handlers/**`

### Phase 2 — PS Park deletion (1 PR, ~½ дня)
- [ ] Добавить `deletedAt: null` в 7 read-queries `src/modules/ps-park/service.ts`
- [ ] Обновить DELETE handler: при `booking.status === CONFIRMED` + items — вызвать `returnBookingItems` в транзакции
- [ ] Фронт `src/components/admin/ps-park/**` — после DELETE вызывать `router.refresh()` / `mutate()`
- [ ] Тесты: unit + integration (см. раздел проблемы 2)
- [ ] Аудит других модулей на `deletedAt` (gazebos/cafe/rental) — создать follow-up issue

### Phase 3 — Inventory stock recalculation (1-2 PR, 1 день)
- [ ] Миграция `StockBatch.receiptTxId` + backfill
- [ ] Создать `src/modules/inventory/stock.ts` с `recalculateStock`, `updateReceipt`, `deleteReceipt`
- [ ] Создать `src/modules/inventory/validation.ts` Zod-схемы `updateReceiptSchema`, `deleteReceiptSchema`
- [ ] Создать `src/app/api/inventory/receipts/[id]/route.ts` с PATCH + DELETE
- [ ] Обновить существующие мутации в `service.ts` — добавить `recalculateStock` везде
- [ ] Фикс `receiveStock` — добавить создание `StockBatch` (забыто!)
- [ ] Фикс `saleBookingItems` / `returnBookingItems` — списание/возврат из batches
- [ ] Frontend `src/components/admin/inventory/**` — форма редактирования прихода использует PATCH
- [ ] Тесты: unit (`stock.test.ts`, `invariant.test.ts` с property-based), integration (receipt PATCH flow)

---

## Почему такие баги повторяются и как перестать их плодить

### Корневые причины
1. **Нет единой точки форматирования** → каждый разработчик решает локально → хаос в UI, emails, bot, exports.
2. **Нет явной модели удаления (soft vs hard) per role** → soft-delete есть в схеме, но read-queries его игнорируют → удалённые данные «воскресают».
3. **Нет единой функции пересчёта остатков** → каждый route решает сам, как синхронизировать `stockQuantity` + `batches` + `movements` → инвариант нарушается.
4. **Нет автоматического enforcement** (ESLint / property-based tests) → регрессии незаметны при ревью, всплывают в production.

### Пять инженерных правил (добавить в `CLAUDE.md` и review-checklist)

1. **ESLint rule против `toLocale*` и `Intl.DateTimeFormat`.** Только `@/lib/format` — see `.eslintrc`.
2. **Все soft-delete read-queries обязаны фильтровать `deletedAt: null`.** Reviewer ищет `prisma.<model>.findMany` / `findFirst` и проверяет where-clause. Добавить unit-тесты "удалённая запись не возвращается" для каждого модуля с soft-delete.
3. **Все мутации склада обязаны быть в `prisma.$transaction` и заканчиваться `recalculateStock(tx, skuId)`.** Reviewer: grep `prisma.inventorySku.update` вне `src/modules/inventory/stock.ts` — красный флаг.
4. **Integration-тесты на end-to-end мутации.** Для каждого критичного flow: «создал приход → изменил → остаток корректен» + «удалил бронь → она не в списке + не в аналитике + слот свободен + остатки восстановлены». Обязательно перед мержем, не только unit.
5. **Property-based инварианты.** `SUM(batch.remainingQty) === sku.stockQuantity` и `bookingsInSlot <= 1` — тестируются `fast-check` случайными последовательностями операций. Дорого, но ловит баги, которые review не ловит.

### Follow-ups (создать issues)
- Аудит soft-delete во всех модулях (gazebos, cafe, rental, orders)
- Миграция `StockBatch.receiptTxId` backfill и отчёт о NULL-записях (что делать)
- Архитектурное решение по `InventorySku.stockQuantity` — оставить денормализацию или убрать на v3
- Перевести `src/modules/ps-park/service.ts:formatMoscowTime` / `getMoscowHour` в `@/lib/format` (убрать дубликат)
- Добавить в CI step `npm run lint:format-guard` — отдельная проверка именно ESLint-rule как separate check для PR
