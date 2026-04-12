# ADR: Модуль управления товарами и складом (Inventory v2)

**Дата**: 2026-04-12  
**Статус**: Принято  
**Автор**: System Architect  
**Затрагивает модули**: `inventory` (расширение), `cafe`, `gazebos`, `ps-park`

---

## Контекст и постановка проблемы

### Текущее состояние

Модуль `inventory` реализован в фазах 2–3 как упрощённый регистр SKU с плоским счётчиком остатков (`InventorySku.stockQuantity`) и линейным журналом транзакций (`InventoryTransaction`). Реализованные возможности:

- CRUD SKU (категория, цена, порог минимального остатка)
- Приход по свободному названию (`receiveStockByName`) — создаёт/находит SKU, пишет RECEIPT/INITIAL
- Коррекция остатка (`ADJUSTMENT`)
- Интеграция с бронированиями PS Park / Беседок: snapshot при создании, SALE при CONFIRMED, RETURN при отмене
- Аналитика: продажи по модулям, топ-SKU, low-stock

### Чего не хватает

Текущая модель не поддерживает:

1. **FIFO-списание** — учитывается только суммарный остаток, нет привязки к партиям (batch). Нельзя контролировать срок годности.
2. **Поставщики** — нет справочника поставщиков, документов прихода (накладные, цена закупки).
3. **Мягкая резервация** — при конкурентных бронированиях на один товар возможна гонка: оба читают остаток = 1, оба пишут SALE. Текущая защита (re-check внутри транзакции) корректна только при использовании Prisma-транзакций с `isolation: Serializable`, что нигде явно не задано.
4. **Списания** — нет отдельного механизма WriteOff (просроченное, повреждённое, утеря).
5. **Инвентаризация** — нет процедуры сверки фактических остатков с учётными.
6. **Автоматическое отключение позиций меню** — кафе не знает о нулевом остатке SKU.
7. **Rate-limited Telegram-алерты** — нет механизма дедупликации оповещений при снижении остатка (максимум 1 раз в 24 ч на продукт).
8. **Иммутабельный журнал движений** — текущий `isVoided` позволяет логически отменить транзакцию, но нет отдельного нейтрализующего движения (поворотной записи).

### Цель ADR

Спроектировать расширение схемы и сервисного слоя inventory, которое устраняет все перечисленные пробелы, сохраняет обратную совместимость с текущей бизнес-логикой и обеспечивает Developer прямыми инструкциями к реализации.

---

## Принятые архитектурные решения

### Решение 1: Двухуровневая модель хранения остатков

**Проблема**: плоский счётчик не поддерживает FIFO и сроки годности.

**Решение**: Сохранить `InventorySku.stockQuantity` как **денормализованный агрегат** (быстрый read), добавить `StockBatch` — запись о партии с количеством, ценой закупки и сроком годности.

```
InventorySku (aggrеgate)
  └── StockBatch[] (партии, FIFO по expiresAt, потом receiptDate)
        └── StockMovement[] (иммутабельный журнал, ссылается на batch)
```

Денормализованный агрегат обновляется атомарно внутри той же Prisma-транзакции, что и запись в журнал. Нет eventual consistency — всё синхронно.

**Почему не только батчи**: `stockQuantity` используется в десятках мест (API, аналитика, low-stock check). Удаление агрегата потребует переписать все запросы. Денормализация — допустимый trade-off на этом масштабе.

---

### Решение 2: Иммутабельный журнал движений (StockMovement)

**Проблема**: `InventoryTransaction.isVoided = true` — это мутация записи, а не новая запись. При конкурентном чтении возможно прочитать «ещё не отменённую» транзакцию.

**Решение**: Новая модель `StockMovement` — **append-only**. Нет полей `isVoided`, нет UPDATE. Для отмены создаётся новая запись с типом `MANUAL_CORRECTION` и отрицательным `delta`. Поле `reversalOf` ссылается на исходную запись.

Существующая `InventoryTransaction` **остаётся неизменной** (обратная совместимость). `StockMovement` — новая, параллельная таблица для V2-функциональности (FIFO, WriteOff, Audit).

---

### Решение 3: Pessimistic locking для конкурентных списаний

**Проблема**: два одновременных бронирования на последнюю единицу товара — оба прочитают `stockQuantity = 1`, оба пройдут валидацию.

**Решение**: Использовать `SELECT ... FOR UPDATE` через `prisma.$queryRaw` при FIFO-списании из партий. В Prisma нет встроенного row-level lock, но в транзакции с isolation `REPEATABLE READ` (PostgreSQL default) + явный lock:

```sql
SELECT * FROM "StockBatch"
WHERE "skuId" = $1 AND "remainingQty" > 0
ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC
FOR UPDATE;
```

Альтернатива: `prisma.$transaction([...], { isolationLevel: 'Serializable' })` — но это снижает throughput. Для платформы с ожидаемой нагрузкой < 100 rps SELECT FOR UPDATE внутри READ COMMITTED транзакции достаточно и дешевле.

При реализации `saleBookingItems` (уже есть в `service.ts`) — заменить на вызов новой `deductStockFifo()`, которая делает raw lock.

---

### Решение 4: Telegram-алерты с дедупликацией через Redis

**Проблема**: при каждой продаже stock может падать ниже порога — нельзя спамить в Telegram.

**Решение**: После каждого движения, снижающего остаток, проверять low-stock. Если остаток < threshold — проверить Redis-ключ `inventory:alert:{skuId}` с TTL 86400 секунд (24 ч). Если ключ существует — пропустить. Если нет — послать в Telegram + установить ключ.

Логика идёт в `src/modules/inventory/alerts.ts`. Вызывается асинхронно (не блокирует ответ API): `setImmediate(() => checkAndSendLowStockAlert(skuId))`.

---

