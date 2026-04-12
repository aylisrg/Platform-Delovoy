# ADR: PS Park — защита цены ресурса, модуль инвентаря и продажи при бронировании

**Дата**: 2026-04-12  
**Статус**: Принято  
**Автор**: System Architect  
**Затрагивает модули**: `ps-park`, `gazebos`, новый модуль `inventory`

---

## Контекст

Три независимых, но связанных изменения:

1. **Блок 1**: Поле `pricePerHour` у столов PS Park должно изменяться только SUPERADMIN-ом. Текущий код разрешает это любому MANAGER-у.
2. **Блок 2**: Нужен новый доменный модуль `inventory` для управления товарами (напитки, закуски, аксессуары) с историей движения остатков.
3. **Блок 3**: При создании бронирования в PS Park и Газебо можно прикрепить товары из инвентаря. Списание происходит при переводе в `CONFIRMED`, возврат — при отмене `CONFIRMED`.

---

## Блок 1: Защита цены ресурса (PS Park)

### Проблема

В `PATCH /api/ps-park/:id` проверка роли: `hasRole(session.user, "MANAGER")` — это пропускает и MANAGER, и SUPERADMIN. Но изменение `pricePerHour` должно быть только для SUPERADMIN.

### Решение

В route handler `PATCH /api/ps-park/:id` добавляется дополнительная проверка: если тело запроса содержит поле `pricePerHour`, требуется роль `SUPERADMIN`.

### Изменения в `src/app/api/ps-park/[id]/route.ts`

```typescript
// Существующий код (строки 29-52) заменяется следующим:
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateTableSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // Защита цены: только SUPERADMIN может менять pricePerHour
    if (parsed.data.pricePerHour !== undefined && session.user.role !== "SUPERADMIN") {
      return apiForbidden("Изменение цены доступно только администратору");
    }

    const existing = await getTable(id);
    if (!existing) return apiNotFound("Стол не найден");

    const updated = await updateTable(id, parsed.data);
    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
```

### Начальные данные

Цена по умолчанию: уже задана в seed — 800 руб/час (столы 1, 2, 4) и 1200 руб/час (столы 3, 5). Изменения seed не нужны.

---

## Блок 2: Модуль инвентаря

### Схема БД — новые модели

```prisma
model InventorySku {
  id                String   @id @default(cuid())
  name              String
  category          String   // "Напитки", "Еда", "Аксессуары"
  unit              String   @default("шт")
  price             Decimal
  stockQuantity     Int      @default(0)
  lowStockThreshold Int      @default(5)
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  transactions InventoryTransaction[]

  @@index([category])
  @@index([isActive])
}

model InventoryTransaction {
  id            String                   @id @default(cuid())
  skuId         String
  sku           InventorySku             @relation(fields: [skuId], references: [id])
  type          InventoryTransactionType
  quantity      Int                      // Всегда положительное. Смысл (приход/расход) определяет type.
  bookingId     String?                  // Заполняется для SALE и RETURN
  moduleSlug    String?                  // "ps-park" или "gazebos" для SALE/RETURN
  performedById String                   // userId, совершившего операцию
  note          String?
  isVoided      Boolean                  @default(false)
  createdAt     DateTime                 @default(now())

  @@index([skuId, createdAt])
  @@index([bookingId])
  @@index([type, isVoided])
}

enum InventoryTransactionType {
  INITIAL     // Начальный остаток при заведении SKU
  RECEIPT     // Приход товара (от поставщика)
  SALE        // Продажа при бронировании (списание)
  RETURN      // Возврат при отмене CONFIRMED-бронирования
  ADJUSTMENT  // Ручная коррекция (инвентаризация)
}
```

**Важно**: `stockQuantity` в `InventorySku` — денормализованный остаток. Обновляется атомарно вместе с созданием `InventoryTransaction` в одной Prisma-транзакции. Это даёт O(1) чтение остатка без агрегации по транзакциям.

### Структура директорий нового модуля

```
src/
  modules/
    inventory/
      service.ts          # Бизнес-логика
      types.ts            # TypeScript-типы
      validation.ts       # Zod-схемы
      __tests__/
        service.test.ts
        validation.test.ts
  app/
    api/
      inventory/
        route.ts                        # GET (public список)
        health/
          route.ts
        sku/
          route.ts                      # GET all (SUPERADMIN), POST (SUPERADMIN)
          [id]/
            route.ts                    # PATCH, DELETE (SUPERADMIN)
        receive/
          route.ts                      # POST (MANAGER, SUPERADMIN)
        adjust/
          route.ts                      # POST (SUPERADMIN)
        transactions/
          route.ts                      # GET (MANAGER, SUPERADMIN)
          [id]/
            route.ts                    # DELETE/void (SUPERADMIN)
        analytics/
          route.ts                      # GET (SUPERADMIN)
```

