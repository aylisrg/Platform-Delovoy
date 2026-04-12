# ADR: Инвентарь — приход товара с кастомным названием, датой и очистка тестовых данных

**Дата**: 2026-04-12  
**Статус**: Принято  
**Автор**: System Architect  
**Затрагивает модули**: `inventory`

---

## Контекст

Четыре независимых, но связанных изменения, вытекающих из PRD:

1. **US-1/2**: Форма прихода товара с **кастомным названием** — найти SKU по имени или создать новый, сразу записать остаток.
2. **US-3**: Фактическая дата прихода (`receivedAt`) — пользователь сам указывает дату; будущие даты запрещены; поле хранится в `InventoryTransaction`.
3. **US-4**: История приходов — новый endpoint `GET /api/inventory/receipts`, новый компонент таблицы.
4. **US-5**: Скрипт очистки тестовых данных — `scripts/clear-test-inventory.ts`.

---

## Блок 1: Миграция схемы БД

### Проблема (US-3, AC-3.1, AC-3.4)

`InventoryTransaction.createdAt` — системное время вставки записи. Пользователи хотят указывать **фактическую дату прихода** товара (например, вчерашний день). Нужно отдельное поле.

### Решение

Добавить nullable поле `receivedAt DateTime?` в модель `InventoryTransaction`. Значение `null` означает: дата не указана, при отображении fallback на `createdAt` (AC-3.4 — существующие транзакции не ломаются).

### Изменение `prisma/schema.prisma`

```prisma
model InventoryTransaction {
  id            String                   @id @default(cuid())
  skuId         String
  sku           InventorySku             @relation(fields: [skuId], references: [id])
  type          InventoryTransactionType
  quantity      Int
  bookingId     String?
  moduleSlug    String?
  performedById String
  note          String?
  isVoided      Boolean                  @default(false)
  receivedAt    DateTime?                // <-- NEW: фактическая дата прихода (только RECEIPT/INITIAL)
  createdAt     DateTime                 @default(now())

  @@index([skuId, createdAt])
  @@index([bookingId])
  @@index([type, isVoided])
  @@index([type, receivedAt])  // <-- NEW: для сортировки истории приходов
}
```

### Миграция

```sql
-- Migration: add_received_at_to_inventory_transaction
ALTER TABLE "InventoryTransaction" ADD COLUMN "receivedAt" TIMESTAMP(3);
CREATE INDEX "InventoryTransaction_type_receivedAt_idx" ON "InventoryTransaction"("type", "receivedAt");
```

Команда для генерации:
```bash
npx prisma migrate dev --name add_received_at_to_inventory_transaction
```

Существующие строки получат `receivedAt = NULL`. Приложение обрабатывает это через fallback: `receivedAt ?? createdAt`.

---

## Блок 2: Изменения в `validation.ts`

### Требование (US-3, AC-3.2, AC-3.3; US-2, AC-2.3)

- Поле `receivedAt`: строка формата `YYYY-MM-DD`, не может быть в будущем.
- Поле `name`: уже ограничено 200 символами (AC-2.3 — ок, покрыто).
- Поле `quantity`: уже `int().positive()` (AC-1.3 — ок).

### Изменение `src/modules/inventory/validation.ts`

```typescript
// Добавить вспомогательную функцию
const todayISO = () => new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

// Заменить существующий receiveSchema
export const receiveSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  note: z.string().max(500).optional(),
  receivedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD")
    .refine(
      (val) => val <= todayISO(),
      "Будущие даты прихода запрещены"
    )
    .optional(), // optional — если не передано, service использует текущую дату
});
```

**Примечание**: клиент передаёт `receivedAt` как `"2026-04-11"`. Если поле не передано, сервис подставляет `new Date()` (AC-1.2: по умолчанию = сегодня задаётся на фронте, но сервер всегда принимает явное значение).

---

## Блок 3: Изменения в `types.ts`

### Изменение `src/modules/inventory/types.ts`