### Решение 5: Фоновые задачи через встроенный cron

Платформа не использует отдельный job-runner. Фоновые задачи реализуются через:
- `src/app/api/cron/inventory/route.ts` — защищённый GET-эндпоинт, вызываемый внешним cron (например, curl каждые 15 минут через системный cron на VPS или GitHub Actions Scheduled).
- Защита: заголовок `Authorization: Bearer {CRON_SECRET}` (переменная окружения).

Задачи cron:
1. `checkExpiredBatches()` — партии с `expiresAt < now`, `remainingQty > 0` → создаёт WriteOff с причиной `EXPIRED`, списывает батч, обновляет агрегат, уведомляет менеджера.
2. `checkLowStockAlerts()` — sweep по всем активным SKU с `stockQuantity < lowStockThreshold`, отправляет Telegram (с дедупликацией по Redis).

---

### Решение 6: Интеграция с кафе — автоотключение позиций меню

**Проблема**: кафе не знает о нулевом остатке связанного SKU.

**Решение**: Добавить в `MenuItem` два поля:
- `inventorySkuId` — опциональная ссылка на `InventorySku`
- `autoDisabledByStock` — флаг, выставляемый инвентарём, не менеджером

После каждого SALE/WriteOff, если `stockQuantity` стало 0 и у SKU есть связанные `MenuItem`, их `isAvailable` устанавливается в `false`, `autoDisabledByStock = true`. После RECEIPT/RETURN, если `stockQuantity > 0` — снимает auto-disable (не трогает позиции, отключённые вручную: `autoDisabledByStock = false`).

---

## Схема базы данных (Prisma — добавления к schema.prisma)

### Новые enum

```prisma
enum ProductUnit {
  PCS      // штук
  KG       // кг
  LITERS   // л
  PACKS    // пачек/упаковок
}

enum MovementType {
  RECEIPT            // приход от поставщика
  SALE               // продажа (заказ кафе / addon бронирования)
  RESERVATION        // мягкая резервация (soft-lock)
  RELEASE            // снятие резервации (без продажи)
  WRITE_OFF          // списание (просрочка, порча, потеря)
  AUDIT_ADJUSTMENT   // корректировка по итогам инвентаризации
  MANUAL_CORRECTION  // ручная корректировка / отмена движения
}

enum ReferenceType {
  BOOKING   // ссылается на Booking.id
  ORDER     // ссылается на Order.id
  RECEIPT   // ссылается на StockReceipt.id
  WRITE_OFF // ссылается на WriteOff.id
  AUDIT     // ссылается на InventoryAudit.id
  MANUAL    // без ссылки
}

enum WriteOffReason {
  EXPIRED   // срок годности истёк
  DAMAGED   // порча
  LOST      // потеря/недостача
  OTHER     // прочее (с обязательным note)
}

enum AuditStatus {
  IN_PROGRESS
  COMPLETED
}
```

### Новые модели

```prisma
// === INVENTORY V2 ===

// Справочник поставщиков
model Supplier {
  id          String   @id @default(cuid())
  name        String
  contactName String?
  phone       String?
  email       String?
  inn         String?
  notes       String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  receipts StockReceipt[]

  @@index([isActive])
}

// Документ прихода (накладная)
model StockReceipt {
  id           String    @id @default(cuid())
  supplierId   String?
  supplier     Supplier? @relation(fields: [supplierId], references: [id])
  invoiceNumber String?  // номер накладной поставщика
  receivedAt   DateTime  // фактическая дата прихода
  notes        String?
  performedById String
  createdAt    DateTime  @default(now())

  items StockReceiptItem[]

  @@index([supplierId])
  @@index([receivedAt])
}

// Строка документа прихода
model StockReceiptItem {
  id           String       @id @default(cuid())
  receiptId    String
  receipt      StockReceipt @relation(fields: [receiptId], references: [id])
  skuId        String
  sku          InventorySku @relation(fields: [skuId], references: [id])
  quantity     Int
  costPerUnit  Decimal?     // закупочная цена
  expiresAt    DateTime?    // срок годности для этой партии
  batchId      String?      // ссылка на созданный StockBatch (заполняется после проводки)

  @@index([receiptId])
  @@index([skuId])
}

// Партия товара (для FIFO)
model StockBatch {
  id           String       @id @default(cuid())
  skuId        String
  sku          InventorySku @relation(fields: [skuId], references: [id])
  receiptItemId String?     // источник — строка накладной (null для legacy/initial)
  initialQty   Int          // сколько пришло в партии
  remainingQty Int          // сколько осталось (изменяется при списании)
  costPerUnit  Decimal?     // закупочная цена
  receiptDate  DateTime     // дата прихода (для FIFO-сортировки)
  expiresAt    DateTime?    // срок годности
  isExhausted  Boolean      @default(false) // все единицы списаны
  createdAt    DateTime     @default(now())

  movements StockMovement[]

  @@index([skuId, isExhausted, expiresAt, receiptDate])
  @@index([expiresAt])
}

// Иммутабельный журнал движений склада
model StockMovement {
  id            String        @id @default(cuid())
  skuId         String
  sku           InventorySku  @relation(fields: [skuId], references: [id])
  batchId       String?       // партия, из которой/в которую
  batch         StockBatch?   @relation(fields: [batchId], references: [id])
  type          MovementType
  delta         Int           // положительное = приход, отрицательное = расход
  balanceAfter  Int           // снапшот агрегата после движения (для аудита)
  referenceType ReferenceType
  referenceId   String?       // ID связанного объекта
  reversalOf    String?       // ID движения, которое это отменяет
  performedById String
  note          String?
  createdAt     DateTime      @default(now())

  @@index([skuId, createdAt])
  @@index([batchId])
  @@index([type])
  @@index([referenceType, referenceId])
  @@index([reversalOf])
}

// Списание (отдельная сущность для отчётности)
model WriteOff {
  id            String         @id @default(cuid())
  skuId         String
  sku           InventorySku   @relation(fields: [skuId], references: [id])
  batchId       String?        // из какой партии
  quantity      Int
  reason        WriteOffReason
  note          String?        // обязательно при reason = OTHER
  performedById String
  createdAt     DateTime       @default(now())

  movements StockMovement[]    @relation("WriteOffMovements")

  @@index([skuId])
  @@index([reason, createdAt])
}

// Инвентаризация (сверка факт / учёт)
model InventoryAudit {
  id            String      @id @default(cuid())
  status        AuditStatus @default(IN_PROGRESS)
  startedById   String
  completedById String?
  notes         String?
  startedAt     DateTime    @default(now())
  completedAt   DateTime?

  counts InventoryAuditCount[]

  @@index([status, startedAt])
}

// Строка инвентаризации (одна позиция)
model InventoryAuditCount {
  id           String         @id @default(cuid())
  auditId      String
  audit        InventoryAudit @relation(fields: [auditId], references: [id])
  skuId        String
  sku          InventorySku   @relation(fields: [skuId], references: [id])
  expectedQty  Int            // учётный остаток на момент начала инвентаризации
  actualQty    Int            // фактически насчитано
  delta        Int            // actualQty - expectedQty (отрицательное = недостача)
  isConfirmed  Boolean        @default(false)

  @@unique([auditId, skuId])
  @@index([auditId])
}
```