### API контракты — модуль inventory

---

#### `GET /api/inventory` — публичный список активных SKU

**Auth**: нет (публичный)

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "clxxx",
      "name": "Coca-Cola 0.5л",
      "category": "Напитки",
      "unit": "шт",
      "price": "150.00",
      "stockQuantity": 48,
      "isActive": true
    }
  ]
}
```

---

#### `GET /api/inventory/sku` — все SKU включая неактивные

**Auth**: SUPERADMIN

**Query params**: `?category=Напитки&isActive=false`

**Response 200**:
```json
{
  "success": true,
  "data": [ /* массив InventorySku */ ],
  "meta": { "total": 12 }
}
```

---

#### `POST /api/inventory/sku` — создать SKU

**Auth**: SUPERADMIN

**Request body**:
```json
{
  "name": "Coca-Cola 0.5л",
  "category": "Напитки",
  "unit": "шт",
  "price": 150,
  "lowStockThreshold": 10,
  "initialStock": 48
}
```

- `initialStock` — опциональное поле. Если передано, создаётся транзакция типа `INITIAL` атомарно с созданием SKU.

**Response 201**:
```json
{
  "success": true,
  "data": {
    "id": "clxxx",
    "name": "Coca-Cola 0.5л",
    "category": "Напитки",
    "unit": "шт",
    "price": "150.00",
    "stockQuantity": 48,
    "lowStockThreshold": 10,
    "isActive": true,
    "createdAt": "2026-04-12T10:00:00.000Z",
    "updatedAt": "2026-04-12T10:00:00.000Z"
  }
}
```

**Errors**:
- `422 VALIDATION_ERROR` — невалидные поля
- `409 SKU_ALREADY_EXISTS` — SKU с таким name+category уже существует (рекомендуется проверять)

---

#### `PATCH /api/inventory/sku/:id` — обновить SKU

**Auth**: SUPERADMIN

**Request body** (все поля опциональные):
```json
{
  "name": "Coca-Cola 0.5л (обновлено)",
  "price": 160,
  "lowStockThreshold": 15,
  "isActive": true
}
```

**Ограничение**: `stockQuantity` через этот эндпоинт не меняется — только через `/receive` или `/adjust`.

**Response 200**: полный объект `InventorySku`.

---

#### `DELETE /api/inventory/sku/:id` — архивировать SKU

**Auth**: SUPERADMIN

Мягкое удаление: устанавливает `isActive = false`. Физическое удаление не поддерживается (есть транзакции).

**Response 200**:
```json
{
  "success": true,
  "data": { "id": "clxxx", "isActive": false }
}
```

**Error**:
- `409 SKU_HAS_PENDING_SALES` — если у SKU есть неаннулированные SALE-транзакции к активным бронированиям (опционально, для строгого режима)

---

#### `POST /api/inventory/receive` — зафиксировать приход

**Auth**: MANAGER, SUPERADMIN

**Request body**:
```json
{
  "skuId": "clxxx",
  "quantity": 24,
  "note": "Поставка от 12.04.2026"
}
```

**Логика в сервисе** (атомарная транзакция):
1. `InventoryTransaction.create({ type: "RECEIPT", quantity: 24, ... })`
2. `InventorySku.update({ stockQuantity: { increment: 24 } })`

**Response 201**:
```json
{
  "success": true,
  "data": {
    "transactionId": "clyyy",
    "skuId": "clxxx",
    "newStockQuantity": 72
  }
}
```

---

#### `POST /api/inventory/adjust` — скорректировать остаток

**Auth**: SUPERADMIN  
Используется при инвентаризации. Задаётся целевой остаток или дельта.

**Request body**:
```json
{
  "skuId": "clxxx",
  "targetQuantity": 50,
  "note": "Инвентаризация 12.04.2026 — недостача 2 шт"
}
```

**Логика**: вычисляется delta = `targetQuantity - stockQuantity`. Создаётся транзакция `ADJUSTMENT` с `quantity = abs(delta)` и знак кодируется в note или отдельным полем `direction: "increase"|"decrease"` (добавить в InventoryTransaction если нужно). Для MVP: `quantity` может быть отрицательным только в `ADJUSTMENT` транзакциях — разработчику на усмотрение хранить знак или использовать отдельный field.

**Рекомендация для Developer**: в `InventoryTransaction.quantity` хранить всегда абсолютное значение. Для `ADJUSTMENT` добавить вычисляемое направление через note. Или расширить enum типом `ADJUSTMENT_IN`/`ADJUSTMENT_OUT`. Выбор за Developer.

**Response 201**:
```json
{
  "success": true,
  "data": {
    "transactionId": "clzzz",
    "skuId": "clxxx",
    "previousStock": 52,
    "newStockQuantity": 50,
    "delta": -2
  }
}
```

---

#### `GET /api/inventory/transactions` — история транзакций

**Auth**: MANAGER, SUPERADMIN

**Query params**: `?skuId=clxxx&type=SALE&bookingId=clyyy&dateFrom=2026-04-01&dateTo=2026-04-30&page=1&perPage=50`

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "clyyy",
      "skuId": "clxxx",
      "skuName": "Coca-Cola 0.5л",
      "type": "SALE",
      "quantity": 2,
      "bookingId": "clbbb",
      "moduleSlug": "ps-park",
      "performedById": "cluuu",
      "note": null,
      "isVoided": false,
      "createdAt": "2026-04-12T14:00:00.000Z"
    }
  ],
  "meta": { "total": 137, "page": 1, "perPage": 50 }
}
```

