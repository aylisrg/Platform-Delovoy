# ADR — F6: Модуль Subscriptions (PS Park) — модель + admin CRUD

- **Дата:** 2026-05-04
- **Статус:** Принято
- **RUN_ID:** `2026-05-04-subscriptions-module-impl`
- **Branch:** `claude/wave-3-subscriptions-impl`
- **Связанные:**
  - PRD: `docs/requirements/2026-05-04-subscriptions-module-prd.md`
  - F4 ADR (Client CRUD, образец `ClientError`): `src/modules/clients/service.ts:22-31`
  - F3 паттерн `BookingError` 3-arg (`code`, `message`, `metadata`): `src/modules/gazebos/service.ts`
  - F7 (debit при completion + drilldown) — **отдельный ADR, вне скоупа F6**

---

## 1. Контекст

PRD F6 (`docs/requirements/2026-05-04-subscriptions-module-prd.md:1-330`): менеджер PS Park должен фиксировать предоплаченные пакеты часов на конкретного гостя, видеть остаток, ручную корректировку, отмену. MVP — только PS Park, только админ-CRUD. Автосписание при завершении сессии и drill-down (US-3 показ ссылки на бронирование) — **F7**.

F6 экспортирует `getActiveSubscriptionForUser(userId)` как public helper для F7, но без логики charge — эту функцию F7 будет дополнять в `service.ts`.

**Базовые инварианты (PRD §Бизнес-правила):**
1. Один `ACTIVE` абонемент на `userId` (жёсткий, БД-уровень).
2. `SubscriptionTransaction` immutable (как `FinancialTransaction` — `prisma/schema.prisma:247-265`).
3. `remainingHours >= 0` всегда (no clamp, ошибка `INSUFFICIENT_HOURS`).
4. Гость только `role=USER` и не tombstoned (`mergedIntoUserId IS NULL`).

---

## 2. Decisions matrix (закрытие 4 open questions PO)

| # | Вопрос | Решение | Обоснование |
|---|--------|---------|-------------|
| 1 | Auto-status (EXPIRED/DEPLETED) — lazy vs cron | **Lazy при чтении** в `getSubscription` / `listSubscriptions` / `getActiveSubscriptionForUser` | Меньше movable parts. Cron — Phase 5.x. Status пересчитывается из `(now, validTo, remainingHours)` и при расхождении немедленно `UPDATE` (один `WHERE id = … AND status = ACTIVE` — безопасно для конкурентных читателей). Приоритет EXPIRED > DEPLETED (PRD §Бизнес-правила п.4). |
| 2 | Защита от race «два ACTIVE на одного userId» | **Partial UNIQUE index** в Postgres: `CREATE UNIQUE INDEX subscription_user_active_unique ON "Subscription" ("userId") WHERE "status" = 'ACTIVE'` | DB-level гарантия дешевле SELECT FOR UPDATE и optimistic-lock. Одинаковый паттерн с `inventory_sku_active_name_lower_unique` (`prisma/schema.prisma:868-877`). Prisma не умеет partial index — добавляется через raw SQL в migration. |
| 3 | Продление `validTo` через PATCH | **Запрещено.** Изменяемые поля через PATCH: только `notes` и `pricePaid` (исправление опечатки). Продление = `cancel + create new`. | Чистый audit trail. Продление через PATCH ломает интерпретацию транзакций (totalHours остаётся прежним при увеличенном сроке, что вводит в заблуждение). PO рекомендация. |
| 4 | Manual deduct в минус | **422 `INSUFFICIENT_HOURS`**, никакого clamp до 0 | PO рекомендует. Defensive — clamp скрывает баги ввода. Менеджер должен явно увидеть "не хватает 1.5 ч" и принять решение. |

---

## 3. Варианты, которые рассматривались

### Вариант A: Status хранится + cron-обновление
- **Плюсы:** лёгкая фильтрация по `status` без вычислений; строгая консистентность.
- **Минусы:** нужен cron, ещё одна movable part; lag между `validTo` и cron tick (до 1 ч); если cron упал — фильтры показывают неактуальные данные.

### Вариант B (выбран): Status хранится, но lazy-recompute при каждом чтении
- **Плюсы:** нет cron; статус всегда актуален в момент рендеринга; одна функция `recomputeAndPersistStatus(sub)` переиспользуется в `getSubscription`/`listSubscriptions`/`getActiveSubscriptionForUser`.
- **Минусы:** маленький write-overhead на read (только при реальном расхождении статуса). Допустимо: фоновых читателей у Subscription немного.

