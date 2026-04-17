# ADR: Система скидок при чекауте (Беседки + PlayStation Park)

## Статус
Предложено

## Контекст

Менеджеры применяют скидки при чекауте "мимо системы" -- занижают `cashAmount` без записи причины. Владелец не видит, сколько и кому дали скидок. Нужна фиксация скидки с причиной, процентом, пересчётом суммы и записью в аудит-лог. Подробности -- в PRD `2026-04-17-checkout-discount-system-prd.md`.

Затрагиваемые модули: `gazebos`, `ps-park`.

---

## Варианты

### Вариант A: Отдельная таблица `Discount`

Новая модель `Discount` с FK на `Booking`, хранение процента, причины, суммы.

- Плюсы: реляционная целостность, легко строить агрегаты через SQL.
- Минусы: требуется миграция БД; скидка -- не самостоятельная сущность, а атрибут чекаута; аналитика по скидкам уже покрывается `AuditLog`; PO явно отклонил этот вариант.

### Вариант B: JSONB в `Booking.metadata` + `AuditLog` (выбран)

Данные скидки хранятся в `Booking.metadata.discount`. Аналитика -- через `AuditLog` с `action = "booking.discount_applied"`. Миграция БД не нужна.

- Плюсы: ноль миграций; данные рядом с бронированием; `AuditLog` уже отфильтровывается в UI; PO одобрил.
- Минусы: для сложных SQL-агрегатов по скидкам нужен `jsonb_extract_path`; но это закрывается через Phase 5.3 (аналитический дашборд).

## Решение

Выбран **Вариант B**. Обоснование: скидка -- атрибут одного чекаута; данные пишутся атомарно в одной транзакции; аудит-лог покрывает потребности отчётности на текущем этапе; ноль миграций = минимальный риск при запуске.

---

## Детальная спецификация

### 1. Справочник причин скидки

```typescript
// Файл: src/modules/booking/discount.ts (НОВЫЙ)

export const DISCOUNT_REASONS = [
  "permanent_client",     // Постоянный клиент
  "corporate",            // Корпоративная скидка
  "promo",                // Акция / промо
  "compensation",         // Компенсация за неудобство
  "other",                // Другое (требует discountNote)
] as const;

export type DiscountReason = typeof DISCOUNT_REASONS[number];

export const DISCOUNT_REASON_LABELS: Record<DiscountReason, string> = {
  permanent_client: "Постоянный клиент",
  corporate: "Корпоративная скидка",
  promo: "Акция / промо",
  compensation: "Компенсация за неудобство",
  other: "Другое",
};

/** Лимит скидки по умолчанию, если в Module.config не задан maxDiscountPercent */
export const DEFAULT_MAX_DISCOUNT_PERCENT = 30;
```

### 2. Структура `Booking.metadata.discount` (JSON Schema)

```typescript
// Добавляется в src/modules/booking/types.ts → BookingMetadata

export type BookingDiscount = {
  percent: number;          // 1..maxDiscountPercent, целое
  amount: string;           // decimal string, e.g. "167.00" — сумма скидки в рублях
  originalAmount: string;   // decimal string — сумма ДО скидки
  finalAmount: string;      // decimal string — сумма ПОСЛЕ скидки
  reason: DiscountReason;   // из справочника
  note?: string;            // обязательно если reason === "other", минимум 5 символов
  appliedBy: string;        // userId менеджера (из session, НЕ из body)
  appliedAt: string;        // ISO 8601 datetime
};
```

Пример записи в `Booking.metadata`:
```json
{
  "basePrice": "1667.00",
  "pricePerHour": "500.00",
  "totalPrice": "1667.00",
  "guestCount": 4,
  "discount": {
    "percent": 10,
    "amount": "167.00",
    "originalAmount": "1667.00",
    "finalAmount": "1500.00",
    "reason": "permanent_client",
    "appliedBy": "cluser123abc",
    "appliedAt": "2026-04-17T14:30:00.000Z"
  }
}
```

### 3. Структура `AuditLog.metadata` для `booking.discount_applied`