```typescript
// Обновить ReceiveInput
export type ReceiveInput = {
  skuId: string;
  quantity: number;
  note?: string;
  receivedAt?: Date; // <-- NEW
};

// Новый тип для строки истории приходов
export type ReceiptHistoryRow = {
  id: string;
  skuId: string;
  skuName: string;
  type: "RECEIPT" | "INITIAL";
  quantity: number;
  note: string | null;
  performedById: string;
  performedByName: string | null;
  receivedAt: string; // ISO string — receivedAt ?? createdAt (fallback)
  createdAt: string;
};
```

---

## Блок 4: Изменения в `service.ts`

### Требование (US-2, AC-2.1, AC-2.2; US-3, AC-3.1)

Функция `receiveStockByName` должна:
1. Принять `receivedAt?: Date` и передать в транзакцию.
2. Если `receivedAt` не передан — использовать `new Date()`.

### Изменение `src/modules/inventory/service.ts`

```typescript
/**
 * Receive stock by free-text name.
 * Finds existing SKU by name (case-insensitive) or creates a new one.
 * receivedAt — фактическая дата прихода (AC-3.1). Fallback — текущая дата.
 */
export async function receiveStockByName(
  name: string,
  quantity: number,
  note: string | undefined,
  performedById: string,
  receivedAt?: Date  // <-- NEW parameter
) {
  const effectiveReceivedAt = receivedAt ?? new Date();

  const existing = await prisma.inventorySku.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  return prisma.$transaction(async (tx) => {
    let skuId: string;
    let newStockQuantity: number;

    if (existing) {
      skuId = existing.id;
      await tx.inventoryTransaction.create({
        data: {
          skuId,
          type: "RECEIPT",
          quantity,
          performedById,
          note,
          receivedAt: effectiveReceivedAt,  // <-- NEW
        },
      });
      const updated = await tx.inventorySku.update({
        where: { id: skuId },
        data: { stockQuantity: { increment: quantity } },
        select: { stockQuantity: true },
      });
      newStockQuantity = updated.stockQuantity;
    } else {
      const sku = await tx.inventorySku.create({
        data: {
          name,
          category: "Товары",
          unit: "шт",
          price: 0,
          stockQuantity: quantity,
          lowStockThreshold: 5,
        },
      });
      skuId = sku.id;
      await tx.inventoryTransaction.create({
        data: {
          skuId,
          type: "INITIAL",
          quantity,
          performedById,
          note: note ?? "Первый приход",
          receivedAt: effectiveReceivedAt,  // <-- NEW
        },
      });
      newStockQuantity = quantity;
    }

    return { skuId, newStockQuantity, name };
  });
}
```

**Также добавить** функцию `listReceipts` для US-4:

```typescript
/**
 * List the last 50 RECEIPT and INITIAL transactions, sorted by receivedAt desc.
 * Falls back to createdAt for rows where receivedAt is null (AC-3.4).
 */
export async function listReceipts(limit = 50): Promise<ReceiptHistoryRow[]> {
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      type: { in: ["RECEIPT", "INITIAL"] },
      isVoided: false,
    },
    include: {
      sku: { select: { name: true } },
      // User name — performedById is a User.id
    },
    orderBy: [
      { receivedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: limit,
  });

  // Fetch performer names in one query
  const userIds = [...new Set(rows.map((r) => r.performedById))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    skuId: r.skuId,
    skuName: r.sku.name,
    type: r.type as "RECEIPT" | "INITIAL",
    quantity: r.quantity,
    note: r.note,
    performedById: r.performedById,
    performedByName: userMap.get(r.performedById) ?? null,
    receivedAt: (r.receivedAt ?? r.createdAt).toISOString(), // fallback (AC-3.4)
    createdAt: r.createdAt.toISOString(),
  }));
}
```

**Сортировка**: `orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }]` — Prisma сортирует NULL последними при `desc`. Для строк без `receivedAt` они естественно окажутся ниже. Если нужна единая сортировка по `effectiveDate = COALESCE(receivedAt, createdAt)`, использовать raw query:

```typescript
// Альтернатива с raw query (только если порядок NULL-строк критичен):
const rows = await prisma.$queryRaw<...>`
  SELECT it.*, is.name as "skuName"
  FROM "InventoryTransaction" it
  JOIN "InventorySku" is ON it."skuId" = is.id
  WHERE it.type IN ('RECEIPT', 'INITIAL') AND it."isVoided" = false
  ORDER BY COALESCE(it."receivedAt", it."createdAt") DESC
  LIMIT ${limit}
