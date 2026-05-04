# ADR: F5 — Cafe Order ↔ Booking link (backend)

## Статус
Принято

## Контекст

PRD: `docs/requirements/2026-05-04-cafe-order-booking-link-prd.md`. PO решил: добавить опциональную FK `Order.bookingId → Booking.id` (`onDelete: SetNull`), nullable, без backfill. UI — отдельный компонент `CafeOrderButton` рядом с `add-items-button.tsx`. Без валидации статуса/`deletedAt` Booking. Цель — фундамент F7 (drill-down «что ел гость во время сессии»).

Открытые вопросы PO решены ниже.

---

## Варианты

### A. Полноценная двусторонняя relation `Booking ↔ Order` (выбран)
- Плюсы: type-safe `prisma.booking.findUnique({ include: { orders: true } })` для будущего F7; явное имя relation `OrderBooking` устраняет неоднозначность.
- Минусы: лишнее поле `orders Order[]` в `Booking` (в текущем тикете не используется в коде).

### B. Только `bookingId String?` без relation
- Плюсы: минимально.
- Минусы: F7 будет вынужден делать ручной join через `prisma.order.findMany({ where: { bookingId } })`. Теряется навигация в обе стороны. Каждый раз при доработке F7 придётся возвращаться к схеме.

**Решение:** A. Стоимость одной строки `orders Order[]` — нулевая, выгода для F7 — реальная.

---

## Решения по open questions PO

1. **Relation:** `booking Booking? @relation("OrderBooking", fields: [bookingId], references: [id], onDelete: SetNull)`. Обратная — `orders Order[] @relation("OrderBooking")` в `Booking`. Имя `OrderBooking` явное (без него Prisma может конфликтовать при добавлении других FK Order↔Booking в будущем).
2. **`onDelete: SetNull`** — подтверждаю. Заказ — финансовый документ, не каскадим. На уровне Postgres превращается в `ON DELETE SET NULL`. Soft-delete (`Booking.deletedAt`) на FK не влияет — связь живёт, пока строка `Booking` физически в БД.
3. **UI компонент:** новый `CafeOrderButton` в `src/components/admin/ps-park/cafe-order-button.tsx`. Логика — рядом с `add-items-button.tsx` (один контекст активной сессии PS Park, передаётся `bookingId`). Размещать в `src/components/admin/cafe/` нет смысла: компонент специфичен для PS-сессии, кафе-админка использует свои workflow без `bookingId`.
4. **POST handler:** существует — `src/app/api/cafe/order/route.ts` (singular `/order`, не `/orders`). PO искал в `/api/cafe/orders/route.ts` (plural — там только GET). **Не плодим дубль**. Расширяем существующий POST `/api/cafe/order`. UI использует тот же URL.
5. **`z.string().cuid()`** — оставляем. CUID — формат, который Prisma реально генерирует для всех `@default(cuid())`. Защита от мусорной строки до удара в БД. В тестах мокаем `prisma.booking.findUnique`, поэтому реальный формат значения роли не играет — `"booking-1"` пройдёт `z.string().cuid()` ❌, поэтому в тестах используем валидные CUID-подобные строки (`"clxxxxxxxxxxxxxxxxxxxxxxx"`) или мокаем на уровне сервиса в обход Zod (route-тест → отдельная история).

---

## Prisma schema изменения

### `model Order` (добавить 2 поля + 1 индекс)
```prisma
model Order {
  id          String      @id @default(cuid())
  moduleSlug  String
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  bookingId   String?
  booking     Booking?    @relation("OrderBooking", fields: [bookingId], references: [id], onDelete: SetNull)
  status      OrderStatus @default(NEW)
  totalAmount Decimal
  deliveryTo  String?
  items       OrderItem[]
  deletedAt   DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([userId])
  @@index([moduleSlug, status])
  @@index([bookingId])
}
```

### `model Booking` (добавить обратную relation)
```prisma
model Booking {
  // ... existing fields ...
  orders         Order[]   @relation("OrderBooking")
  // ... existing indexes ...
}
```

Никаких других изменений в `Booking` (в т.ч. индексов) не требуется — поиск `prisma.booking.findUnique({ where: { id } })` работает по PK.

---

## Migration

**Команда:**
```bash
npx prisma migrate dev --name add_order_booking_id
```