```typescript
// AuditLog запись:
// userId = managerId (из session)
// action = "booking.discount_applied"
// entity = "Booking"
// entityId = bookingId

type DiscountAuditMetadata = {
  managerId: string;        // === userId в AuditLog, дублирование для полноты снимка
  managerName: string;      // user.name ?? user.email ?? "Менеджер"
  bookingId: string;        // === entityId в AuditLog
  moduleSlug: string;       // "gazebos" | "ps-park"
  resourceName: string;     // resource.name
  clientName: string;       // booking.clientName ?? user.name ?? "--"
  originalAmount: number;   // числовое значение (не строка)
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
  discountReason: string;   // slug из справочника
  discountNote?: string;    // только если reason === "other"
  appliedAt: string;        // ISO 8601
};
```

### 4. Zod-схема валидации

```typescript
// Файл: src/modules/booking/validation.ts (НОВЫЙ)

import { z } from "zod";
import { DISCOUNT_REASONS } from "./discount";

/**
 * Схема полей скидки, используется в PATCH /api/{module}/bookings/:id
 * при status === "COMPLETED".
 *
 * discountPercent = 0 или отсутствие поля — без скидки.
 */
export const checkoutDiscountSchema = z.object({
  discountPercent: z
    .number()
    .int("Процент скидки должен быть целым числом")
    .min(1, "Минимальная скидка — 1%")
    .max(100, "Скидка не может превышать 100%")  // верхний предел проверяется динамически
    .optional(),
  discountReason: z
    .enum(DISCOUNT_REASONS, { errorMap: () => ({ message: "Выберите причину из списка" }) })
    .optional(),
  discountNote: z
    .string()
    .min(5, "Минимальная длина пояснения — 5 символов")
    .max(500, "Максимальная длина пояснения — 500 символов")
    .optional(),
}).refine(
  (data) => {
    // Если скидка указана, причина обязательна
    if (data.discountPercent && data.discountPercent > 0 && !data.discountReason) {
      return false;
    }
    return true;
  },
  { message: "При скидке > 0 причина обязательна", path: ["discountReason"] }
).refine(
  (data) => {
    // Если причина "other", текст обязателен
    if (data.discountReason === "other" && (!data.discountNote || data.discountNote.length < 5)) {
      return false;
    }
    return true;
  },
  { message: "При выборе 'Другое' укажите пояснение (минимум 5 символов)", path: ["discountNote"] }
);

export type CheckoutDiscountInput = z.infer<typeof checkoutDiscountSchema>;
```

### 5. Формула расчёта

```typescript
function applyDiscount(originalAmount: number, discountPercent: number): {
  discountAmount: number;
  finalAmount: number;
} {
  const discountAmount = Math.round(originalAmount * discountPercent / 100);
  const finalAmount = originalAmount - discountAmount;
  return { discountAmount, finalAmount };
}
```

Формула: `finalAmount = originalAmount - Math.round(originalAmount * discountPercent / 100)`

- `originalAmount` -- это `metadata.totalPrice` для gazebos, `completedTotalBill` для ps-park.
- `Math.round()` -- округление до рубля (ближайшее целое).
- `discountAmount` = `originalAmount - finalAmount` (чтобы избежать ошибок округления).
- Если `originalAmount === 0`, то `discountAmount = 0`, `finalAmount = 0` (корректная работа для бесплатных бронирований).

### 6. Получение `maxDiscountPercent` из Module.config

```typescript
// Вспомогательная функция в src/modules/booking/discount.ts

import { prisma } from "@/lib/db";
import { DEFAULT_MAX_DISCOUNT_PERCENT } from "./discount";

export async function getMaxDiscountPercent(moduleSlug: string): Promise<number> {
  const mod = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { config: true },
  });
  const config = mod?.config as Record<string, unknown> | null;
  const maxPercent = config?.maxDiscountPercent;
  if (typeof maxPercent === "number" && maxPercent >= 1 && maxPercent <= 100) {
    return maxPercent;
  }
  return DEFAULT_MAX_DISCOUNT_PERCENT;
}
```

---

## Изменения по файлам

### Новые файлы