---

#### `DELETE /api/inventory/transactions/:id` — аннулировать транзакцию

**Auth**: SUPERADMIN

Устанавливает `isVoided = true` и **обращает эффект** на `stockQuantity`:
- RECEIPT → `stockQuantity -= quantity`
- SALE → `stockQuantity += quantity` (возврат на склад)
- RETURN → `stockQuantity -= quantity`
- ADJUSTMENT → обратная операция
- INITIAL → только если нет других транзакций по SKU

**Request body**: опциональный `note` для объяснения.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "transactionId": "clyyy",
    "isVoided": true,
    "skuId": "clxxx",
    "newStockQuantity": 50
  }
}
```

**Error**:
- `409 TRANSACTION_ALREADY_VOIDED` — транзакция уже аннулирована
- `409 STOCK_WOULD_GO_NEGATIVE` — аннулирование привело бы к отрицательному остатку

---

#### `GET /api/inventory/analytics` — аналитика

**Auth**: SUPERADMIN

**Query params**: `?dateFrom=2026-04-01&dateTo=2026-04-30`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "totalSkus": 15,
    "lowStockSkus": [
      { "id": "clxxx", "name": "Coca-Cola 0.5л", "stockQuantity": 3, "lowStockThreshold": 10 }
    ],
    "salesByModule": {
      "ps-park": { "totalItems": 87, "totalRevenue": "12350.00" },
      "gazebos": { "totalItems": 34, "totalRevenue": "5100.00" }
    },
    "topSkus": [
      { "id": "clxxx", "name": "Coca-Cola 0.5л", "soldQuantity": 45, "revenue": "6750.00" }
    ],
    "period": { "from": "2026-04-01", "to": "2026-04-30" }
  }
}
```

---

#### `GET /api/inventory/health`

**Auth**: нет (internal)

**Response 200**:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "totalSkus": 15,
    "activeSkus": 14,
    "lowStockCount": 2
  }
}
```

---

### Типы TypeScript для `src/modules/inventory/types.ts`

```typescript
import type { InventorySku, InventoryTransaction, InventoryTransactionType } from "@prisma/client";

export type SkuSummary = Pick<
  InventorySku,
  "id" | "name" | "category" | "unit" | "price" | "stockQuantity" | "isActive"
>;

export type CreateSkuInput = {
  name: string;
  category: string;
  unit?: string;
  price: number;
  lowStockThreshold?: number;
  initialStock?: number;
};

export type UpdateSkuInput = Partial<Omit<CreateSkuInput, "initialStock">> & {
  isActive?: boolean;
};

export type ReceiveInput = {
  skuId: string;
  quantity: number;
  note?: string;
};

export type AdjustInput = {
  skuId: string;
  targetQuantity: number;
  note: string; // Обязателен для аудита
};

export type TransactionFilter = {
  skuId?: string;
  type?: InventoryTransactionType;
  bookingId?: string;
  moduleSlug?: string;
  dateFrom?: string;
  dateTo?: string;
  isVoided?: boolean;
  page?: number;
  perPage?: number;
};