### Вариант C: Полностью derived status (виртуальное поле)
- **Плюсы:** ни одной записи статуса, всегда вычисляется.
- **Минусы:** ломает `WHERE status = 'ACTIVE'` фильтры, не работает с partial unique index (Q2).

→ Вариант B покрывает Q1+Q2 минимальными средствами.

---

## 4. Схема данных (Prisma + raw SQL для partial unique)

### 4.1. Новые enum

```prisma
enum SubscriptionStatus {
  ACTIVE
  EXPIRED
  DEPLETED
  CANCELLED
}

enum SubscriptionTransactionType {
  CHARGE         // авто-списание из F7 (booking.completed)
  REFUND         // возврат часов (cancellation, F7)
  MANUAL_TOPUP   // ручное пополнение менеджером
  MANUAL_DEDUCT  // ручное списание менеджером
}
```

> **Naming clarification:** PRD §Модели данных использует имя `SubscriptionTransactionReason`. Architect выбирает **`SubscriptionTransactionType`** для консистентности с `FinancialTxType` (`prisma/schema.prisma:267-271`) и `InventoryTransactionType` (`prisma/schema.prisma:902-908`). PRD это не противоречит — PO согласовал семантику, не имя.

### 4.2. Модели

```prisma
// === SUBSCRIPTIONS (PS Park, F6) ===

model Subscription {
  id             String             @id @default(cuid())
  moduleSlug     String             @default("ps-park")
  userId         String
  user           User               @relation("UserSubscriptions", fields: [userId], references: [id])
  totalHours     Decimal            @db.Decimal(10, 2)
  remainingHours Decimal            @db.Decimal(10, 2)
  validFrom      DateTime
  validTo        DateTime
  status         SubscriptionStatus @default(ACTIVE)
  pricePaid      Decimal            @db.Decimal(10, 2)
  notes          String?            @db.Text
  cancelReason   String?
  cancelledAt    DateTime?
  cancelledById  String?
  createdById    String
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  transactions   SubscriptionTransaction[]

  @@index([userId, status])
  @@index([status, validTo])
  @@index([moduleSlug, createdAt])
  // Partial unique — см. raw SQL в migration:
  //   CREATE UNIQUE INDEX subscription_user_active_unique
  //     ON "Subscription" ("userId") WHERE "status" = 'ACTIVE'
  // Аналог: prisma/schema.prisma:868-877 (InventorySku partial unique).
}

model SubscriptionTransaction {
  id              String                       @id @default(cuid())
  subscriptionId  String
  subscription    Subscription                 @relation(fields: [subscriptionId], references: [id])
  type            SubscriptionTransactionType
  hoursDelta      Decimal                      @db.Decimal(10, 2) // <0 = списание, >0 = пополнение
  balanceAfter    Decimal                      @db.Decimal(10, 2) // снапшот для drill-down
  bookingId       String?                      // FK к Booking, заполняется в F7 (CHARGE)
  reason          String?                      @db.Text           // обязательно для MANUAL_*
  performedById   String
  performedByName String                                          // денормализованное имя (как в FinancialTransaction)
  createdAt       DateTime                     @default(now())
  // Нет updatedAt — immutable audit log, как FinancialTransaction (prisma/schema.prisma:247-265)

  @@index([subscriptionId, createdAt])
  @@index([type, createdAt])
  @@index([bookingId])
}
```

### 4.3. Изменения в `User`

В `prisma/schema.prisma:13-76` к `User` добавить relation:

```prisma
subscriptions Subscription[] @relation("UserSubscriptions")
```

### 4.4. Migration SQL