**Ожидаемый SQL:**
```sql
ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT;
CREATE INDEX "Order_bookingId_idx" ON "Order"("bookingId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

**Безопасность для prod:**
- Колонка NULLable → не ломает existing rows.
- FK добавляется на пустую колонку → instant в Postgres (без table scan).
- INDEX по NULL-колонке → строится мгновенно (все значения NULL).
- Backward-compat: старые сборки приложения, обращающиеся к `Order` без `bookingId`, работают без изменений (Prisma игнорирует неизвестные select-поля).

---

## Service `src/modules/cafe/service.ts`

### `types.ts` — расширить `CreateOrderInput`
```ts
export type CreateOrderInput = {
  items: OrderItemInput[];
  deliveryTo?: string;
  comment?: string;
  bookingId?: string;   // NEW: опциональная привязка к PS-сессии или беседке
};
```

### `service.ts` — `createOrder`
```ts
export async function createOrder(userId: string, input: CreateOrderInput) {
  const { items, deliveryTo, bookingId } = input;

  // NEW: validate bookingId existence (without status/deletedAt check — PO decision)
  if (bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new OrderError("BOOKING_NOT_FOUND", "Бронирование не найдено");
    }
  }

  // ... existing menuItems lookup, totalAmount calc ...

  const order = await prisma.order.create({
    data: {
      moduleSlug: MODULE_SLUG,
      userId,
      totalAmount,
      deliveryTo,
      bookingId,                  // NEW
      status: "NEW",
      items: { create: orderItems },
    },
    include: { items: true },
  });

  // ... existing enqueueNotification ...
  return order;
}
```

**Важно:** проверка `bookingId` ДО запросов меню — экономит круг к БД при невалидном запросе. `findUnique` без `where: { deletedAt: null }` намеренно (PO решение №5).

---

## Validation `src/modules/cafe/validation.ts`

```ts
export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Заказ должен содержать хотя бы один товар"),
  deliveryTo: z.string().max(50).optional(),
  comment: z.string().max(500).optional(),
  bookingId: z.string().cuid("bookingId должен быть валидным CUID").optional(),  // NEW
});
```

При ошибке формата — `apiValidationError` уже возвращает 422 с `parsed.error.issues[0].message`.

---

## API: POST `/api/cafe/order` (existing, расширяем)

Файл: `src/app/api/cafe/order/route.ts` (НЕ `/orders/`).

### Request
```json
POST /api/cafe/order
Content-Type: application/json
Authorization: cookie-based (NextAuth)