// Используется при бронировании (Блок 3)
export type BookingItemInput = {
  skuId: string;
  quantity: number;
};

export type BookingSaleResult = {
  transactionIds: string[];
  totalAmount: number; // сумма позиций: sum(price * quantity)
};
```

---

### Zod-схемы для `src/modules/inventory/validation.ts`

```typescript
import { z } from "zod";

export const createSkuSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  category: z.string().min(1, "Категория обязательна").max(100),
  unit: z.string().max(20).default("шт"),
  price: z.number().positive("Цена должна быть положительной"),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  initialStock: z.number().int().nonnegative().optional(),
});

export const updateSkuSchema = createSkuSchema
  .omit({ initialStock: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

export const receiveSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  note: z.string().max(500).optional(),
});

export const adjustSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  targetQuantity: z.number().int().nonnegative("Целевой остаток не может быть отрицательным"),
  note: z.string().min(1, "Причина корректировки обязательна").max(500),
});

export const transactionFilterSchema = z.object({
  skuId: z.string().optional(),
  type: z.enum(["INITIAL", "RECEIPT", "SALE", "RETURN", "ADJUSTMENT"]).optional(),
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isVoided: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

// Используется в bookingItemSchema (Блок 3)
export const bookingItemSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});
```

---

## Блок 3: Продажи при бронировании

### Концепция хранения

Привязанные к бронированию товары не выносятся в отдельную таблицу. Используется существующее поле `metadata: Json?` модели `Booking`. Это оправдано тому, что:
- Товары при бронировании — вспомогательная информация, не самостоятельная сущность
- Нет необходимости в JOIN по товарам бронирования для типовых запросов
- Списание управляется через `InventoryTransaction.bookingId`, что даёт полный аудит

**Структура `metadata` при наличии товаров**:
```json
{
  "guestCount": 4,
  "comment": "Юбилей",
  "items": [
    { "skuId": "clxxx", "skuName": "Coca-Cola 0.5л", "quantity": 4, "priceAtBooking": "150.00" },
    { "skuId": "clyyy", "skuName": "Пицца Маргарита", "quantity": 1, "priceAtBooking": "550.00" }
  ],
  "itemsTotal": "1150.00"
}
```

`priceAtBooking` и `skuName` снапшотируются на момент бронирования — защита от изменения цены/названия впоследствии.

### Диаграмма потока данных

```
Client/Admin                     API Route                      Service                         DB
     |                               |                              |                             |
     |  POST /api/ps-park/book       |                              |                             |
     |  { resourceId, date, ...      |                              |                             |
     |    items: [{skuId, qty}] }    |                              |                             |
     |------------------------------>|                              |                             |
     |                               | validate (Zod)              |                             |
     |                               | createBooking(userId, input)|                             |
     |                               |----------------------------->|                             |
     |                               |                              | findFirst(resource, active) |
     |                               |                              |---------------------------->|
     |                               |                              |<----------------------------|
     |                               |                              |                             |
     |                               |                              | validateItems(items)        |
     |                               |                              | findMany(InventorySku,      |
     |                               |                              |   { id: { in: skuIds },    |
     |                               |                              |     isActive: true })       |
     |                               |                              |---------------------------->|
     |                               |                              |<----------------------------|
     |                               |                              | checkStock: each qty <= stock|
     |                               |                              | (throw INSUFFICIENT_STOCK   |
     |                               |                              |  if any fails)              |
     |                               |                              |                             |
     |                               |                              | checkConflict(booking)      |
     |                               |                              |---------------------------->|
     |                               |                              |<----------------------------|
     |                               |                              |                             |
     |                               |                              | prisma.$transaction([       |
     |                               |                              |   booking.create(PENDING),  |
     |                               |                              |   -- НЕТ списания пока --  |
     |                               |                              | ])                          |
     |                               |                              |---------------------------->|
     |                               |                              |<---- booking created -------|
     |<------------------------------|                              |                             |
     |  201 { booking }              |                              |                             |
     |                               |                              |                             |
     |                               |                              |                             |
     |  PATCH /api/ps-park/{id}      |                              |                             |
     |  { status: "CONFIRMED" }      |                              |                             |
     |------------------------------>|                              |                             |
     |                               | updateBookingStatus(        |                             |
     |                               |   id, CONFIRMED, managerId) |                             |
     |                               |----------------------------->|                             |
     |                               |                              | findFirst(booking)          |
     |                               |                              |---------------------------->|
     |                               |                              |<---- booking with metadata--|
     |                               |                              |                             |
     |                               |                              | if items in metadata:       |
     |                               |                              |   prisma.$transaction([     |
     |                               |                              |     booking.update(         |
     |                               |                              |       CONFIRMED),           |
     |                               |                              |     for each item:          |
     |                               |                              |       transaction.create(   |
     |                               |                              |         SALE),              |
     |                               |                              |       sku.update(           |
     |                               |                              |         stock -= qty)       |
     |                               |                              |   ])                        |
     |                               |                              |---------------------------->|
     |                               |                              |<---- atomic commit ---------|
     |<------------------------------|                              |                             |
     |  200 { booking }              |                              |                             |
     |                               |                              |                             |
     |                               |                              |                             |
     |  PATCH /api/ps-park/{id}      |                              |                             |
     |  { status: "CANCELLED" }      |                              |                             |
     |------------------------------>|                              |                             |
     |                               | updateBookingStatus(        |                             |
     |                               |   id, CANCELLED, managerId) |                             |
     |                               |----------------------------->|                             |
     |                               |                              | findFirst(booking)          |
     |                               |                              |---------------------------->|
     |                               |                              |<---- booking with metadata--|
     |                               |                              |                             |
     |                               |                              | if wasConfirmed &&          |
     |                               |                              |    items in metadata:       |
     |                               |                              |   prisma.$transaction([     |
     |                               |                              |     booking.update(         |
     |                               |                              |       CANCELLED),           |
     |                               |                              |     for each item:          |
     |                               |                              |       transaction.create(   |
     |                               |                              |         RETURN),            |
     |                               |                              |       sku.update(           |
     |                               |                              |         stock += qty)       |
     |                               |                              |   ])                        |
     |                               |                              |---------------------------->|
     |                               |                              |<---- atomic commit ---------|
     |<------------------------------|                              |                             |
     |  200 { booking }              |                              |                             |