`;
```

Рекомендация: начать с Prisma ORM-вариантом. Если порядок NULL-строк будет визуально нарушен — перейти на raw.

---

## Блок 5: API-контракты

### 5.1 Расширенный `POST /api/inventory/receive`

**Метод**: `POST`  
**URL**: `/api/inventory/receive`  
**Доступ**: MANAGER, SUPERADMIN (AC-1.6)

#### Request Body

```json
{
  "name": "Coca-Cola 0.5л",      // string, 1–200 символов, обязательно (AC-1.3, AC-2.3)
  "quantity": 24,                  // integer > 0, обязательно (AC-1.3)
  "note": "Партия от 11 апреля",  // string, ≤500, опционально
  "receivedAt": "2026-04-11"      // YYYY-MM-DD, ≤ today, опционально (AC-1.2, AC-3.3)
}
```

#### Success Response `201`

```json
{
  "success": true,
  "data": {
    "skuId": "clxxx123",
    "name": "Coca-Cola 0.5л",
    "newStockQuantity": 48,        // текущий остаток после прихода (AC-1.4)
    "isNewSku": false              // true если SKU был создан (AC-2.2)
  }
}
```

**Поле `isNewSku`**: добавить в возврат `receiveStockByName` — `isNewSku: !existing`.

#### Error Responses

| HTTP | code | Условие |
|------|------|---------|
| 401 | `UNAUTHORIZED` | Не авторизован |
| 403 | `FORBIDDEN` | Роль USER |
| 422 | `VALIDATION_ERROR` | Пустое name/quantity, будущая дата, превышение длины |
| 500 | `INTERNAL_ERROR` | БД недоступна |

#### Изменение route handler `src/app/api/inventory/receive/route.ts`

```typescript
const result = await receiveStockByName(
  parsed.data.name,
  parsed.data.quantity,
  parsed.data.note,
  session.user.id,
  parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : undefined  // <-- NEW
);

// Изменить возвращаемые данные:
return apiResponse(
  {
    skuId: result.skuId,
    name: result.name,
    newStockQuantity: result.newStockQuantity,
    isNewSku: result.isNewSku,
  },
  undefined,
  201
);
```

---

### 5.2 Новый `GET /api/inventory/receipts`

**Метод**: `GET`  
**URL**: `/api/inventory/receipts`  
**Доступ**: MANAGER, SUPERADMIN (AC-1.6)

#### Query Params

Нет обязательных. В MVP возвращаем последние 50 записей (AC-4.2).

#### Success Response `200`

```json
{
  "success": true,
  "data": [
    {
      "id": "clxxx456",
      "skuId": "clxxx123",
      "skuName": "Coca-Cola 0.5л",
      "type": "RECEIPT",
      "quantity": 24,
      "note": "Партия от 11 апреля",
      "performedByName": "Иван Петров",
      "receivedAt": "2026-04-11T00:00:00.000Z",
      "createdAt": "2026-04-12T10:30:00.000Z"
    }
  ],
  "meta": { "total": 1 }
}
```

**`receivedAt`** — `receivedAt ?? createdAt` из БД (AC-3.4).  
**`performedByName`** — имя пользователя из таблицы `User` (AC-4.1: "Кто записал").

#### Error Responses

| HTTP | code | Условие |
|------|------|---------|
| 401 | `UNAUTHORIZED` | Не авторизован |
| 403 | `FORBIDDEN` | Роль USER |
| 500 | `INTERNAL_ERROR` | БД недоступна |

#### Файл: `src/app/api/inventory/receipts/route.ts` (новый)

```typescript
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { listReceipts } from "@/modules/inventory/service";

/**
 * GET /api/inventory/receipts — history of RECEIPT + INITIAL transactions (MANAGER, SUPERADMIN)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") {
      return apiForbidden();
    }

    const rows = await listReceipts(50);
    return apiResponse(rows, { total: rows.length });
  } catch {
    return apiServerError();
  }
}
```

---

## Блок 6: UI — `/admin/inventory/page.tsx`

### Требование (US-1, AC-1.1–1.5; US-4, AC-4.1–4.3; US-3, AC-3.3)