| Файл | Описание |
|------|----------|
| `src/modules/booking/discount.ts` | Справочник причин, константа `DEFAULT_MAX_DISCOUNT_PERCENT`, функция `getMaxDiscountPercent()`, функция `applyDiscount()` |
| `src/modules/booking/validation.ts` | Zod-схема `checkoutDiscountSchema` |
| `src/modules/booking/__tests__/discount.test.ts` | Тесты: расчёт скидки, граничные случаи |
| `src/modules/booking/__tests__/validation.test.ts` | Тесты: Zod-схема `checkoutDiscountSchema` |

### Изменяемые файлы

#### `src/modules/booking/types.ts`

Добавить тип `BookingDiscount` (описан выше) и добавить поле `discount?: BookingDiscount` в `BookingMetadata`:

```diff
+ import type { DiscountReason } from "./discount";
+
+ export type BookingDiscount = {
+   percent: number;
+   amount: string;
+   originalAmount: string;
+   finalAmount: string;
+   reason: DiscountReason;
+   note?: string;
+   appliedBy: string;
+   appliedAt: string;
+ };
+
  export type BookingMetadata = {
    // ...existing fields...
+
+   // Скидка при чекауте (COMPLETED)
+   discount?: BookingDiscount;
  };
```

#### `src/modules/gazebos/service.ts` -- функция `updateBookingStatus`

**Текущая сигнатура:**
```typescript
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string
)
```

**Новая сигнатура:**
```typescript
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  discountInput?: {
    discountPercent: number;
    discountReason: DiscountReason;
    discountNote?: string;
  }
)
```

**Логика изменений при `status === "COMPLETED"`:**

Сейчас gazebos при COMPLETED просто делает `prisma.booking.update({ status })` (попадает в ветку `else` на строке 437). Нужно:

1. Если `discountInput` передан и `discountPercent > 0`:
   a. Получить `maxDiscountPercent` через `getMaxDiscountPercent("gazebos")`.
   b. Если `discountPercent > maxDiscountPercent` -- выбросить `BookingError("DISCOUNT_EXCEEDS_LIMIT", ...)`.
   c. Вычислить `originalAmount = Number(metadata.totalPrice ?? 0)`.
   d. Вычислить `{ discountAmount, finalAmount } = applyDiscount(originalAmount, discountPercent)`.
   e. Собрать объект `BookingDiscount`.
   f. Обновить `metadata.discount = bookingDiscount`.
   g. Обновить `metadata.totalPrice = finalAmount.toFixed(2)` (чтобы аналитика gazebos корректно читала выручку).

2. Завернуть в `prisma.$transaction`:
   a. `tx.booking.update(...)` -- status + metadata.
   b. `tx.auditLog.create(...)` -- `action: "booking.discount_applied"`, metadata с полным снимком (описан в секции 3).
   c. Аудит-лог создаётся внутри транзакции, чтобы гарантировать атомарность.

3. Если `discountPercent === 0` или `discountInput` не передан -- поведение не меняется (текущий код).

**Псевдокод ветки COMPLETED в gazebos:**