```

### Транзакционность — атомарность списания

Ключевой принцип: **все операции с остатками выполняются через `prisma.$transaction()`**.

#### При CONFIRMED (списание)

```typescript
// Псевдокод внутри updateBookingStatus, когда status === "CONFIRMED"
const items = booking.metadata?.items as BookingItemSnapshotArray | undefined;

if (items && items.length > 0) {
  await prisma.$transaction(async (tx) => {
    // 1. Обновить статус бронирования
    await tx.booking.update({ where: { id }, data: { status: "CONFIRMED", managerId } });

    // 2. Для каждого товара: создать транзакцию SALE и декрементировать остаток
    for (const item of items) {
      // Проверить актуальный остаток внутри транзакции (защита от race condition)
      const sku = await tx.inventorySku.findUnique({
        where: { id: item.skuId },
        select: { stockQuantity: true, isActive: true },
      });

      if (!sku || sku.stockQuantity < item.quantity) {
        throw new InventoryError(
          "INSUFFICIENT_STOCK",
          `Недостаточно товара: ${item.skuName}`
        );
      }

      await tx.inventoryTransaction.create({
        data: {
          skuId: item.skuId,
          type: "SALE",
          quantity: item.quantity,
          bookingId: id,
          moduleSlug: booking.moduleSlug,
          performedById: managerId ?? booking.userId,
          note: `Продажа при бронировании ${id}`,
        },
      });

      await tx.inventorySku.update({
        where: { id: item.skuId },
        data: { stockQuantity: { decrement: item.quantity } },
      });
    }
  });
} else {
  // Нет товаров — обычное обновление статуса
  await prisma.booking.update({ where: { id }, data: { status: "CONFIRMED", managerId } });
}
```

#### При CANCELLED из CONFIRMED (возврат)

```typescript
// Псевдокод: wasConfirmed определяется из booking.status === "CONFIRMED" до смены
const wasConfirmed = booking.status === "CONFIRMED";
const items = booking.metadata?.items as BookingItemSnapshotArray | undefined;