Страница `/admin/inventory` содержит:
1. **Форму прихода** (верхняя часть).
2. **Таблицу истории** (нижняя часть).
Таблица загружается независимо от формы (AC-4.3).

### Структура компонентов

```
src/app/(admin)/inventory/
└── page.tsx          — Server Component, проверяет сессию, рендерит layout
    ├── InventoryReceiveForm   — Client Component ("use client")
    │   ├── Поле: Название товара (text input, maxLength=200)
    │   ├── Поле: Количество (number input, min=1, integer)
    │   ├── Поле: Дата прихода (date input, max=today, default=today)
    │   ├── Поле: Примечание (textarea, optional, maxLength=500)
    │   ├── Кнопка: "Записать приход"
    │   ├── Inline-ошибки под полями (AC-1.3, AC-2.3, AC-3.3)
    │   └── Зелёный баннер успеха (AC-1.4), сброс формы (AC-1.5)
    └── InventoryReceiptsTable — Client Component ("use client")
        ├── Заголовки: Дата прихода | Название товара | Кол-во | Примечание | Кто записал
        ├── Сортировка: по receivedAt desc
        ├── Загрузка независима от формы (AC-4.3)
        └── Обновление после успешной отправки формы
```

### Логика `InventoryReceiveForm`

```typescript
// Валидация на клиенте (перед отправкой):
const today = new Date().toISOString().slice(0, 10);

// Поле name:
if (!name.trim()) setError("name", "Название обязательно");
if (name.length > 200) setError("name", "Не более 200 символов");

// Поле quantity:
if (!quantity || quantity < 1) setError("quantity", "Количество должно быть больше 0");
if (!Number.isInteger(quantity)) setError("quantity", "Только целые числа");

// Поле receivedAt:
if (receivedAt > today) setError("receivedAt", "Будущие даты запрещены");

// Дефолт для receivedAt:
const [receivedAt, setReceivedAt] = useState<string>(today);
```

**После успешного ответа** (`result.success === true`):
1. Показать зелёный баннер: `"Приход записан: {name}, +{quantity} шт. Текущий остаток: {newStockQuantity} шт."` (AC-1.4)
2. Очистить форму, сбросить `receivedAt` в today (AC-1.5)
3. Вызвать `onReceiptAdded()` → таблица перезагружается (AC-4.3: изолированно)

### Логика `InventoryReceiptsTable`

```typescript
// Загрузка при монтировании + после каждого нового прихода:
const [rows, setRows] = useState<ReceiptHistoryRow[]>([]);
const [error, setError] = useState<string | null>(null);
const [loading, setLoading] = useState(true);

async function load() {
  try {
    setLoading(true);
    const res = await fetch("/api/inventory/receipts");
    const json = await res.json();
    if (json.success) setRows(json.data);
    else setError("Не удалось загрузить историю приходов");
  } catch {
    setError("Ошибка сети при загрузке истории");
  } finally {
    setLoading(false);
  }
}

// Ошибка таблицы НЕ блокирует форму (AC-4.3) — они в разных компонентах
```

### Шапка таблицы (AC-4.1)

| Дата прихода | Название товара | Количество | Примечание | Кто записал |
|---|---|---|---|---|
| `receivedAt` (форматированная) | `skuName` | `+quantity шт` | `note` или `—` | `performedByName` или `—` |

---

## Блок 7: Скрипт очистки тестовых данных

### Требование (US-5, AC-5.1–5.5)

**Файл**: `scripts/clear-test-inventory.ts`  
**Команда**: `npm run clear-test-inventory` (добавить в `package.json`)

### Стратегия определения тестовых данных (AC-5.4)

Тестовые SKU определяются по одному из признаков:
1. Название содержит маркер: `Test`, `Тест`, `test`, `тест`, `demo`, `Demo`.
2. Или SKU создан **до** порога продакшн-даты — константа `PROD_CUTOFF_DATE`.

**`PROD_CUTOFF_DATE`** = дата первого реального прихода в продакшн (задаётся явно в скрипте, например `"2026-04-01T00:00:00Z"`). Всё, что создано до этой даты, считается тестом.