```typescript
} else if (status === "COMPLETED") {
  const existingMeta = (booking.metadata as BookingMetadata | null) ?? {};

  let discountData: BookingDiscount | undefined;

  if (discountInput?.discountPercent && discountInput.discountPercent > 0) {
    const maxPercent = await getMaxDiscountPercent(MODULE_SLUG);
    if (discountInput.discountPercent > maxPercent) {
      throw new BookingError(
        "DISCOUNT_EXCEEDS_LIMIT",
        `Максимальная скидка для этого модуля: ${maxPercent}%`
      );
    }

    const originalAmount = Number(existingMeta.totalPrice ?? 0);
    const { discountAmount, finalAmount } = applyDiscount(originalAmount, discountInput.discountPercent);

    discountData = {
      percent: discountInput.discountPercent,
      amount: discountAmount.toFixed(2),
      originalAmount: originalAmount.toFixed(2),
      finalAmount: finalAmount.toFixed(2),
      reason: discountInput.discountReason,
      ...(discountInput.discountNote && { note: discountInput.discountNote }),
      appliedBy: managerId ?? booking.userId,
      appliedAt: new Date().toISOString(),
    };
  }

  const updatedMetadata = {
    ...existingMeta,
    ...(discountData && {
      discount: discountData,
      totalPrice: discountData.finalAmount, // обновляем totalPrice для аналитики
    }),
  };

  updated = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.update({
      where: { id },
      data: {
        status,
        ...(managerId && { managerId }),
        metadata: updatedMetadata as Prisma.InputJsonValue,
      },
    });

    // Аудит-лог скидки (внутри транзакции)
    if (discountData) {
      const managerUser = await tx.user.findUnique({
        where: { id: managerId ?? booking.userId },
        select: { name: true, email: true },
      });
      const resource = await tx.resource.findUnique({
        where: { id: booking.resourceId },
        select: { name: true },
      });

      await tx.auditLog.create({
        data: {
          userId: managerId ?? booking.userId,
          action: "booking.discount_applied",
          entity: "Booking",
          entityId: id,
          metadata: {
            managerId: managerId ?? booking.userId,
            managerName: managerUser?.name ?? managerUser?.email ?? "Менеджер",
            bookingId: id,
            moduleSlug: MODULE_SLUG,
            resourceName: resource?.name ?? "--",
            clientName: booking.clientName ?? "--",
            originalAmount: Number(discountData.originalAmount),
            discountPercent: discountData.percent,
            discountAmount: Number(discountData.amount),
            finalAmount: Number(discountData.finalAmount),
            discountReason: discountData.reason,
            ...(discountData.note && { discountNote: discountData.note }),
            appliedAt: discountData.appliedAt,
          },
        },
      });
    }

    return b;
  });
}
```

#### `src/modules/ps-park/service.ts` -- функция `updateBookingStatus`

**Текущая сигнатура:**
```typescript
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number
)
```

**Новая сигнатура:**
```typescript
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number,
  discountInput?: {
    discountPercent: number;
    discountReason: DiscountReason;
    discountNote?: string;
  }
)
```

**Логика изменений при `status === "COMPLETED"` (строки 356-405):**

PS Park уже имеет транзакцию с `FinancialTransaction`. Нужно встроить скидку:

1. Билл рассчитывается как сейчас: `completedTotalBill = hoursCost + completedItemsTotal`.
2. Если `discountInput` передан:
   a. Проверить `maxDiscountPercent` для `"ps-park"`.
   b. `originalAmount = completedTotalBill`.
   c. `{ discountAmount, finalAmount } = applyDiscount(originalAmount, discountPercent)`.
   d. Обновить `billSnapshot.originalAmount = originalAmount`, `billSnapshot.discountPercent`, `billSnapshot.discountAmount`, `billSnapshot.finalAmount`.
   e. `completedTotalBill = finalAmount` (подменить для дальнейшего использования в `FinancialTransaction`).
   f. Записать `metadata.discount` в booking.
3. `FinancialTransaction` создаётся с `totalAmount = finalAmount` (после скидки).
4. `FinancialTransaction.metadata` дополняется: `originalAmount`, `discountPercent`, `discountAmount`.
5. `cashAmount` / `cardAmount` должны балансироваться к `finalAmount`, а не к `originalAmount`.
6. Аудит-лог `booking.discount_applied` создаётся внутри той же транзакции.

**Порядок операций в `prisma.$transaction` для PS Park COMPLETED:**

```
1. Рассчитать billSnapshot (без скидки)
2. Если есть скидка:
   2a. getMaxDiscountPercent("ps-park")
   2b. Проверить лимит
   2c. applyDiscount(completedTotalBill, discountPercent)
   2d. Пересчитать billSnapshot с учётом скидки
   2e. Обновить completedTotalBill = finalAmount
3. tx.booking.update({ status, metadata: { ...metadataWithBill, discount } })
4. tx.financialTransaction.create({
     totalAmount: finalAmount,  // после скидки
     cashAmount: resolvedCash,
     cardAmount: resolvedCard,
     metadata: billSnapshot,    // содержит originalAmount, discountPercent
   })
5. Если discountData:
   tx.auditLog.create({ action: "booking.discount_applied", ... })
```