if (wasConfirmed && items && items.length > 0) {
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id }, data: { status: "CANCELLED", cancelReason } });

    for (const item of items) {
      await tx.inventoryTransaction.create({
        data: {
          skuId: item.skuId,
          type: "RETURN",
          quantity: item.quantity,
          bookingId: id,
          moduleSlug: booking.moduleSlug,
          performedById: managerId ?? booking.userId,
          note: `Возврат при отмене бронирования ${id}`,
        },
      });

      await tx.inventorySku.update({
        where: { id: item.skuId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }
  });
}
```

**Защита от race condition**: проверка остатка `sku.stockQuantity < item.quantity` происходит **внутри транзакции** через `tx.inventorySku.findUnique()`. PostgreSQL сериализует конкурентные UPDATE на одну строку, поэтому это безопасно без явных SELECT FOR UPDATE.

### Логика при создании бронирования (PENDING)

При создании бронирования товары **не списываются** — только сохраняются в `metadata`. Причина: бронирование может не подтвердиться. Проверка наличия делается на уровне валидации (мягкая проверка, не блокировка):

```typescript
// В createBooking / createAdminBooking (для обоих модулей)
if (input.items && input.items.length > 0) {
  const skus = await prisma.inventorySku.findMany({
    where: { id: { in: input.items.map(i => i.skuId) }, isActive: true },
    select: { id: true, name: true, price: true, stockQuantity: true },
  });

  if (skus.length !== input.items.length) {
    throw new BookingError("INVALID_SKU", "Один или несколько товаров не найдены или неактивны");
  }

  const itemsSnapshot = input.items.map(item => {
    const sku = skus.find(s => s.id === item.skuId)!;
    // Предупреждение, но не блокировка при PENDING
    return {
      skuId: item.skuId,
      skuName: sku.name,
      quantity: item.quantity,
      priceAtBooking: sku.price.toString(),
    };
  });

  const itemsTotal = input.items.reduce((sum, item) => {
    const sku = skus.find(s => s.id === item.skuId)!;
    return sum + Number(sku.price) * item.quantity;
  }, 0);

  // Добавляем в metadata
  metadata = {
    ...existingMetadata,
    items: itemsSnapshot,
    itemsTotal: itemsTotal.toFixed(2),
  };
}
```

Для `createAdminBooking` в Газебо: бронирование создаётся сразу как `CONFIRMED`, поэтому списание товаров должно происходить **немедленно** при создании, а не отложенно. Логику следует реализовать в `createAdminBooking` аналогично блоку при CONFIRMED.

### Изменения в существующих модулях

#### `src/modules/ps-park/types.ts` — добавить

```typescript
export type BookingItemInput = {
  skuId: string;
  quantity: number;
};

// Добавить items в CreatePSBookingInput
export type CreatePSBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  playerCount?: number;
  comment?: string;
  items?: BookingItemInput[];  // НОВОЕ
};
```

#### `src/modules/ps-park/validation.ts` — обновить схему

```typescript
import { bookingItemSchema } from "@/modules/inventory/validation";

export const createPSBookingSchema = z.object({
  resourceId: z.string().min(1, "ID стола обязателен"),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  endTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  playerCount: z.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
  items: z.array(bookingItemSchema).max(20).optional(),  // НОВОЕ
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);
```

#### `src/modules/gazebos/types.ts` — добавить

```typescript
import type { BookingItemInput } from "@/modules/inventory/types";

// Добавить items в CreateBookingInput и AdminCreateBookingInput
export type CreateBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount?: number;
  comment?: string;
  items?: BookingItemInput[];  // НОВОЕ
};

export type AdminCreateBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount?: number;
  comment?: string;
  clientName: string;
  clientPhone: string;
  items?: BookingItemInput[];  // НОВОЕ
};
```

#### `src/modules/gazebos/validation.ts` — обновить схемы

```typescript
import { bookingItemSchema } from "@/modules/inventory/validation";

// В createBookingSchema добавить:
items: z.array(bookingItemSchema).max(20).optional(),