Файл: `prisma/migrations/20260504120000_subscriptions/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DEPLETED', 'CANCELLED');
CREATE TYPE "SubscriptionTransactionType" AS ENUM ('CHARGE', 'REFUND', 'MANUAL_TOPUP', 'MANUAL_DEDUCT');

-- CreateTable Subscription
CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "moduleSlug" TEXT NOT NULL DEFAULT 'ps-park',
  "userId" TEXT NOT NULL,
  "totalHours" DECIMAL(10,2) NOT NULL,
  "remainingHours" DECIMAL(10,2) NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3) NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "pricePaid" DECIMAL(10,2) NOT NULL,
  "notes" TEXT,
  "cancelReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable SubscriptionTransaction
CREATE TABLE "SubscriptionTransaction" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "type" "SubscriptionTransactionType" NOT NULL,
  "hoursDelta" DECIMAL(10,2) NOT NULL,
  "balanceAfter" DECIMAL(10,2) NOT NULL,
  "bookingId" TEXT,
  "reason" TEXT,
  "performedById" TEXT NOT NULL,
  "performedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionTransaction_pkey" PRIMARY KEY ("id")
);

-- Indices
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");
CREATE INDEX "Subscription_status_validTo_idx" ON "Subscription"("status", "validTo");
CREATE INDEX "Subscription_moduleSlug_createdAt_idx" ON "Subscription"("moduleSlug", "createdAt");
CREATE INDEX "SubscriptionTransaction_subscriptionId_createdAt_idx" ON "SubscriptionTransaction"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionTransaction_type_createdAt_idx" ON "SubscriptionTransaction"("type", "createdAt");
CREATE INDEX "SubscriptionTransaction_bookingId_idx" ON "SubscriptionTransaction"("bookingId");

-- Partial UNIQUE — гарантия "один ACTIVE на userId" на уровне БД (Q2)
CREATE UNIQUE INDEX "subscription_user_active_unique"
  ON "Subscription" ("userId") WHERE "status" = 'ACTIVE';

-- FKs
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SubscriptionTransaction"
  ADD CONSTRAINT "SubscriptionTransaction_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
```

> **Backward compat:** новая таблица + новый enum, ничего не ломает. Существующие модули не затрагиваются.

### 4.5. Seed (idempotent)

Файл: `scripts/seeds/subscriptions.ts` (регистрация в `scripts/seed.ts` orchestrator):

```ts
await prisma.module.upsert({
  where: { slug: "subscriptions" },
  update: { name: "Абонементы PS Park", description: "MVP F6 — предоплаченные часы" },
  create: { slug: "subscriptions", name: "Абонементы PS Park", isActive: true },
});
```

Не трогает `isActive`/`config` при update (правило `CLAUDE.md` §Seed-данные).

---

## 5. Service layer

Файл: `src/modules/subscriptions/service.ts`

### 5.1. `SubscriptionError` (3-arg pattern, аналог F3 `BookingError` и F4 `ClientError` `src/modules/clients/service.ts:22-31`)

```ts
export class SubscriptionError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "SubscriptionError";
    if (metadata) this.metadata = metadata;
  }
}
```

### 5.2. Сигнатуры функций