#### `src/app/api/gazebos/bookings/[id]/route.ts` -- PATCH handler

Изменения в ветке `hasRole(session.user, "MANAGER")`:

```typescript
// Перед вызовом updateBookingStatus — валидировать discount-поля
const { discountPercent, discountReason, discountNote } = body;

let discountInput: CheckoutDiscountInput | undefined;
if (status === "COMPLETED" && discountPercent !== undefined && discountPercent > 0) {
  const parsed = checkoutDiscountSchema.safeParse({ discountPercent, discountReason, discountNote });
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
  }
  discountInput = parsed.data;
}

updated = await updateBookingStatus(id, status, session.user.id, reason, discountInput);

// Существующий logAudit("booking.status_change") остаётся — это лог смены статуса.
// Лог "booking.discount_applied" создаётся внутри сервиса (в транзакции).
```

#### `src/app/api/ps-park/bookings/[id]/route.ts` -- PATCH handler

Аналогично gazebos, но с передачей `cashAmount`, `cardAmount`:

```typescript
const { discountPercent, discountReason, discountNote } = body;

let discountInput: CheckoutDiscountInput | undefined;
if (status === "COMPLETED" && discountPercent !== undefined && discountPercent > 0) {
  const parsed = checkoutDiscountSchema.safeParse({ discountPercent, discountReason, discountNote });
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
  }
  discountInput = parsed.data;
}

updated = await updateBookingStatus(
  id, status, session.user.id, reason,
  typeof cashAmount === "number" ? cashAmount : undefined,
  typeof cardAmount === "number" ? cardAmount : undefined,
  discountInput
);
```

#### `src/modules/gazebos/validation.ts` и `src/modules/ps-park/validation.ts`

Добавить к `moduleSettingsSchema` поле `maxDiscountPercent`:

```diff
  export const moduleSettingsSchema = z.object({
    openHour: z.number().int().min(0).max(23).optional(),
    closeHour: z.number().int().min(0).max(23).optional(),
    minBookingHours: z.number().int().min(1).max(24).optional(),
    maxBookingHours: z.number().int().min(1).max(24).optional(),
+   maxDiscountPercent: z.number().int().min(1).max(100).optional(),
  });
```

#### `src/modules/gazebos/types.ts` -- `GazeboModuleConfig`

```diff
  export type GazeboModuleConfig = {
    openHour: number;
    closeHour: number;
    minBookingHours: number;
    maxBookingHours: number;
+   maxDiscountPercent?: number;  // default 30
  };
```

#### `src/components/admin/gazebos/booking-actions.tsx`

Добавить диалог скидки при нажатии "Завершить":
- При нажатии "Завершить" открывается модалка (или inline-форма).
- В форме: чекбокс "Применить скидку" -> показывает поля:
  - input[type=number] "Скидка, %" (1..maxDiscountPercent)
  - select "Причина"
  - textarea "Пояснение" (если "Другое")
  - Строка: "Исходная сумма: X руб. -> Итого: Y руб."
- Кнопка "Завершить" отправляет PATCH с `{ status: "COMPLETED", discountPercent, discountReason, discountNote }`.
- `maxDiscountPercent` загружается из `/api/gazebos/settings` (один раз при открытии модалки или кэшируется).

#### `src/components/admin/ps-park/session-bill-modal.tsx`

Добавить секцию скидки в модалку между breakdown и split payment:
- Чекбокс/переключатель "Применить скидку".
- Те же поля: процент, причина, пояснение.
- Пересчёт `total` в реальном времени: `const effectiveTotal = discountPercent > 0 ? finalAmount : bill.totalBill`.
- `cashRaw` / `cardRaw` должны инициализироваться от `effectiveTotal`.
- Строка итого обновляется: перечёркнутая старая сумма + новая.
- При `onConfirm` передаются `discountPercent`, `discountReason`, `discountNote` вместе с `cashAmount`, `cardAmount`.

---

## API-контракт