{
  "items": [{ "menuItemId": "clxxxx...", "quantity": 2 }],
  "deliveryTo": "офис 305",
  "bookingId": "clyyyy..."   // optional
}
```

### Response
| Сценарий | HTTP | Body |
|---|---|---|
| Success | 201 | `{ success: true, data: { id, bookingId, items, ... } }` |
| Invalid body (Zod) | 422 | `{ success: false, error: { code: "VALIDATION_ERROR", message } }` |
| `bookingId` не существует | 404 | `{ success: false, error: { code: "BOOKING_NOT_FOUND", message } }` |
| Меню-позиция не найдена | 400 | `{ success: false, error: { code: "ITEM_NOT_FOUND", ... } }` |
| Не авторизован | 401 | `apiUnauthorized()` |

### Error mapping (важно)
Текущий handler делает `apiError(error.code, error.message)` с дефолтным status 400. Для `BOOKING_NOT_FOUND` нужен **404**:

```ts
if (error instanceof OrderError) {
  const status = error.code === "BOOKING_NOT_FOUND" ? 404 : 400;
  return apiError(error.code, error.message, status);
}
```

PO в PRD написал «404 (или 422?)» — выбираю **404**. Семантически корректно: «ресурс, на который ссылается запрос, не существует». 422 зарезервирован за валидацией формата.

### RBAC и rate limiting

| Параметр | Значение | Обоснование |
|---|---|---|
| Кто может вызывать | Любой авторизованный (USER, MANAGER, SUPERADMIN) | Endpoint существующий, регрессии в политике доступа нет. USER создаёт заказ для себя; MANAGER PS Park — для гостя сессии. |
| `hasModuleAccess` | НЕ требуется | Это публичный (для авторизованных) flow, не админский. Существующая логика `auth()` без модульных проверок. |
| Rate limit | По стандарту платформы (CLAUDE.md): 60/min публичный, 120/min авторизованный. **Изменений в существующий handler не вводим** — сейчас лимит на endpoint не настроен. Добавление rate limit — вне scope F5 (PO не запрашивал). | Минимальное изменение, fokus на F5. |
| Audit log | Существующий `logAudit(userId, "order.create", ...)` оставляем. Добавить в metadata `bookingId` (если передан) для traceability. | |

Изменение в `logAudit`:
```ts
await logAudit(session.user.id, "order.create", "Order", order.id, {
  itemCount: parsed.data.items.length,
  deliveryTo: parsed.data.deliveryTo,
  bookingId: parsed.data.bookingId ?? null,  // NEW
});
```

---

## UI: `CafeOrderButton`

**Файл:** `src/components/admin/ps-park/cafe-order-button.tsx`

**Props:**
```ts
type Props = {
  bookingId: string;          // обязательно: компонент работает только в контексте сессии
  onCreated?: () => void;     // optional: callback после успешного создания (refresh страницы)
};
```

**Поведение:**
1. Кнопка `+ Кафе` (стиль аналогичен `+ Товары` в `add-items-button.tsx`).
2. Modal со списком меню: `GET /api/cafe/menu` (existing endpoint), фильтр по категории.
3. Выбор позиций (qty-stepper, как в `InventoryItemPicker` — но проще: одна линия per item).
4. Submit → `POST /api/cafe/order` с `{ items: [...], bookingId }`.
5. Обработка ответа: success → `setOpen(false)`, `onCreated?.()` или `router.refresh()`. Error → `setError(data.error.message)`.

**Не дублируем:** логика корзины публичного фронта (`/cafe`) НЕ переиспользуется — там есть локальный state, persistence в localStorage, мобильная вёрстка. Админский компонент — минималистичный modal без сохранения корзины между сессиями.

**Размещение в карточке сессии:** компонент-родитель (тот же, где сейчас рендерится `<AddItemsButton bookingId={...} />`) добавляет `<CafeOrderButton bookingId={...} />` рядом.

---

## Тест-план

### Unit (`src/modules/cafe/__tests__/service.test.ts`)
1. `createOrder` без `bookingId` → Order создан с `bookingId: null` (не вызывается `prisma.booking.findUnique`).
2. `createOrder` с валидным `bookingId` → `prisma.booking.findUnique` вернул `{ id }`, Order создан с этим `bookingId`.
3. `createOrder` с несуществующим `bookingId` → `prisma.booking.findUnique` вернул `null` → выброс `OrderError("BOOKING_NOT_FOUND", ...)`. `prisma.order.create` НЕ вызван.
4. `createOrder` с `bookingId` к soft-deleted Booking → `findUnique` возвращает Booking (мы не фильтруем `deletedAt`) → Order создаётся.

Mock setup: добавить в `vi.mock('@/lib/db')` секцию `booking: { findUnique: vi.fn() }`.

### Integration (`src/app/api/cafe/order/__tests__/route.test.ts` — если уже есть)
- POST с `bookingId: "not-a-cuid"` → 422 `VALIDATION_ERROR`.
- POST с валидным `bookingId`, существующим Booking → 201, `data.bookingId === input.bookingId`.
- POST с валидным `bookingId`, не существующим → 404 `BOOKING_NOT_FOUND` (проверяет mapping).

### UI
Out of scope (тривиальный компонент, manual smoke test).

---

## Rollback

```bash
git revert <commit>
npx prisma migrate resolve --rolled-back add_order_booking_id
# Если миграция уже применена в prod и нужно откатить SQL:
psql -c 'ALTER TABLE "Order" DROP CONSTRAINT "Order_bookingId_fkey";'
psql -c 'DROP INDEX "Order_bookingId_idx";'
psql -c 'ALTER TABLE "Order" DROP COLUMN "bookingId";'
```

Безопасно: миграция NULLable, никаких данных не уничтожает. Rollback просто удаляет новую колонку — existing данные сохраняются.

---

## Anti-scope (что НЕ делаем)

- ❌ Subscriptions/notifications о привязке заказа к сессии.
- ❌ UI drill-down по сессии (это F7).
- ❌ Изменения в `MenuItem`, корзине публичного фронта, ценообразовании.
- ❌ Backfill исторических `Order` (технически невозможен).
- ❌ Изменения в модуле `gazebos` (Booking-совместимость есть, но UI отдельно).
- ❌ Telegram-бот flow для заказа в контексте сессии.
- ❌ Rate limiting на `POST /api/cafe/order` (вне scope F5).
- ❌ Валидация статуса/`deletedAt` Booking (PO решения №4, №5).

---

## Влияние на существующие модули

| Модуль | Изменение | Риск |
|---|---|---|
| `cafe` | + поле `bookingId` в `CreateOrderInput`, валидация, передача в Prisma. Все existing вызовы без `bookingId` работают (поле optional). | Low. Покрывается тестом AC-1.5/AC-2.1. |
| `ps-park` | + UI `CafeOrderButton` рядом с `AddItemsButton` в карточке сессии. | Low. Аддитивное изменение. |
| `booking` (shared) | + обратная relation `orders Order[]`. Используется только в Prisma type, в коде не читается. | Zero. |
| `notifications` | Без изменений. `enqueueNotification` получает existing payload. | Zero. |
| Prisma migrations | + 1 миграция NULLable column + FK + index. | Low. Безопасно для prod. |

---

## Чеклист

- [x] ADR написан
- [x] Схема БД описана (Prisma diff)
- [x] API-контракт определён (request/response, error codes, status mapping)
- [x] Zod-схема описана (`bookingId: z.string().cuid().optional()`)
- [x] Миграция: имя, команда, SQL, prod-safety, rollback
- [x] RBAC: кто имеет доступ, нужны ли `hasModuleAccess`, rate limit
- [x] Тест-план: unit (4 кейса) + integration (3 кейса)
- [x] Open questions PO закрыты (5 пунктов)
- [x] Anti-scope зафиксирован (8 пунктов)