// В adminCreateBookingSchema добавить:
items: z.array(bookingItemSchema).max(20).optional(),
```

### Обновлённые API контракты для booking-эндпоинтов

#### `POST /api/ps-park/book` — расширенный request body

```json
{
  "resourceId": "clxxx",
  "date": "2026-04-15",
  "startTime": "14:00",
  "endTime": "16:00",
  "playerCount": 2,
  "comment": "День рождения",
  "items": [
    { "skuId": "clyyy", "quantity": 4 },
    { "skuId": "clzzz", "quantity": 1 }
  ]
}
```

**Response 201** — без изменений по структуре. Товары видны в `metadata`:
```json
{
  "success": true,
  "data": {
    "id": "clbbb",
    "moduleSlug": "ps-park",
    "resourceId": "clxxx",
    "status": "PENDING",
    "metadata": {
      "playerCount": 2,
      "comment": "День рождения",
      "items": [
        { "skuId": "clyyy", "skuName": "Coca-Cola 0.5л", "quantity": 4, "priceAtBooking": "150.00" },
        { "skuId": "clzzz", "skuName": "Пицца Маргарита", "quantity": 1, "priceAtBooking": "550.00" }
      ],
      "itemsTotal": "1150.00"
    },
    "createdAt": "2026-04-12T10:00:00.000Z"
  }
}
```

**Новые ошибки**:
- `422 INVALID_SKU` — один или несколько товаров не найдены/неактивны
- `422 VALIDATION_ERROR` — более 20 позиций в items

---

#### `POST /api/gazebos/book` — аналогично ps-park/book (только `guestCount` вместо `playerCount`)

#### `POST /api/gazebos/admin-book` — расширенный request body

```json
{
  "resourceId": "clxxx",
  "date": "2026-04-15",
  "startTime": "18:00",
  "endTime": "22:00",
  "guestCount": 8,
  "clientName": "Иванова Мария",
  "clientPhone": "+7 999 123-45-67",
  "items": [
    { "skuId": "clyyy", "quantity": 8 }
  ]
}
```

**Важно**: для `admin-book` бронирование создаётся как `CONFIRMED`, поэтому товары списываются **при создании**, а не при отдельном подтверждении. Response включает полный объект бронирования с metadata.

---

### Класс ошибок для `src/modules/inventory/service.ts`

```typescript
export class InventoryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InventoryError";
  }
}

// Коды:
// INSUFFICIENT_STOCK      — недостаточно остатка
// SKU_NOT_FOUND           — SKU не найден
// SKU_INACTIVE            — SKU неактивен
// TRANSACTION_NOT_FOUND   — транзакция не найдена
// TRANSACTION_ALREADY_VOIDED — транзакция уже аннулирована
// STOCK_WOULD_GO_NEGATIVE — аннулирование приведёт к отрицательному остатку
```

---

## Seed-данные для модуля инвентаря

Добавить в `scripts/seed.ts`:

```typescript
// === MODULES: добавить inventory ===
await prisma.module.upsert({
  where: { slug: "inventory" },
  update: {},
  create: {
    slug: "inventory",
    name: "Инвентарь",
    description: "Управление товарными остатками для PS Park и Беседок",
    isActive: true,
  },
});

// === INVENTORY SKUs ===
const inventorySkus = [
  // Напитки
  { name: "Coca-Cola 0.5л", category: "Напитки", unit: "шт", price: 150, lowStockThreshold: 10, initialStock: 48 },
  { name: "Pepsi 0.5л", category: "Напитки", unit: "шт", price: 150, lowStockThreshold: 10, initialStock: 36 },
  { name: "Fanta 0.5л", category: "Напитки", unit: "шт", price: 150, lowStockThreshold: 10, initialStock: 24 },
  { name: "Sprite 0.5л", category: "Напитки", unit: "шт", price: 150, lowStockThreshold: 10, initialStock: 24 },
  { name: "Вода питьевая 0.5л", category: "Напитки", unit: "шт", price: 80, lowStockThreshold: 20, initialStock: 96 },
  { name: "Энергетик Tornado", category: "Напитки", unit: "шт", price: 200, lowStockThreshold: 5, initialStock: 24 },
  { name: "Сок яблочный 0.2л", category: "Напитки", unit: "шт", price: 100, lowStockThreshold: 10, initialStock: 36 },
  // Еда
  { name: "Пицца Маргарита (30см)", category: "Еда", unit: "шт", price: 550, lowStockThreshold: 2, initialStock: 0 },
  { name: "Пицца Пепперони (30см)", category: "Еда", unit: "шт", price: 650, lowStockThreshold: 2, initialStock: 0 },
  { name: "Чипсы Lay's классик", category: "Еда", unit: "пачка", price: 120, lowStockThreshold: 10, initialStock: 30 },
  { name: "Орехи ассорти 100г", category: "Еда", unit: "пачка", price: 180, lowStockThreshold: 5, initialStock: 20 },
  // Аксессуары PS Park
  { name: "Дополнительный геймпад", category: "Аксессуары", unit: "шт", price: 200, lowStockThreshold: 1, initialStock: 10 },
  { name: "Наушники игровые", category: "Аксессуары", unit: "шт", price: 150, lowStockThreshold: 1, initialStock: 6 },
];