### PATCH /api/gazebos/bookings/:id (с discount)

**Роли:** MANAGER с `hasAdminSectionAccess("gazebos")`, SUPERADMIN.

**Request:**
```json
{
  "status": "COMPLETED",
  "discountPercent": 10,
  "discountReason": "permanent_client",
  "discountNote": null
}
```

**Валидация:**
- `discountPercent`: целое, 1..maxDiscountPercent (из Module.config, default 30).
- `discountReason`: один из `["permanent_client", "corporate", "promo", "compensation", "other"]`.
- `discountNote`: обязателен если `discountReason === "other"`, минимум 5 символов, максимум 500.
- Если `discountPercent > 0` и `discountReason` отсутствует -- ошибка 422.

**Ответ (успех, 200):**
```json
{
  "success": true,
  "data": {
    "id": "clbooking123",
    "moduleSlug": "gazebos",
    "resourceId": "clresource456",
    "status": "COMPLETED",
    "metadata": {
      "basePrice": "1667.00",
      "pricePerHour": "500.00",
      "totalPrice": "1500.00",
      "discount": {
        "percent": 10,
        "amount": "167.00",
        "originalAmount": "1667.00",
        "finalAmount": "1500.00",
        "reason": "permanent_client",
        "appliedBy": "clmanager789",
        "appliedAt": "2026-04-17T14:30:00.000Z"
      }
    }
  }
}
```

**Ответ (скидка > лимита, 422):**
```json
{
  "success": false,
  "error": {
    "code": "DISCOUNT_EXCEEDS_LIMIT",
    "message": "Максимальная скидка для этого модуля: 30%"
  }
}
```