```ts
// === Public API ===

export async function createSubscription(
  input: CreateSubscriptionInput,
  performedById: string
): Promise<{ id: string }>;
// Validation chain:
//   1. user exists, role === "USER", mergedIntoUserId === null  → INVALID_USER_ROLE / USER_NOT_FOUND
//   2. validFrom < validTo                                       → INVALID_DATE_RANGE
//   3. totalHours > 0, pricePaid >= 0                            → INVALID_HOURS / INVALID_PRICE
//   4. INSERT inside try/catch — partial UNIQUE catch P2002      → ACTIVE_SUBSCRIPTION_EXISTS
//      (с metadata { existingSubscriptionId } через дополнительный SELECT)
//   5. Создать SubscriptionTransaction type=MANUAL_TOPUP, hoursDelta=totalHours, balanceAfter=totalHours,
//      reason="initial purchase" — для единого journal-а
//   6. AuditLog action="subscription.create"
// Возвращает { id } (создатель потом редиректит на /admin/ps-park/subscriptions/[id])

export async function updateSubscription(
  id: string,
  input: UpdateSubscriptionInput,
  performedById: string
): Promise<void>;
// PATCH разрешает менять ТОЛЬКО:
//   - notes      (свободный текст)
//   - pricePaid  (исправление опечатки в сумме)
// Любое поле кроме whitelist в input → INVALID_FIELD (Zod на route уровне).
// validTo / totalHours / userId через PATCH запрещены (Q3).
// Точечный diff (как updateClient: `src/modules/clients/service.ts:755-816`).
// AuditLog action="subscription.update" с diff в metadata.
// No-op при отсутствии изменений (return без update / без audit).

export async function adjustSubscriptionHours(
  id: string,
  input: AdjustHoursInput,
  performedById: string
): Promise<{ balanceAfter: string }>;
// Внутри prisma.$transaction:
//   1. SELECT subscription FOR UPDATE (на случай конкурентного adjust + F7-charge)
//      — Postgres `SELECT ... FOR UPDATE` через `prisma.$queryRaw` или
//        `prisma.subscription.update` с conditional WHERE (см. ниже §5.3).
//   2. Проверить status === ACTIVE → SUBSCRIPTION_NOT_ACTIVE
//   3. delta < 0 → проверка |delta| <= remainingHours → INSUFFICIENT_HOURS (Q4) с metadata { remainingHours, requested }
//   4. type ∈ { MANUAL_TOPUP, MANUAL_DEDUCT } (CHARGE/REFUND запрещены для ручного API)
//   5. UPDATE remainingHours += delta
//   6. INSERT SubscriptionTransaction (immutable)
//   7. Lazy auto-status: если remainingHours == 0 → DEPLETED
//   8. AuditLog action="subscription.update" / metadata.subOp="adjust"
// Reason обязателен (min 3 символа, проверка в Zod).

export async function cancelSubscription(
  id: string,
  input: CancelSubscriptionInput,  // { reason?: string }
  performedById: string
): Promise<void>;
// 1. Валидация: status === ACTIVE → если CANCELLED → ALREADY_CANCELLED, иначе SUBSCRIPTION_NOT_ACTIVE
// 2. UPDATE status=CANCELLED, cancelledAt=now, cancelledById, cancelReason
// 3. remainingHours НЕ меняется (PRD §AC-5.3 — возврат вне системы)
// 4. AuditLog action="subscription.cancel"

export async function listSubscriptions(
  filter: ListSubscriptionsFilter
): Promise<{ items: SubscriptionSummary[]; total: number }>;
// Фильтры: status?, userId?, search? (по имени/телефону юзера)
// Pagination: limit (default 50, max 200), offset.
// Sort: createdAt desc (default), validTo asc (для активных).
// На каждой строке вызывается recomputeStatusIfStale(sub) ДО фильтрации
// (см. §5.3) — иначе ACTIVE с просроченным validTo попадёт в фильтр "Активные".
//
// Performance note: recompute идёт батчем — один WHERE с
// `(status='ACTIVE' AND (validTo < now OR remainingHours <= 0))`
// → один UPDATE, потом основной SELECT.

export async function getSubscription(
  id: string
): Promise<SubscriptionDetail | null>;
// Возвращает: full subscription + user info + transactions[] (orderBy createdAt desc).
// Lazy-recompute status перед возвратом.
// transactions включают bookingId (F7 будет показывать ссылку в UI — F6 просто не null-т поле).

// === Public helper для F7 ===

export async function getActiveSubscriptionForUser(
  userId: string
): Promise<Subscription | null>;
// 1. SELECT subscription WHERE userId AND status='ACTIVE' (благодаря partial UNIQUE — максимум 1).
// 2. Lazy-recompute: если validTo < now → UPDATE status=EXPIRED, return null.
// 3. Если remainingHours <= 0 → UPDATE status=DEPLETED, return null.
// 4. Иначе вернуть subscription.
// F7 будет вызывать эту функцию + adjustSubscriptionHours(type=CHARGE) внутри своей транзакции.
```

### 5.3. Lazy auto-status — реализация

```ts
async function recomputeStatusIfStale(
  sub: { id: string; status: SubscriptionStatus; validTo: Date; remainingHours: Decimal }
): Promise<SubscriptionStatus> {
  if (sub.status !== "ACTIVE") return sub.status;
  const now = new Date();
  // Приоритет EXPIRED над DEPLETED (PRD §Бизнес-правила п.4)
  if (sub.validTo < now) {
    await prisma.subscription.updateMany({
      where: { id: sub.id, status: "ACTIVE" }, // условный UPDATE — concurrent-safe
      data: { status: "EXPIRED" },
    });
    return "EXPIRED";
  }
  if (Number(sub.remainingHours) <= 0) {
    await prisma.subscription.updateMany({
      where: { id: sub.id, status: "ACTIVE" },
      data: { status: "DEPLETED" },
    });
    return "DEPLETED";
  }
  return "ACTIVE";
}
```