### Изменения существующих моделей

```prisma
// MenuItem — добавить поля для связи с инвентарём
model MenuItem {
  // ... существующие поля ...
  inventorySkuId      String?      // опциональная привязка к SKU
  autoDisabledByStock Boolean      @default(false) // true = отключено автоматически из-за нулевого остатка

  @@index([inventorySkuId])
  // существующие индексы остаются
}

// InventorySku — добавить обратные связи
model InventorySku {
  // ... существующие поля ...
  batches     StockBatch[]
  movements   StockMovement[]
  writeOffs   WriteOff[]
  receiptItems StockReceiptItem[]
  auditCounts InventoryAuditCount[]
  menuItems   MenuItem[]
  // существующие relations остаются
}
```

> **Примечание для Developer**: `StockMovement` и `InventoryTransaction` сосуществуют. Новая функциональность (FIFO, WriteOff, Audit) использует `StockMovement`. Существующий код (`saleBookingItems`, `returnBookingItems`, `receiveStock`, `adjustStock`) продолжает писать в `InventoryTransaction` как legacy-журнал — это допустимо на переходный период. Полная миграция на `StockMovement` — следующая фаза.

---

## Сервисный слой — движок склада

### Структура файлов

```
src/modules/inventory/
  service.ts              — существующий (CRUD SKU, legacy transactions)
  service-v2.ts           — новый: FIFO-движок, WriteOff, Audit
  alerts.ts               — новый: low-stock Telegram alerts с Redis dedupe
  types.ts                — расширить существующий
  validation.ts           — расширить существующий
  __tests__/
    service-v2.test.ts
    alerts.test.ts
```

### Алгоритм FIFO-списания (`deductStockFifo`)

```
function deductStockFifo(tx, skuId, quantity, referenceType, referenceId, performedById):
  1. SELECT batches WHERE skuId = ? AND isExhausted = false
     ORDER BY expiresAt ASC NULLS LAST, receiptDate ASC
     FOR UPDATE  ← pessimistic lock
  
  2. Проверить: sum(remainingQty) >= quantity
     Если нет → throw InventoryError("INVENTORY_INSUFFICIENT")
  
  3. remaining = quantity
     for each batch in batches:
       take = min(batch.remainingQty, remaining)
       
       UPDATE StockBatch SET remainingQty -= take
         WHERE id = batch.id
       
       if batch.remainingQty - take == 0:
         UPDATE StockBatch SET isExhausted = true WHERE id = batch.id
       
       INSERT StockMovement (skuId, batchId, type=SALE, delta=-take,
         referenceType, referenceId, performedById)
       
       remaining -= take
       if remaining == 0: break
  
  4. UPDATE InventorySku SET stockQuantity -= quantity WHERE id = skuId
  
  5. Записать balanceAfter = stockQuantity - quantity в последнее движение
  
  6. return { movementIds, newStockQuantity }
```

### Алгоритм прихода в партию (`receiveStockBatch`)

```
function receiveStockBatch(tx, skuId, quantity, costPerUnit, expiresAt,
                           receiptItemId, performedById, receivedAt):
  1. INSERT StockBatch (skuId, initialQty=quantity, remainingQty=quantity,
       costPerUnit, expiresAt, receiptDate=receivedAt, receiptItemId)
  
  2. UPDATE InventorySku SET stockQuantity += quantity WHERE id = skuId
  
  3. INSERT StockMovement (skuId, batchId=newBatch.id, type=RECEIPT,
       delta=+quantity, referenceType=RECEIPT, referenceId=receiptItemId,
       performedById, balanceAfter=newStockQuantity)
  
  4. return { batchId, newStockQuantity }
```

### Алгоритм создания документа прихода (`createStockReceipt`)

```
function createStockReceipt(input, performedById):
  prisma.$transaction:
    1. INSERT StockReceipt (supplierId, invoiceNumber, receivedAt, notes, performedById)
    
    2. for each item in input.items:
       INSERT StockReceiptItem (receiptId, skuId, quantity, costPerUnit, expiresAt)
       
       call receiveStockBatch(tx, skuId, quantity, ...)
       
       UPDATE StockReceiptItem SET batchId = newBatch.id WHERE id = item.id
    
    3. Post-transaction: checkAndSendLowStockAlert для каждого skuId
       (асинхронно, не блокирует ответ)
    
    4. return { receiptId, batchIds, totalItems }
```