Это двухслойная защита: по имени + по дате. Производственные данные с неудачными именами, созданные после PROD_CUTOFF_DATE, не затрагиваются.

### Логика скрипта

```typescript
#!/usr/bin/env ts-node

import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

// Дата: всё до этого момента считается тестом (настроить перед запуском)
const PROD_CUTOFF_DATE = new Date("2026-04-01T00:00:00Z");

// Паттерны в именах тестовых SKU
const TEST_NAME_PATTERNS = ["test", "тест", "demo", "демо", "TEST", "ТЕСТ"];

async function findTestSkus() {
  return prisma.inventorySku.findMany({
    where: {
      OR: [
        // По имени — case-insensitive через contains
        ...TEST_NAME_PATTERNS.map((p) => ({
          name: { contains: p, mode: "insensitive" as const },
        })),
        // По дате создания до порога
        { createdAt: { lt: PROD_CUTOFF_DATE } },
      ],
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { transactions: true } },
    },
  });
}

async function main() {
  const testSkus = await findTestSkus();

  if (testSkus.length === 0) {
    console.log("Тестовых данных не найдено. Ничего не удалено."); // AC-5.5
    await prisma.$disconnect();
    return;
  }

  // Вывести список (AC-5.2)
  console.log(`\nНайдено тестовых SKU для удаления: ${testSkus.length}`);
  console.log("─".repeat(60));
  let totalTransactions = 0;
  for (const sku of testSkus) {
    console.log(
      `  [${sku.createdAt.toISOString().slice(0, 10)}] "${sku.name}" — ${sku._count.transactions} транзакций`
    );
    totalTransactions += sku._count.transactions;
  }
  console.log("─".repeat(60));
  console.log(`Итого: ${testSkus.length} SKU, ${totalTransactions} транзакций\n`);

  // Запросить подтверждение (AC-5.2)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Удалить? Введите "yes" для подтверждения: ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Отменено.");
    await prisma.$disconnect();
    return;
  }

  // Удаление: сначала транзакции, потом SKU (FK constraint)
  const skuIds = testSkus.map((s) => s.id);

  const deletedTx = await prisma.inventoryTransaction.deleteMany({
    where: { skuId: { in: skuIds } },
  });
  const deletedSku = await prisma.inventorySku.deleteMany({
    where: { id: { in: skuIds } },
  });

  // Итог (AC-5.3)
  console.log(`\nГотово. Удалено: ${deletedSku.count} SKU, ${deletedTx.count} транзакций.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Ошибка:", e);
  await prisma.$disconnect();
  process.exit(1);
});
```

### Добавление в `package.json`

```json
{
  "scripts": {
    "clear-test-inventory": "ts-node --project tsconfig.json scripts/clear-test-inventory.ts"
  }
}
```

---

## Финальная сверка: PRD → ADR

| User Story | Acceptance Criteria | Покрытие в ADR |
|---|---|---|
| **US-1** Форма прихода | AC-1.1: поля name, qty, note, date на `/admin/inventory` | Блок 6: структура компонентов |
| | AC-1.2: default=today, запрет будущих дат | Блок 2: `receiveSchema`, Блок 6: `useState(today)` |
| | AC-1.3: inline-ошибки при пустом name/qty | Блок 6: client-side validation |
| | AC-1.4: зелёный баннер с остатком | Блок 5.1: поле `newStockQuantity` в ответе; Блок 6: баннер |
| | AC-1.5: очистка формы | Блок 6: сброс после успеха |
| | AC-1.6: только MANAGER/SUPERADMIN | Блок 5.1: auth check в route handler |
| **US-2** Кастомное название | AC-2.1: найти SKU → RECEIPT + increment | Блок 4: ветка `if (existing)` в `receiveStockByName` |
| | AC-2.2: не найден → новый SKU + INITIAL | Блок 4: ветка `else` в `receiveStockByName` |
| | AC-2.3: name ≤ 200, ошибка на клиенте | Блок 2: `z.string().max(200)`, Блок 6: client validation |
| **US-3** Фактическая дата | AC-3.1: сохранить `receivedAt` из формы | Блок 1: поле в схеме; Блок 4: `receiveStockByName(…, receivedAt)` |
| | AC-3.2: таблица использует `receivedAt` | Блок 4: `listReceipts` — поле `receivedAt` в результате |
| | AC-3.3: будущие даты запрещены | Блок 2: `.refine(val => val <= todayISO())` |
| | AC-3.4: fallback для старых транзакций | Блок 1: `receivedAt DateTime?` (nullable); Блок 4: `r.receivedAt ?? r.createdAt` |
| **US-4** История приходов | AC-4.1: колонки Дата/Название/Кол-во/Примечание/Кто | Блок 5.2: API ответ; Блок 6: шапка таблицы |
| | AC-4.2: последние 50, RECEIPT+INITIAL, desc | Блок 4: `listReceipts(50)`, `type IN (…)`, `orderBy receivedAt desc` |
| | AC-4.3: ошибка таблицы не блокирует форму | Блок 6: изолированные компоненты |
| **US-5** Очистка тестов | AC-5.1: скрипт + `npm run clear-test-inventory` | Блок 7: файл и script в package.json |
| | AC-5.2: список + подтверждение "yes" | Блок 7: вывод списка + `readline` |
| | AC-5.3: итог удаления | Блок 7: `console.log` с count |
| | AC-5.4: только тестовые, продакшн не трогает | Блок 7: двойной фильтр (имя + PROD_CUTOFF_DATE) |
| | AC-5.5: нет данных → "Ничего не удалено" | Блок 7: ранний return |

---

## Порядок реализации

1. **Миграция БД** — `prisma migrate dev` (Блок 1). Безопасна: nullable поле, без breaking changes.
2. **`validation.ts`** — добавить `receivedAt` в `receiveSchema` (Блок 2).
3. **`types.ts`** — добавить `receivedAt` в `ReceiveInput`, добавить `ReceiptHistoryRow` (Блок 3).
4. **`service.ts`** — обновить сигнатуру `receiveStockByName`, добавить `listReceipts` (Блок 4).
5. **Route handler** `receive/route.ts` — передать `receivedAt`, обновить тело ответа (Блок 5.1).
6. **Новый route** `receipts/route.ts` — `GET /api/inventory/receipts` (Блок 5.2).
7. **UI** `/admin/inventory/page.tsx` — форма + таблица (Блок 6).
8. **Скрипт** `scripts/clear-test-inventory.ts` + `package.json` (Блок 7).
9. **Тесты** — обновить `src/modules/inventory/__tests__/service.test.ts`, `validation.test.ts`.

---

## Тестирование (по требованиям CLAUDE.md)

### Unit-тесты `src/modules/inventory/__tests__/service.test.ts`

- `receiveStockByName` с `receivedAt` — проверить, что значение пробрасывается в `create` call.
- `receiveStockByName` без `receivedAt` — проверить, что используется `new Date()` (мокировать `Date`).
- `listReceipts` — проверить fallback `receivedAt ?? createdAt` для транзакций с `receivedAt: null`.
- `listReceipts` — проверить сортировку: строки с `receivedAt` идут раньше `null`-строк.

### Unit-тесты `src/modules/inventory/__tests__/validation.test.ts`

- `receiveSchema.parse({ name: "X", quantity: 1, receivedAt: "2026-04-11" })` — ok.
- `receiveSchema.parse({ name: "X", quantity: 1, receivedAt: "2099-01-01" })` — ошибка "Будущие даты запрещены".
- `receiveSchema.parse({ name: "X", quantity: 1 })` — ok (receivedAt optional).
- `receiveSchema.parse({ name: "", quantity: 1 })` — ошибка "Название обязательно".
- `receiveSchema.parse({ name: "X".repeat(201), quantity: 1 })` — ошибка max(200).

### Integration-тест `POST /api/inventory/receive`

- Happy path с `receivedAt` — 201, `isNewSku: false`.
- Happy path без `receivedAt` — 201, дата в ответе ≈ now.
- Новый SKU — 201, `isNewSku: true`.
- Будущая дата — 422.
- Без авторизации — 401.
- Роль USER — 403.

### Integration-тест `GET /api/inventory/receipts`

- Happy path — 200, массив строк с полями из AC-4.1.
- Без авторизации — 401.
- Роль USER — 403.