**Ответ (без причины, 422):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "При скидке > 0 причина обязательна"
  }
}
```

### PATCH /api/ps-park/bookings/:id (с discount)

**Роли:** MANAGER с `hasAdminSectionAccess("ps-park")`, SUPERADMIN.

**Request:**
```json
{
  "status": "COMPLETED",
  "cashAmount": 1350,
  "cardAmount": 0,
  "discountPercent": 10,
  "discountReason": "compensation",
  "discountNote": null
}
```

Важно: `cashAmount + cardAmount` должны балансироваться к `finalAmount` (после скидки), а не к `originalAmount`. Проверка баланса выполняется на клиенте (модалка). API не проверяет `cashAmount + cardAmount === finalAmount` (текущее поведение -- нет такой проверки).

**Ответ (успех, 200):**
```json
{
  "success": true,
  "data": {
    "id": "clbooking456",
    "moduleSlug": "ps-park",
    "status": "COMPLETED",
    "cashAmount": "1350",
    "cardAmount": "0",
    "metadata": {
      "bill": {
        "totalBill": 1500,
        "originalAmount": 1500,
        "discountPercent": 10,
        "discountAmount": 150,
        "finalAmount": 1350,
        "billedHours": 2,
        "pricePerHour": 500,
        "hoursCost": 1000,
        "items": [],
        "itemsTotal": 500,
        "completedAt": "2026-04-17T15:00:00.000Z"
      },
      "discount": {
        "percent": 10,
        "amount": "150.00",
        "originalAmount": "1500.00",
        "finalAmount": "1350.00",
        "reason": "compensation",
        "appliedBy": "clmanager789",
        "appliedAt": "2026-04-17T15:00:00.000Z"
      }
    }
  }
}
```

### Без скидки (обратная совместимость)

Если `discountPercent` отсутствует или равен 0 -- поведение идентично текущему. Никакие `discount` поля не добавляются в metadata. Никакой `booking.discount_applied` в аудит-лог не пишется.

---

## RBAC и безопасность

| Проверка | Где | Как |
|----------|-----|-----|
| Авторизация | Route handler | `auth()` -- если нет session, 401 |
| Роль MANAGER+ | Route handler | `hasRole(session.user, "MANAGER")` |
| Доступ к секции | Route handler | `requireAdminSection(session, "gazebos"/"ps-park")` |
| Лимит скидки | Service | `getMaxDiscountPercent(moduleSlug)` сверяется с `discountPercent` |
| `managerId` из session | Route handler | `session.user.id` (НЕ из body) |
| Валидация входа | Route handler | `checkoutDiscountSchema.safeParse(...)` |
| Атомарность | Service | `prisma.$transaction` -- booking + auditLog в одной транзакции |

**Rate limiting:** Существующие правила (120 req/min для авторизованных). Новых ограничений не требуется -- это мутация менеджера, не публичный эндпоинт.

**Injection-защита:**
- `discountNote` -- свободный текст, максимум 500 символов. Проходит через Zod (max length). Хранится в JSONB -- SQL-injection невозможен (параметризованные запросы Prisma). При отображении в UI -- React автоматически экранирует.

---

## Влияние на аналитику

### Gazebos `getAnalytics()`

Текущий код (строка 799): `const price = meta?.totalPrice as number | undefined`.

После изменения `metadata.totalPrice` обновляется до `finalAmount`, аналитика автоматически будет считать выручку после скидки. Дополнительных изменений не требуется.

Для подсчёта "потерь на скидках" суперадмин использует `AuditLog` с `action = "booking.discount_applied"`, суммируя `metadata.discountAmount`.

### PS Park `getAnalytics()`

Текущий код (строка 1263): выручка считается из `FinancialTransaction.totalAmount`.

После изменения `totalAmount` в `FinancialTransaction` = `finalAmount` (после скидки) -- аналитика автоматически корректна.

Для аудита "потерь" -- аналогично через `AuditLog`.

### Phase 5.1 (лояльность) -- совместимость

`finalAmount` -- каноническое поле выручки после скидки:
- Gazebos: `Booking.metadata.totalPrice` (обновляется до `finalAmount`).
- PS Park: `FinancialTransaction.totalAmount` (уже `finalAmount`).
- Оригинальная сумма: `Booking.metadata.discount.originalAmount`.

Phase 5.1 должна начислять баллы на основе `finalAmount`, а не `originalAmount`.

---

## Что НЕ менять

1. **Схема БД (`prisma/schema.prisma`)** -- никаких новых моделей, полей, миграций.
2. **`src/lib/logger.ts`** -- `logAudit()` используется как есть, но аудит скидки создаётся ВНУТРИ транзакции напрямую через `tx.auditLog.create()` (а не через `logAudit()`, который не принимает транзакционный клиент).
3. **State machine (`src/modules/booking/state-machine.ts`)** -- допустимые переходы статусов не меняются.
4. **Публичные эндпоинты** -- скидка доступна только менеджерам через PATCH.
5. **Модуль кафе** -- вне скоупа (другая модель: заказы, не бронирования).
6. **`logAudit()` вызов в route handler для `booking.status_change`** -- остаётся. `booking.discount_applied` -- это ОТДЕЛЬНАЯ запись, создаваемая внутри транзакции в сервисе.
7. **Inventory management** -- скидка не влияет на списание товаров (они списываются при CONFIRMED).
8. **Google Calendar sync** -- скидка не влияет на события в календаре.
9. **Notifications** -- уведомления при COMPLETED не меняются (скидка не передаётся в уведомление клиенту).

---

## Миграция данных

Не требуется. Все изменения в JSONB-полях. Существующие бронирования без `discount` в metadata продолжают работать корректно (`discount` -- optional).

---

## Чеклист перед передачей Developer

- [x] ADR написан и зафиксирован
- [x] Схема данных описана (JSONB structure, нет новых Prisma models)
- [x] API-контракты определены (PATCH с discount-полями, response)
- [x] Zod-схемы описаны (`checkoutDiscountSchema`)
- [x] Влияние на существующие модули оценено (аналитика OK, Phase 5.1 задокументирована)
- [x] Миграция данных описана (не нужна)
- [x] RBAC проверки определены (MANAGER + section access)
- [x] Rate limiting -- существующий, без изменений
- [x] Формат ошибок определён (DISCOUNT_EXCEEDS_LIMIT 422, VALIDATION_ERROR 422)
- [x] Edge cases: нулевая цена, 0% скидки, "Другое" без текста, ретроактивная правка