`updateMany` с `WHERE status='ACTIVE'` — atomic compare-and-swap, безопасно для concurrent reader/writer (если кто-то уже отменил абонемент, наш UPDATE затронет 0 строк).

### 5.4. Validation (`src/modules/subscriptions/validation.ts`)

```ts
const isoDate = z.string().datetime();

export const createSubscriptionSchema = z.object({
  userId: z.string().min(1, "Гость обязателен"),
  totalHours: z.number().positive("Часы должны быть > 0").multipleOf(0.25, "Шаг 0.25 ч"),
  pricePaid: z.number().min(0, "Цена не может быть отрицательной"),
  validFrom: isoDate,
  validTo: isoDate,
  notes: z.string().max(2000).optional().nullable(),
}).refine((d) => new Date(d.validFrom) < new Date(d.validTo), {
  message: "Дата окончания должна быть позже даты начала",
  path: ["validTo"],
});

export const updateSubscriptionSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
  pricePaid: z.number().min(0).optional(),
}).strict();  // строго whitelist — лишние поля → ошибка

export const adjustHoursSchema = z.object({
  type: z.enum(["MANUAL_TOPUP", "MANUAL_DEDUCT"]),
  hours: z.number().positive().multipleOf(0.25),
  reason: z.string().trim().min(3, "Минимум 3 символа").max(500),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listSubscriptionsSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "DEPLETED", "CANCELLED"]).optional(),
  userId: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
```

---

## 6. API endpoints

| Метод | Путь | Описание | Роль | Доп. проверка | Rate limit |
|-------|------|----------|------|---------------|------------|
| `GET` | `/api/subscriptions` | Список + фильтр | MANAGER+ | `requireAdminSection(session, "ps-park")` | `authenticated` (120/min) |
| `POST` | `/api/subscriptions` | Создать | MANAGER+ | `requireAdminSection(session, "ps-park")` | `authenticated` |
| `GET` | `/api/subscriptions/:id` | Детали + транзакции | MANAGER+ | `requireAdminSection(session, "ps-park")` | `authenticated` |
| `PATCH` | `/api/subscriptions/:id` | notes/pricePaid only | MANAGER+ | `requireAdminSection(session, "ps-park")` | `authenticated` |
| `POST` | `/api/subscriptions/:id/adjust` | Ручная корректировка часов | MANAGER+ | `requireAdminSection(session, "ps-park")` | `authenticated` |
| `POST` | `/api/subscriptions/:id/cancel` | Отмена | SUPERADMIN | `hasRole(session.user, "SUPERADMIN")` | `authenticated` |

> **Расхождение с PRD §API:** PRD пишет "PATCH для корректировки часов или продления validTo". Architect выделяет корректировку в отдельный POST `/adjust` для:
> 1. семантической чистоты (PATCH = частичный update полей сущности; adjust = операция над журналом транзакций);
> 2. соответствия Q3 (продление validTo запрещено вообще);
> 3. согласованности с другими модулями: ручная корректировка инвентаря — отдельный POST `/api/inventory/adjust`, не PATCH.
>
> PO согласовал в Decisions matrix.

### 6.1. RBAC реализация (использует существующие helpers)

```ts
// /api/subscriptions/route.ts
import { auth } from "@/lib/auth";
import { requireAdminSection, apiError, apiResponse } from "@/lib/api-response";

export async function GET(request: Request) {
  const session = await auth();
  const denied = await requireAdminSection(session, "ps-park");
  if (denied) return denied;
  // ... rate limit, parse, validate, call service
}
```

`requireAdminSection` (`src/lib/api-response.ts:76-95`) уже покрывает: SUPERADMIN/ADMIN → автодоступ, MANAGER → check `AdminPermission(userId, "ps-park")`.

Для cancel — отдельная проверка `hasRole(session.user, "SUPERADMIN")` (PRD §AC-5.1: только суперадмин отменяет; MANAGER может только запросить отмену).

### 6.2. Формат ответов (стандартный, через `apiResponse`/`apiError`)