### Алгоритм списания WriteOff (`createWriteOff`)

```
function createWriteOff(input, performedById):
  // input: { skuId, quantity, reason, note?, batchId? }
  prisma.$transaction:
    1. Если batchId задан: проверить batch.skuId = input.skuId, batch.remainingQty >= quantity
       Иначе: FIFO — взять батчи как при SALE
    
    2. Уменьшить remainingQty в батчах, обновить isExhausted
    
    3. INSERT WriteOff (skuId, batchId, quantity, reason, note, performedById)
    
    4. INSERT StockMovement (type=WRITE_OFF, delta=-quantity,
         referenceType=WRITE_OFF, referenceId=writeOff.id, ...)
    
    5. UPDATE InventorySku SET stockQuantity -= quantity
    
    6. Проверить autoDisable для MenuItem
    
    7. return { writeOffId, newStockQuantity }
```

### Алгоритм инвентаризации

```
// Начало инвентаризации
function startAudit(startedById):
  1. INSERT InventoryAudit (status=IN_PROGRESS, startedById)
  
  2. Для каждого активного SKU:
     INSERT InventoryAuditCount (auditId, skuId,
       expectedQty = InventorySku.stockQuantity, actualQty=0)
  
  3. return { auditId, countLines }

// Обновление фактического количества
function updateAuditCount(auditId, skuId, actualQty):
  delta = actualQty - expectedQty
  UPDATE InventoryAuditCount SET actualQty, delta, isConfirmed=true

// Завершение инвентаризации
function completeAudit(auditId, completedById):
  prisma.$transaction:
    1. Загрузить все подтверждённые строки с delta != 0
    
    2. Для каждой строки с delta != 0:
       если delta > 0: receiveStockBatch (приход излишков, type=AUDIT_ADJUSTMENT)
       если delta < 0: deductStockFifo (списание недостачи, type=AUDIT_ADJUSTMENT)
       
       INSERT StockMovement (type=AUDIT_ADJUSTMENT,
         referenceType=AUDIT, referenceId=auditId)
    
    3. UPDATE InventoryAudit SET status=COMPLETED, completedAt, completedById
    
    4. return { adjustments, auditId }
```

---

## API эндпоинты

### Структура маршрутов

```
/api/inventory/                    — публичный список активных SKU (существующий)
/api/inventory/health              — health check (существующий)
/api/inventory/sku                 — CRUD SKU (существующий)
/api/inventory/sku/[id]            — существующий

/api/inventory/v2/suppliers        — справочник поставщиков
/api/inventory/v2/suppliers/[id]
/api/inventory/v2/receipts         — документы прихода
/api/inventory/v2/receipts/[id]
/api/inventory/v2/batches          — партии (только GET)
/api/inventory/v2/batches/[id]
/api/inventory/v2/movements        — журнал движений (только GET)
/api/inventory/v2/write-offs       — списания
/api/inventory/v2/write-offs/[id]
/api/inventory/v2/audits           — инвентаризации
/api/inventory/v2/audits/[id]
/api/inventory/v2/audits/[id]/counts
/api/inventory/v2/audits/[id]/complete
/api/cron/inventory                — cron-эндпоинт (expirations + alerts)
```

Все `/api/inventory/v2/*` защищены: `requireAdminSection(session, "inventory")`.

---

### Поставщики

#### `GET /api/inventory/v2/suppliers`

Query params: `isActive?: boolean`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "name": "ООО Продторг",
      "contactName": "Иван Петров",
      "phone": "+79161234567",
      "email": "ivan@prodtorg.ru",
      "inn": "7701234567",
      "isActive": true,
      "createdAt": "2026-04-01T10:00:00.000Z"
    }
  ]
}
```

#### `POST /api/inventory/v2/suppliers`

Request body:
```json
{
  "name": "ООО Продторг",
  "contactName": "Иван Петров",
  "phone": "+79161234567",
  "email": "ivan@prodtorg.ru",
  "inn": "7701234567",
  "notes": "Доставка по вторникам"
}
```

Валидация: `name` обязательно, `inn` — 10 или 12 цифр (если указан).

Response `201`: созданный поставщик.

Errors: `VALIDATION_ERROR 422`.

#### `PATCH /api/inventory/v2/suppliers/[id]`

Частичное обновление тех же полей + `isActive`.

#### `DELETE /api/inventory/v2/suppliers/[id]`

Soft delete: `UPDATE isActive = false`. Если есть связанные `StockReceipt` — только деактивация.

---

### Документы прихода

#### `GET /api/inventory/v2/receipts`

Query params: `supplierId?, dateFrom?, dateTo?, page?, perPage?`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "supplierId": "clx...",
      "supplierName": "ООО Продторг",
      "invoiceNumber": "НД-2026-041",
      "receivedAt": "2026-04-10T09:00:00.000Z",
      "notes": null,
      "performedById": "clx...",
      "performedByName": "Менеджер Склада",
      "itemCount": 3,
      "totalCost": "15000.00",
      "createdAt": "2026-04-10T09:05:00.000Z"
    }
  ],
  "meta": { "page": 1, "perPage": 20, "total": 45 }
}
```

#### `POST /api/inventory/v2/receipts`

Request body:
```json
{
  "supplierId": "clx...",
  "invoiceNumber": "НД-2026-041",
  "receivedAt": "2026-04-10",
  "notes": "Доставка утром",
  "items": [
    {
      "skuId": "clx...",
      "quantity": 24,
      "costPerUnit": 50.00,
      "expiresAt": "2026-07-01"
    },
    {
      "skuId": "clx...",
      "quantity": 12,
      "costPerUnit": 120.00,
      "expiresAt": null
    }
  ]
}
```