for (const item of inventorySkus) {
  const existing = await prisma.inventorySku.findFirst({
    where: { name: item.name, category: item.category },
  });

  if (!existing) {
    const sku = await prisma.inventorySku.create({
      data: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        price: item.price,
        lowStockThreshold: item.lowStockThreshold,
        stockQuantity: item.initialStock,
      },
    });

    if (item.initialStock > 0) {
      await prisma.inventoryTransaction.create({
        data: {
          skuId: sku.id,
          type: "INITIAL",
          quantity: item.initialStock,
          performedById: admin.id, // переменная admin из начала seed
          note: "Начальный остаток при запуске системы",
        },
      });
    }

    console.log(`  ✓ SKU: ${item.name} (остаток: ${item.initialStock})`);
  }
}

// === ADMIN SECTION: добавить inventory ===
// В setUserAdminSections или ADMIN_SECTIONS добавить "inventory" секцию
// (изменение в src/lib/permissions.ts, не в seed)
```

---

## Изменения в `src/lib/permissions.ts`

Добавить секцию `inventory` в `ADMIN_SECTIONS`:

```typescript
{ slug: "inventory", label: "Инвентарь", icon: "📦" },
```

---

## Резюме изменений по файлам

| Файл | Тип изменения | Блок |
|------|--------------|------|
| `prisma/schema.prisma` | Добавить `InventorySku`, `InventoryTransaction`, `InventoryTransactionType` | 2 |
| `prisma/migrations/...` | `prisma migrate dev --name add_inventory` | 2 |
| `src/lib/permissions.ts` | Добавить `"inventory"` в `ADMIN_SECTIONS` | 2 |
| `src/modules/inventory/service.ts` | Создать (новый модуль) | 2 |
| `src/modules/inventory/types.ts` | Создать (новый модуль) | 2 |
| `src/modules/inventory/validation.ts` | Создать (новый модуль) | 2 |
| `src/modules/inventory/__tests__/service.test.ts` | Создать (тесты) | 2 |
| `src/modules/inventory/__tests__/validation.test.ts` | Создать (тесты) | 2 |
| `src/app/api/inventory/route.ts` | Создать | 2 |
| `src/app/api/inventory/health/route.ts` | Создать | 2 |
| `src/app/api/inventory/sku/route.ts` | Создать | 2 |
| `src/app/api/inventory/sku/[id]/route.ts` | Создать | 2 |
| `src/app/api/inventory/receive/route.ts` | Создать | 2 |
| `src/app/api/inventory/adjust/route.ts` | Создать | 2 |
| `src/app/api/inventory/transactions/route.ts` | Создать | 2 |
| `src/app/api/inventory/transactions/[id]/route.ts` | Создать | 2 |
| `src/app/api/inventory/analytics/route.ts` | Создать | 2 |
| `src/app/api/ps-park/[id]/route.ts` | Изменить (защита pricePerHour) | 1 |
| `src/modules/ps-park/types.ts` | Изменить (добавить `items` в input) | 3 |
| `src/modules/ps-park/validation.ts` | Изменить (добавить `items` в схему) | 3 |
| `src/modules/ps-park/service.ts` | Изменить (`createBooking` + `updateBookingStatus`) | 3 |
| `src/modules/ps-park/__tests__/service.test.ts` | Изменить (тесты для items) | 3 |
| `src/modules/gazebos/types.ts` | Изменить (добавить `items` в input) | 3 |
| `src/modules/gazebos/validation.ts` | Изменить (добавить `items` в схемы) | 3 |
| `src/modules/gazebos/service.ts` | Изменить (`createBooking`, `createAdminBooking`, `updateBookingStatus`) | 3 |
| `src/modules/gazebos/__tests__/service.test.ts` | Изменить (тесты для items) | 3 |
| `scripts/seed.ts` | Добавить inventory module + SKUs | 2 |

---

## Открытые вопросы для обсуждения

1. **Пицца**: `stockQuantity = 0` для позиций Еда — пицца готовится по заказу. Механизм: либо всегда `initialStock = 0` и пополняется менеджером перед сменой, либо убрать пиццу из инвентаря и обрабатывать через кафе-модуль. Рекомендую второй вариант для MVP.

2. **Уведомления при низком остатке**: аналитика покажет `lowStockSkus`, но активных алертов менеджеру пока нет. Можно добавить в `inventory/service.ts` проверку после `SALE` и отправку через `enqueueNotification` при `stockQuantity <= lowStockThreshold`. Объём работы: 1-2 часа.

3. **Отображение товаров в UI**: панели менеджера PS Park и Газебо потребуют обновления для показа `metadata.items` в карточке бронирования. Это UI-задача, выходящая за рамки этого ADR.

4. **Максимум 20 позиций в items**: произвольное ограничение. Если нужно больше — изменить в `bookingItemSchema`.