```jsonc
// 201 POST /api/subscriptions success
{ "success": true, "data": { "id": "clxyz..." } }

// 409 conflict (partial UNIQUE caught)
{
  "success": false,
  "error": {
    "code": "ACTIVE_SUBSCRIPTION_EXISTS",
    "message": "У гостя уже есть активный абонемент",
    "metadata": { "existingSubscriptionId": "clabc..." }
  }
}

// 422 INSUFFICIENT_HOURS
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_HOURS",
    "message": "На балансе недостаточно часов",
    "metadata": { "remainingHours": "1.50", "requested": "2.00" }
  }
}
```

### 6.3. Маппинг error codes → HTTP status

| code | HTTP |
|------|------|
| `USER_NOT_FOUND` | 404 |
| `INVALID_USER_ROLE` | 422 |
| `INVALID_DATE_RANGE`, `INVALID_HOURS`, `INVALID_PRICE` | 422 (через `apiValidationError`) |
| `ACTIVE_SUBSCRIPTION_EXISTS` | 409 |
| `SUBSCRIPTION_NOT_FOUND` | 404 |
| `SUBSCRIPTION_NOT_ACTIVE` | 409 |
| `ALREADY_CANCELLED` | 409 |
| `INSUFFICIENT_HOURS` | 422 |
| `INVALID_FIELD` (Zod strict) | 422 |

Route handlers ловят `SubscriptionError`, маппят `code → status` через единый switch (как делают `gazebos/cafe/ps-park` route handlers).

### 6.4. Защита от injection

- Все строковые поля проходят через Zod (`max` + `trim`). 
- `userId`, `id` — cuid format, передаются в Prisma как параметры (нет string concat).
- `notes`, `reason`, `cancelReason` — отображаются в UI с эскейпингом React (default).
- Никаких URL/file paths/SQL-like строк не принимается — SSRF/injection не применимы.

---

## 7. UI

### 7.1. Список — `src/app/admin/ps-park/subscriptions/page.tsx`

- Server Component, fetch через service напрямую (как в `/admin/ps-park/clients/page.tsx`).
- Header: "Абонементы PS Park", кнопка "Создать абонемент" (открывает modal).
- Filter chips: Все / Активные / Истекли / Исчерпаны / Отменены — обновляют `?status=` query param.
- Search input по имени/телефону гостя (debounced).
- Таблица: гость (имя + телефон) | куплено | остаток | статус (badge с цветом) | срок (validFrom – validTo) | создано | actions.
- Каждая строка — `<Link href="/admin/ps-park/subscriptions/[id]">`.
- Pagination 50/page.

### 7.2. Карточка — `src/app/admin/ps-park/subscriptions/[id]/page.tsx`

- Header: гость + статус-badge.
- Карточка summary: куплено / осталось / использовано часов, прогресс-бар, validFrom – validTo, цена.
- Action buttons: "Ручная корректировка" (modal), "Отменить абонемент" (confirm dialog, только SUPERADMIN), "Редактировать notes/pricePaid" (modal).
- Таблица транзакций (server-rendered):
  - Колонки: дата | тип (badge) | изменение часов | остаток после | кто | примечание | bookingId (link, если не null — F7-ready).
  - Sort: createdAt desc.

### 7.3. Form компонент — `src/components/admin/subscriptions/subscription-form.tsx`

- Client Component, используется в create modal (на странице списка) и edit modal (на странице детали).
- Поля: typeahead client search (через `/api/admin/clients?search=...` — F4 ADR), totalHours (number, step 0.25), pricePaid (number), validFrom + validTo (date inputs, default validFrom=today, validTo=today+30d), notes (textarea).
- Edit mode: блокирует userId/totalHours/validFrom/validTo (read-only), показывает только notes/pricePaid.
- Предпросмотр валидации в реальном времени через тот же `createSubscriptionSchema` (re-validate в client).
- При 409 `ACTIVE_SUBSCRIPTION_EXISTS` — inline error с кнопкой "Перейти к существующему" (ссылка на `metadata.existingSubscriptionId`).

### 7.4. Adjust modal — `src/components/admin/subscriptions/adjust-hours-modal.tsx`

- Поля: type (radio: Пополнение / Списание), hours (number, step 0.25), reason (textarea, min 3).
- Отображает текущий remainingHours и предпросмотр "после операции".
- При INSUFFICIENT_HOURS — inline error.

### 7.5. Cancel modal — `src/components/admin/subscriptions/cancel-subscription-modal.tsx`