Валидация:
- `receivedAt` — дата не в будущем, формат `YYYY-MM-DD`
- `items` — массив 1–100 позиций
- `items[].quantity` — положительное целое
- `items[].costPerUnit` — неотрицательное (опционально)
- `items[].expiresAt` — дата в будущем (если указана)

Response `201`:
```json
{
  "success": true,
  "data": {
    "receiptId": "clx...",
    "itemsProcessed": 2,
    "batchesCreated": 2,
    "stockUpdates": [
      { "skuId": "clx...", "skuName": "Кола 0.5л", "addedQty": 24, "newStockQty": 48 },
      { "skuId": "clx...", "skuName": "Сок яблочный", "addedQty": 12, "newStockQty": 12 }
    ]
  }
}
```

Errors: `VALIDATION_ERROR 422`, `SKU_NOT_FOUND 404`, `INTERNAL_ERROR 500`.

#### `GET /api/inventory/v2/receipts/[id]`

Возвращает полный документ с items и информацией о батчах.

---

### Партии (StockBatch)

#### `GET /api/inventory/v2/batches`

Query params: `skuId?, isExhausted?, expiresBeforeDate?, page?, perPage?`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "skuId": "clx...",
      "skuName": "Кола 0.5л",
      "initialQty": 24,
      "remainingQty": 18,
      "costPerUnit": "50.00",
      "receiptDate": "2026-04-10T09:00:00.000Z",
      "expiresAt": "2026-07-01T00:00:00.000Z",
      "isExhausted": false
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 12 }
}
```

Только чтение — CREATE/UPDATE/DELETE батчей напрямую не поддерживается (только через приход или списание).

---

### Журнал движений

#### `GET /api/inventory/v2/movements`

Query params: `skuId?, batchId?, type?, referenceType?, referenceId?, dateFrom?, dateTo?, page?, perPage?`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "skuId": "clx...",
      "skuName": "Кола 0.5л",
      "batchId": "clx...",
      "type": "SALE",
      "delta": -3,
      "balanceAfter": 15,
      "referenceType": "BOOKING",
      "referenceId": "clx...",
      "reversalOf": null,
      "performedById": "clx...",
      "performedByName": "Система",
      "note": "Продажа при бронировании #ABC123",
      "createdAt": "2026-04-12T14:30:00.000Z"
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 230 }
}
```

Журнал иммутабелен — POST/PATCH/DELETE не существуют.

---

### Списания (WriteOff)

#### `GET /api/inventory/v2/write-offs`

Query params: `skuId?, reason?, dateFrom?, dateTo?, page?, perPage?`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "skuId": "clx...",
      "skuName": "Молоко 1л",
      "batchId": "clx...",
      "quantity": 5,
      "reason": "EXPIRED",
      "note": null,
      "performedById": "clx...",
      "performedByName": "Иван Петров",
      "createdAt": "2026-04-11T08:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 8 }
}
```

#### `POST /api/inventory/v2/write-offs`

Request body:
```json
{
  "skuId": "clx...",
  "quantity": 5,
  "reason": "EXPIRED",
  "note": null,
  "batchId": "clx..."
}
```

Валидация:
- `skuId` — обязательно
- `quantity` — положительное целое
- `reason` — enum `WriteOffReason`
- `note` — обязательно если `reason = OTHER`, макс. 1000 символов
- `batchId` — опционально; если не указан — FIFO по всем батчам

Response `201`:
```json
{
  "success": true,
  "data": {
    "writeOffId": "clx...",
    "skuId": "clx...",
    "skuName": "Молоко 1л",
    "quantity": 5,
    "newStockQty": 7,
    "batchesAffected": [
      { "batchId": "clx...", "deducted": 5, "remainingAfter": 0 }
    ]
  }
}
```

Errors: `VALIDATION_ERROR 422`, `SKU_NOT_FOUND 404`, `INVENTORY_INSUFFICIENT 409`.

---

### Инвентаризация

#### `GET /api/inventory/v2/audits`

Query params: `status?, page?, perPage?`

Response `200`: список инвентаризаций с `id`, `status`, `startedAt`, `completedAt`, `lineCount`.

#### `POST /api/inventory/v2/audits`

Начинает новую инвентаризацию. Если есть `IN_PROGRESS` — возвращает ошибку `AUDIT_IN_PROGRESS 409`.

Request body: `{ "notes": "Плановая ежеквартальная инвентаризация" }`

Response `201`:
```json
{
  "success": true,
  "data": {
    "auditId": "clx...",
    "status": "IN_PROGRESS",
    "lineCount": 42,
    "startedAt": "2026-04-12T09:00:00.000Z"
  }
}
```

#### `GET /api/inventory/v2/audits/[id]`

Возвращает заголовок + все строки (`counts`) с `expectedQty`, `actualQty`, `delta`, `isConfirmed`.

#### `PATCH /api/inventory/v2/audits/[id]/counts`

Обновление фактических количеств. Может быть вызван несколько раз (частичное обновление).

Request body:
```json
{
  "counts": [
    { "skuId": "clx...", "actualQty": 18 },
    { "skuId": "clx...", "actualQty": 5 }
  ]
}
```

Валидация: `counts` — массив 1–100, `actualQty` — неотрицательное целое.

Response `200`: обновлённые строки с дельтами.

#### `POST /api/inventory/v2/audits/[id]/complete`

Применяет все корректировки и завершает инвентаризацию.

Условие: инвентаризация должна быть `IN_PROGRESS`. Все строки с `delta != 0` создают движения `AUDIT_ADJUSTMENT`.

Response `200`:
```json
{
  "success": true,
  "data": {
    "auditId": "clx...",
    "status": "COMPLETED",
    "completedAt": "2026-04-12T12:00:00.000Z",
    "adjustments": [
      { "skuId": "clx...", "skuName": "Кола 0.5л", "delta": -2, "newStockQty": 16 },
      { "skuId": "clx...", "skuName": "Сок яблочный", "delta": 1, "newStockQty": 6 }
    ]
  }
}
```

Errors: `AUDIT_NOT_FOUND 404`, `AUDIT_ALREADY_COMPLETED 409`.

---

### Cron-эндпоинт

#### `GET /api/cron/inventory`

Headers: `Authorization: Bearer {CRON_SECRET}`

Запускает:
1. `checkExpiredBatches()` — списывает просроченные партии (expiresAt < now, remainingQty > 0), создаёт WriteOff + StockMovement, отправляет Telegram-уведомление менеджеру инвентаря.
2. `checkLowStockAlerts()` — проверяет все активные SKU, отправляет Telegram при остатке ниже порога (с Redis-дедупликацией 24 ч).

Response `200`:
```json
{
  "success": true,
  "data": {
    "expiredBatchesProcessed": 2,
    "lowStockAlertsQueued": 3,
    "durationMs": 145
  }
}
```

---

## Zod-схемы валидации (структуры полей)

Все схемы добавляются в `src/modules/inventory/validation.ts`.

### `createSupplierSchema`
```
name:        string, min 1, max 200
contactName: string, max 100, optional
phone:       string, max 20, optional
email:       string email format, optional
inn:         string, regex /^\d{10}$|^\d{12}$/, optional
notes:       string, max 1000, optional
```

### `updateSupplierSchema`
Все поля из `createSupplierSchema` partial + `isActive: boolean optional`.

### `createReceiptSchema`
```
supplierId:    string cuid, optional
invoiceNumber: string, max 100, optional
receivedAt:    string YYYY-MM-DD, не в будущем
notes:         string, max 1000, optional
items:         array (min 1, max 100) of:
  skuId:       string cuid, required
  quantity:    integer, positive
  costPerUnit: number, nonnegative, optional
  expiresAt:   string YYYY-MM-DD, после сегодня, optional