- Только для SUPERADMIN (UI скрывает кнопку через session check).
- Поле: reason (textarea, optional).
- Confirm-button с warning "Возврат денег вне системы".

### 7.6. Вкладка в карточке гостя — `src/components/admin/clients/client-profile.tsx`

- Добавить вкладку "Абонементы" в существующий `<Tabs>` рядом с "Бронирования" / "Заказы".
- Контент: `<SubscriptionsTab userId={user.id} />` — fetch `/api/subscriptions?userId=...`.
- Empty state: "Абонементов нет" + кнопка "Создать абонемент" (открывает форму с предзаполненным userId).
- Каждая строка — Link на `/admin/ps-park/subscriptions/[id]`.

---

## 8. Тест-план (минимум 8 unit-тестов)

Файл: `src/modules/subscriptions/__tests__/service.test.ts`. Mock `@/lib/db` через `vi.mock` (как в существующих тестах модулей; см. `src/modules/clients/__tests__/service.test.ts` если есть, иначе шаблон из `src/modules/cafe/__tests__/service.test.ts`).

| # | Тест | Что проверяем |
|---|------|---------------|
| 1 | `createSubscription happy path` | success → returns `{id}`, создан Subscription + первая транзакция MANUAL_TOPUP, AuditLog `subscription.create` |
| 2 | `createSubscription rejects duplicate ACTIVE` | mock prisma.create → throws `P2002` (unique violation) → `SubscriptionError("ACTIVE_SUBSCRIPTION_EXISTS")` с metadata.existingSubscriptionId |
| 3 | `createSubscription rejects non-USER role` | mock user.role=MANAGER → `INVALID_USER_ROLE` |
| 4 | `createSubscription rejects user not found / tombstoned` | mergedIntoUserId set → `USER_NOT_FOUND` |
| 5 | `updateSubscription happy path notes only` | diff применяется, AuditLog содержит changes.notes |
| 5b | `updateSubscription no-op when no changes` | input идентичен existing → no UPDATE, no AuditLog |
| 6 | `cancelSubscription happy path` | ACTIVE → CANCELLED, cancelledAt/cancelledById/cancelReason заполнены, AuditLog `subscription.cancel`, remainingHours unchanged |
| 7 | `cancelSubscription fails when not ACTIVE` | EXPIRED → `SUBSCRIPTION_NOT_ACTIVE`; CANCELLED → `ALREADY_CANCELLED` |
| 8 | `listSubscriptions filter by status` | передан `status="ACTIVE"` → prisma.findMany получает `where.status="ACTIVE"` |
| 9 | `getSubscription with transactions history` | mock returns sub + 3 transactions → response содержит обе сущности, transactions sorted desc by createdAt |
| 10 | `adjustSubscriptionHours INSUFFICIENT_HOURS` | remainingHours=1, requested deduct=2 → throws с metadata `{remainingHours: "1.00", requested: "2.00"}` |
| 11 | `adjustSubscriptionHours MANUAL_TOPUP success` | balanceAfter правильно посчитан, новая SubscriptionTransaction создана |
| 12 | `getActiveSubscriptionForUser auto-EXPIRED` | validTo в прошлом → UPDATE status=EXPIRED, return null |
| 13 | `getActiveSubscriptionForUser auto-DEPLETED` | remainingHours=0 → UPDATE status=DEPLETED, return null |

Тесты 1–8 — must-have. 9–13 — желательно для покрытия всей бизнес-логики.

Также route-tests (минимум по одному happy + один error path для каждого endpoint) — `src/app/api/subscriptions/__tests__/route.test.ts`.

---

## 9. Файлы для изменения / создания

### Создать

| Путь | Назначение |
|------|------------|
| `prisma/migrations/20260504120000_subscriptions/migration.sql` | Schema migration + partial UNIQUE |
| `src/modules/subscriptions/service.ts` | Бизнес-логика (см. §5) |
| `src/modules/subscriptions/validation.ts` | Zod schemas (см. §5.4) |
| `src/modules/subscriptions/types.ts` | TS-типы для UI: `SubscriptionSummary`, `SubscriptionDetail`, `SubscriptionTransactionView` |
| `src/modules/subscriptions/__tests__/service.test.ts` | Unit-тесты (§8) |
| `src/app/api/subscriptions/route.ts` | GET list + POST create |
| `src/app/api/subscriptions/[id]/route.ts` | GET detail + PATCH |
| `src/app/api/subscriptions/[id]/adjust/route.ts` | POST adjust hours |
| `src/app/api/subscriptions/[id]/cancel/route.ts` | POST cancel (SUPERADMIN-only) |
| `src/app/api/subscriptions/__tests__/route.test.ts` | Route handler tests |
| `src/app/admin/ps-park/subscriptions/page.tsx` | Список |
| `src/app/admin/ps-park/subscriptions/[id]/page.tsx` | Карточка + журнал |
| `src/components/admin/subscriptions/subscription-form.tsx` | Create/edit form |
| `src/components/admin/subscriptions/adjust-hours-modal.tsx` | Manual adjust |
| `src/components/admin/subscriptions/cancel-subscription-modal.tsx` | Cancel confirm |
| `src/components/admin/subscriptions/subscriptions-list-table.tsx` | Таблица для list page и client tab |
| `scripts/seeds/subscriptions.ts` | Module registry seed |

### Изменить

| Путь | Изменение |
|------|-----------|
| `prisma/schema.prisma` | Добавить enum `SubscriptionStatus`, `SubscriptionTransactionType`, models `Subscription`, `SubscriptionTransaction`. В `User` (стр. 13–76) — добавить `subscriptions Subscription[] @relation("UserSubscriptions")`. |
| `scripts/seed.ts` | Зарегистрировать `seedSubscriptions` в orchestrator |
| `src/components/admin/clients/client-profile.tsx` | Добавить вкладку "Абонементы" (см. §7.6) |
| `src/components/admin/ps-park/admin-nav.tsx` (или эквивалент) | Добавить пункт "Абонементы" в side nav PS Park |
| `CLAUDE.md` | Раздел "Реальный список модулей": добавить `subscriptions \| Phase 5.x \| абонементы PS Park`. **Тот же PR** (правило anti-scope-creep). |

### НЕ изменяется в F6 (явно)

- **`src/lib/permissions.ts` `ADMIN_SECTIONS`** — НЕ добавляем `subscriptions` в список, потому что это под-раздел `ps-park` (URL `/admin/ps-park/subscriptions`), и доступ контролируется через `requireAdminSection(session, "ps-park")`. Отдельный AdminPermission для `subscriptions` создаст лишнюю сущность для менеджеров (им придётся включать обе). Если в будущем нужен отдельный grant — добавим как breaking-change в новом ADR.
- F7-логика (charge при `booking.status → COMPLETED`) — отдельный ADR.
- Public-facing endpoints для USER (просмотр своего абонемента) — out of scope (PRD §Вне скоупа).
- Refund/возврат денег — out of scope (PRD §AC-5.3 — вне системы).

---

## 10. Влияние на существующие модули

| Модуль | Влияние |
|--------|---------|
| `clients` | UI: новая вкладка "Абонементы" в `client-profile.tsx`. API не меняется (используется `/api/admin/clients` typeahead в форме). |
| `ps-park` | UI: новый пункт навигации `/admin/ps-park/subscriptions`. Service — без изменений (charge — F7). |
| `booking` | Без изменений в F6. F7 будет читать `getActiveSubscriptionForUser` из `subscriptions` модуля при `transitionStatus(COMPLETED)`. |
| `users` | Без изменений (роль USER уже существует). |
| `monitoring` | Без изменений. Health check для модуля `subscriptions` — добавим в Phase 5.x вместе с cron (сейчас не требуется по PRD). |

---

## 11. Чек-лист перед передачей Developer

- [x] ADR написан, с реальными `path:line` ссылками на образцы.
- [x] Prisma schema описана + raw SQL для partial UNIQUE.
- [x] API контракты определены, RBAC проставлен, rate limit указан.
- [x] Zod схемы размечены (whitelist на PATCH, `multipleOf(0.25)` на часы).
- [x] Миграция данных не нужна (новая таблица).
- [x] Backward compat: ничего не ломается.
- [x] Decisions matrix закрывает все 4 open questions PO.
- [x] Test plan ≥ 8 unit-тестов + route tests.
- [x] Anti-scope-creep: F7 (charge/drilldown) явно вне скоупа; CLAUDE.md обновляется в том же PR.
- [x] Security: injection/SSRF не применимы (нет URL/path/SQL inputs); все мутации в AuditLog.