```

### `createWriteOffSchema`
```
skuId:    string cuid, required
quantity: integer, positive
reason:   enum WriteOffReason
note:     string max 1000:
            — required if reason = OTHER
            — optional otherwise
batchId:  string cuid, optional
```

### `updateAuditCountsSchema`
```
counts: array (min 1, max 100) of:
  skuId:     string cuid, required
  actualQty: integer, nonnegative
```

### `batchFilterSchema`
```
skuId:             string, optional
isExhausted:       coerce boolean, optional
expiresBeforeDate: string YYYY-MM-DD, optional
page:              coerce integer positive, default 1
perPage:           coerce integer positive max 200, default 50
```

### `movementFilterSchema`
```
skuId:         string, optional
batchId:       string, optional
type:          enum MovementType, optional
referenceType: enum ReferenceType, optional
referenceId:   string, optional
dateFrom:      string YYYY-MM-DD, optional
dateTo:        string YYYY-MM-DD, optional
page:          coerce integer positive, default 1
perPage:       coerce integer positive max 200, default 50
```

---

## Диаграммы последовательности

### Сценарий 1: Бронирование с add-on товарами (PS Park / Беседки)

```
Client          API Route         BookingService      InventoryService    DB (Prisma tx)
  |                 |                   |                    |                 |
  |-- POST /book -->|                   |                    |                 |
  |                 |-- validateItems-->|                    |                 |
  |                 |                   |-- findMany(skuIds)->                |
  |                 |                   |<-------- skus ------                |
  |                 |                   |   check stockQty >= qty             |
  |                 |                   |   build snapshots                   |
  |                 |<-- snapshots -----                                      |
  |                 |                                                         |
  |                 |-- prisma.$transaction --------------------------------->|
  |                 |   INSERT Booking (status=PENDING, metadata.items=snap) |
  |                 |<-- booking created --------------------------------------|
  |<-- 201 booking--|                                                         |
  |                 |                                                         |
  (менеджер нажимает "Подтвердить бронирование)                              |
  |                 |                                                         |
  |-- PATCH /:id -->|                                                         |
  |  { status: CONFIRMED }                                                    |
  |                 |-- prisma.$transaction --------------------------------->|
  |                 |   1. UPDATE Booking status=CONFIRMED                   |
  |                 |   2. deductStockFifo(tx, items)                        |
  |                 |      SELECT StockBatch FOR UPDATE (FIFO order)         |
  |                 |      UPDATE StockBatch remainingQty -= N               |
  |                 |      INSERT StockMovement (type=SALE, delta=-N)        |
  |                 |      UPDATE InventorySku stockQty -= N                 |
  |                 |<-- transaction committed --------------------------------|
  |                 |                                                         |
  |                 |-- async: checkMenuAutoDisable(skuIds) ----------------->|
  |                 |-- async: checkAndSendLowStockAlert(skuIds) ------------>|
  |<-- 200 updated--|                                                         |
```

**Конкурентный сценарий (race condition):**

```
Client A                              Client B
  |                                      |
  |-- PATCH booking_A → CONFIRMED ------>|
  |                   |-- PATCH booking_B → CONFIRMED -->
  |                   |                              |
  |                   Tx A: SELECT batches FOR UPDATE ← lock acquired
  |                   |                              |
  |                   |                 Tx B: SELECT batches FOR UPDATE
  |                   |                 ← BLOCKED (waiting for Tx A lock)
  |                   |
  |                   Tx A: deduct, commit
  |                   |
  |<-- 200 OK --------|
  |                   |
  |                   Tx B: lock released, re-reads batches
  |                   Tx B: sum(remainingQty) < requested qty
  |                   Tx B: throw INVENTORY_INSUFFICIENT
  |                                      |
  |                              <-- 409 INVENTORY_INSUFFICIENT
```

---

### Сценарий 2: Оформление заказа в кафе с авто-списанием

```
Client          API Route         CafeService         InventoryService    DB
  |                 |                 |                     |               |
  |-- POST /cafe/order              |                     |               |
  |   { items: [{menuItemId, qty}] }                      |               |
  |                 |-- createOrder->|                     |               |
  |                 |               |-- getMenuItems ----->|               |
  |                 |               |   check isAvailable=true             |
  |                 |               |-- prisma.$transaction -------------->|
  |                 |               |   INSERT Order                       |
  |                 |               |   INSERT OrderItems                  |
  |                 |               |<-- order created --------------------|
  |                 |               |                                       |
  |                 |               | ← (опционально, если SKU привязаны)  |
  |                 |               |-- deductForOrder(tx, orderId, items)->|
  |                 |               |   for each OrderItem with inventorySkuId:
  |                 |               |     deductStockFifo(tx, skuId, qty)  |
  |                 |               |     INSERT StockMovement(SALE, ORDER)|
  |                 |               |<-- deduction done --------------------|
  |                 |<-- order -----|                     |               |
  |<-- 201 ---------|               |                     |               |
  |                 |               |                     |               |
  |                 |               async: checkMenuAutoDisable()          |
  |                 |               |   if stockQty == 0 AND menuItem linked:
  |                 |               |     UPDATE MenuItem isAvailable=false |
  |                 |               |     autoDisabledByStock=true          |
  |                 |               |     enqueueNotification(menu.disabled)|
```

**Примечание**: списание при заказе кафе — **опциональная фаза**. MVP: SKU привязаны к MenuItem, auto-disable работает, но списание происходит только при финальном статусе `DELIVERED` (а не `NEW`). Это упрощает логику возврата при отмене.

Рекомендуемый порядок:
1. Статус `NEW` → резервация (`RESERVATION` movement)
2. Статус `PREPARING` → реальное списание (`SALE` movement), снятие резервации (`RELEASE`)
3. Статус `CANCELLED` → снятие резервации (`RELEASE`)

Для MVP фазы можно упростить: нет резервации, только SALE при PREPARING.

---

## Кросс-модульная интеграция

### Интеграция с кафе

**Изменения в `MenuItem`**: добавить поля `inventorySkuId` и `autoDisabledByStock`.

**Изменения в `src/modules/inventory/service-v2.ts`**: функция `syncMenuItemsAvailability(skuId, newStockQty)`:
```
if (newStockQty == 0):
  UPDATE MenuItem SET isAvailable=false, autoDisabledByStock=true
  WHERE inventorySkuId = skuId AND isAvailable=true

if (newStockQty > 0):
  UPDATE MenuItem SET isAvailable=true, autoDisabledByStock=false
  WHERE inventorySkuId = skuId AND autoDisabledByStock=true
  (не трогает isAvailable=false + autoDisabledByStock=false — это ручное отключение)
```

Вызывается после каждой транзакции, меняющей `stockQty` вниз или вверх.

**Cafe Service** не изменяется — он только читает `isAvailable`. Управление флагом — обязанность инвентаря.

### Интеграция с PS Park и Беседками

**Существующий код** (`saleBookingItems`, `returnBookingItems`) продолжает работать как есть — они пишут в `InventoryTransaction`.

**Новая функциональность** (FIFO, партии): когда Developer переведёт модули на V2, нужно:
1. В `confirmBooking` вместо `saleBookingItems` вызывать `deductStockFifo`
2. В `cancelBooking` вместо `returnBookingItems` вызывать `restoreStockFifo` (новая функция, восстанавливает FIFO в обратном порядке — добавляет в последнюю списанную партию)

Переход — **не breaking change** для схемы, только замена вызовов в `gazebos/service.ts` и `ps-park/service.ts`.

---

## Стратегия конкурентности

### Уровень транзакции

Все операции с остатками (deductStockFifo, receiveStockBatch, createWriteOff, completeAudit) выполняются внутри `prisma.$transaction()`.

### Pessimistic locking для FIFO

Использовать `prisma.$queryRaw` для `SELECT FOR UPDATE` на `StockBatch` внутри транзакции. Пример кода:

```typescript
const batches = await tx.$queryRaw<StockBatch[]>`
  SELECT * FROM "StockBatch"
  WHERE "skuId" = ${skuId}
    AND "isExhausted" = false
    AND "remainingQty" > 0
  ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC
  FOR UPDATE
`;
```

Это блокирует строки до конца транзакции. Конкурирующая транзакция ждёт освобождения блокировки.

### Защита инвентаризации

При старте аудита (`POST /v2/audits`) — проверить нет ли `IN_PROGRESS` через:
```sql
SELECT COUNT(*) FROM "InventoryAudit" WHERE status = 'IN_PROGRESS'
```
Если > 0 → `409 AUDIT_IN_PROGRESS`. Это предотвращает одновременные инвентаризации.

### Защита от двойного списания по bookingId

В `StockMovement` можно добавить уникальный составной индекс:
```prisma
@@unique([referenceType, referenceId, type])
```
Это предотвратит двойное создание SALE для одного бронирования. Если транзакция попытается создать второй SALE для того же bookingId — Prisma выбросит `UniqueConstraintViolation`, транзакция откатится.

---

## Фоновые задачи

### Алерты о низком остатке (`src/modules/inventory/alerts.ts`)

```typescript
// Redis key: inventory:alert:{skuId} → TTL 86400s
async function checkAndSendLowStockAlert(skuId: string): Promise<void>

// Проверяет все активные SKU
async function checkAllLowStockAlerts(): Promise<{ sentCount: number }>

// Запускается по cron — партии с expiresAt < now + 24h
async function checkAndWriteOffExpiredBatches(): Promise<{ processedCount: number }>
```

### Cron-расписание (пример для VPS systemd timer или GitHub Actions):

```
*/15 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" \
              https://delovoy-park.ru/api/cron/inventory > /dev/null
```

---

## Влияние на существующие модули

### `cafe`

| Изменение | Тип | Описание |
|-----------|-----|---------|
| `MenuItem.inventorySkuId` | Новое поле | Опциональная привязка к SKU; nullable |
| `MenuItem.autoDisabledByStock` | Новое поле | Boolean, default false; управляется инвентарём |
| `createOrder` в `service.ts` | Расширение | После создания заказа вызывать `deductForOrder` если SKU привязаны |
| `updateOrderStatus` при CANCELLED | Расширение | Если `SALE` уже был — вызвать `restoreStockFifo` |

Существующий функционал (меню, заказы, статусы) — без breaking changes.

### `gazebos` и `ps-park`

| Изменение | Тип | Описание |
|-----------|-----|---------|
| `saleBookingItems` | Заменить | На `deductStockFifo` при переходе на V2 |
| `returnBookingItems` | Заменить | На `restoreStockFifo` при переходе на V2 |

До миграции на V2 — существующие функции продолжают работать (пишут в `InventoryTransaction`).

### `monitoring`

- Добавить в health check `/api/inventory/health` информацию о просроченных партиях: `expiredBatchesCount`
- Добавить бизнес-метрику: "Товары с остатком ниже порога" в суточный дашборд

---

## Стратегия миграции

### Этап 0 — Схема (1 migration)

1. Создать Prisma migration: добавить новые enum, новые модели, новые поля `MenuItem`
2. Новые таблицы пустые — `InventorySku` и `InventoryTransaction` не трогаются
3. Запустить `prisma migrate deploy`

Нет seed-данных. `StockBatch` будут создаваться при первом `POST /v2/receipts`.

### Этап 1 — Наполнение партий для существующих SKU (optional backfill)

Существующий `InventorySku.stockQuantity` отражает текущий остаток. Для корректной работы FIFO — создать по одной «legacy»-партии на каждый SKU с `stockQuantity > 0`:

```sql
INSERT INTO "StockBatch" (id, "skuId", "initialQty", "remainingQty",
  "receiptDate", "isExhausted", "createdAt")
SELECT gen_random_uuid(), id, "stockQuantity", "stockQuantity",
  "createdAt", false, now()
FROM "InventorySku"
WHERE "stockQuantity" > 0;
```

Этот скрипт — в `scripts/migrate-inventory-batches.ts`. Запускается **один раз** вручную после deploy этапа 0.

### Этап 2 — Новые API и сервисный слой

Разработка `service-v2.ts`, `alerts.ts`, новых route handlers. Существующие API не меняются.

### Этап 3 — Переключение cafe/gazebos/ps-park на FIFO

Постепенно заменить `saleBookingItems` / `returnBookingItems` на `deductStockFifo`. Smoke-тест на staging.

### Этап 4 — Deprecation `InventoryTransaction` для новых записей

После перехода всех модулей на `StockMovement` — перестать писать в `InventoryTransaction`. Таблица сохраняется как архивный журнал.

---

## Переменные окружения

Добавить в `.env`:
```env
# Cron protection
CRON_SECRET="generate-a-secure-random-secret"
```

---

## Checklist для Developer

- [ ] Prisma migration: добавить все enum и модели из раздела «Схема базы данных»
- [ ] Добавить поля `inventorySkuId`, `autoDisabledByStock` в `MenuItem`
- [ ] Написать `src/modules/inventory/service-v2.ts` с функциями: `createStockReceipt`, `deductStockFifo`, `restoreStockFifo`, `createWriteOff`, `startAudit`, `updateAuditCount`, `completeAudit`, `syncMenuItemsAvailability`
- [ ] Написать `src/modules/inventory/alerts.ts` с функциями: `checkAndSendLowStockAlert`, `checkAllLowStockAlerts`, `checkAndWriteOffExpiredBatches`
- [ ] Расширить `validation.ts`: добавить `createSupplierSchema`, `updateSupplierSchema`, `createReceiptSchema`, `createWriteOffSchema`, `updateAuditCountsSchema`, `batchFilterSchema`, `movementFilterSchema`
- [ ] Расширить `types.ts`: добавить типы для всех новых сущностей
- [ ] Создать route handlers в `src/app/api/inventory/v2/`
- [ ] Создать `src/app/api/cron/inventory/route.ts`
- [ ] Написать `scripts/migrate-inventory-batches.ts`
- [ ] Обновить `MenuItem` в UI кафе: показывать `autoDisabledByStock` как жёлтый badge «Нет на складе»
- [ ] Покрыть тестами: `deductStockFifo` (happy path, insufficient stock, race condition mock), `createWriteOff`, `completeAudit`, `syncMenuItemsAvailability`, `checkAndSendLowStockAlert`
- [ ] `npm test` зелёный перед PR

---

## Открытые вопросы

1. **Резервация в кафе**: в текущем дизайне RESERVATION-движение предусмотрено в enum, но кафе-сценарий упрощён. Если нужна полная резервация при `NEW` — добавить `reserveStockForOrder` и `releaseStockReservation`. Решение: начать с MVP (SALE при PREPARING), расширить при необходимости.

2. **Срок годности без партий**: некоторые категории (хозтовары, аксессуары) не имеют срока годности. Они создаются с `expiresAt = null`. При FIFO они обрабатываются последними (NULLS LAST в ORDER BY). Это корректное поведение.

3. **Возврат к поставщику**: не включён в текущий дизайн. Реализуется как `WriteOff` с reason `OTHER` + note «Возврат поставщику». Отдельная модель — излишество на MVP.

4. **Мобильное приложение**: все V2 эндпоинты следуют стандартному API-контракту `apiResponse()` — готовы к потреблению любым клиентом (Telegram Bot, Mobile App).
