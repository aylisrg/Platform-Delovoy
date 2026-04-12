# ADR: Booking Engine v2 — Phase 1A (Core Booking Improvements)

**Дата:** 2026-04-12  
**Статус:** Accepted  
**Автор:** System Architect  
**Модули:** ps-park, gazebos (общий движок)  
**PRD:** Booking Engine v2 — Phase 1A

---

## Контекст

Текущий движок бронирований реализует жизненный цикл `PENDING → CONFIRMED → COMPLETED / CANCELLED`. В процессе эксплуатации выявлены четыре системных пробела: отсутствие фиксации чек-ина, отсутствие политики отмены со штрафом, ручной процесс фиксации no-show и отсутствие сохранения стоимости брони в момент создания.

Phase 1A решает все четыре проблемы с минимальными изменениями схемы БД (только enum) и вводит общий модуль `src/modules/booking/` для устранения дублирования логики между ps-park и gazebos.

---

## Решение

### 1. Изменения схемы БД

#### 1.1 Единственная миграция: расширение enum `BookingStatus`

```prisma
enum BookingStatus {
  PENDING
  CONFIRMED
  CHECKED_IN   // новый: клиент отмечен как пришедший
  NO_SHOW      // новый: клиент не пришёл
  CANCELLED
  COMPLETED
}
```

SQL-миграция (Prisma генерирует автоматически):
```sql
ALTER TYPE "BookingStatus" ADD VALUE 'CHECKED_IN';
ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW';
```

#### 1.2 Поле `metadata` — расширение без миграции

Все новые данные хранятся в существующем поле `metadata: Json?` модели `Booking`. Это принципиальное решение: ни одной новой колонки не добавляется.

**Полная схема metadata после Phase 1A:**

```typescript
type BookingMetadata = {
  // Существующие поля
  playerCount?: number;          // ps-park
  guestCount?: number;           // gazebos
  comment?: string;
  bookedByAdmin?: boolean;
  items?: BookingItemSnapshot[];
  itemsTotal?: string;           // decimal строка

  // Новые поля Phase 1A

  // US-4: Ценообразование
  basePrice?: string;            // decimal строка: pricePerHour × часы
  pricePerHour?: string;         // зафиксированная pricePerHour на момент создания
  totalPrice?: string;           // basePrice + itemsTotal

  // US-3: Чек-ин
  checkedInAt?: string;          // ISO datetime
  checkedInBy?: string;          // userId менеджера
  lateCheckedInAt?: string;      // ISO datetime, если NO_SHOW → CHECKED_IN

  // US-3: No-show
  noShowAt?: string;             // ISO datetime
  noShowReason?: "auto" | "manual"; // "auto" от крона, "manual" от менеджера

  // US-2: Политика отмены
  cancelPenalty?: {
    amount: string;              // decimal строка
    reason: string;
    appliedAt: string;           // ISO datetime
  };
}
```

#### 1.3 Конфиг модуля (Module.config)

Пороги настраиваются через `Module.config` в БД, без изменения кода:

```json
{
  "booking": {
    "cancellationPenaltyThresholdHours": 2,
    "cancellationPenaltyPercent": 50,
    "autoNoShowAfterMinutes": 30
  }
}
```

Дефолтные значения: 2 часа порог, 50% штраф, 30 минут до авто-no-show.

---

### 2. Машина состояний

#### 2.1 Граф переходов

```
              ┌──────────────────────────────────────────────────────┐
              │                                                        │
           PENDING ──── confirm (менеджер) ───► CONFIRMED             │
              │                                    │                   │
              │                            ┌───────┼──────────────┐   │
              │                            │       │              │   │
              ▼                            ▼       ▼              ▼   │
          CANCELLED◄── cancel (клиент/  CHECKED_IN  NO_SHOW    COMPLETED
          (штраф если  менеджер)            │         │
          < 2ч от                           │         │
          startTime)                        │         │
                                            ▼         │
                                        COMPLETED     │
                                                      │
                                        CHECKED_IN ◄──┘
                                     (опоздавший)
```

#### 2.2 Таблица допустимых переходов

| Откуда | Куда | Условие | Актор |
|--------|------|---------|-------|
| `PENDING` | `CONFIRMED` | — | MANAGER / SUPERADMIN |
| `PENDING` | `CANCELLED` | — | CLIENT / MANAGER / SUPERADMIN |
| `CONFIRMED` | `CANCELLED` | — | CLIENT (со штрафом если < 2ч) / MANAGER (без штрафа) / SUPERADMIN (без штрафа) |
| `CONFIRMED` | `CHECKED_IN` | `now >= startTime` | MANAGER / SUPERADMIN |
| `CONFIRMED` | `NO_SHOW` | `now >= startTime + 30min` | MANAGER (вручную) / CRON (авто) |
| `CONFIRMED` | `COMPLETED` | — | MANAGER / SUPERADMIN (прямое завершение без чек-ина) |
| `CHECKED_IN` | `COMPLETED` | — | MANAGER / SUPERADMIN |
| `NO_SHOW` | `CHECKED_IN` | — | MANAGER / SUPERADMIN (опоздавший клиент) |
| `NO_SHOW` | `CANCELLED` | — | MANAGER / SUPERADMIN |
| `CANCELLED` | — | недопустимо | — |
| `COMPLETED` | — | недопустимо | — |

#### 2.3 Политика отмены — условная логика

```
cancelBooking(id, actorId, actorRole):
  if actorRole IN [MANAGER, SUPERADMIN]:
    → CANCELLED, без штрафа
  else: // CLIENT
    hoursUntilStart = (booking.startTime - now) / 3600
    threshold = moduleConfig.cancellationPenaltyThresholdHours  // default: 2
    if hoursUntilStart >= threshold:
      → CANCELLED, без штрафа
    else:
      penalty = booking.metadata.basePrice * (moduleConfig.cancellationPenaltyPercent / 100)
      → требует подтверждения клиента (флаг confirmPenalty в запросе)
      → CANCELLED, metadata.cancelPenalty = { amount, reason, appliedAt }
```

---

### 3. Общий модуль `src/modules/booking/`

Логика, которая дублируется между ps-park и gazebos, выносится в общий модуль.

#### 3.1 Структура файлов

```
src/modules/booking/
├── state-machine.ts      # Граф переходов, валидатор
├── cancellation.ts       # Политика отмены со штрафом
├── pricing.ts            # Вычисление basePrice / totalPrice
├── checkin.ts            # Логика чек-ина и no-show
└── types.ts              # Shared типы: BookingMetadata, CancellationResult и др.
```

#### 3.2 `state-machine.ts` — публичный API

```typescript
import type { BookingStatus } from "@prisma/client";

export type ActorRole = "CLIENT" | "MANAGER" | "SUPERADMIN" | "CRON";

export type TransitionContext = {
  currentStatus: BookingStatus;
  targetStatus: BookingStatus;
  actorRole: ActorRole;
  now: Date;
  startTime: Date;
  noShowThresholdMinutes: number; // из moduleConfig
};

/**
 * Validates whether a status transition is allowed.
 * Throws BookingTransitionError with code if not.
 */
export function assertValidTransition(ctx: TransitionContext): void;

export class BookingTransitionError extends Error {
  code: string;
}
```

#### 3.3 `cancellation.ts` — публичный API

```typescript
export type CancellationPolicy = {
  thresholdHours: number;   // default: 2
  penaltyPercent: number;   // default: 50
};

export type CancellationResult =
  | { penaltyApplied: false }
  | { penaltyApplied: true; penaltyAmount: number; basePrice: number };

/**
 * Calculates cancellation penalty for a CLIENT cancellation.
 * MANAGER/SUPERADMIN always get penaltyApplied: false (call with skipPolicy: true).
 */
export function computeCancellationPenalty(
  startTime: Date,
  now: Date,
  basePrice: number,
  policy: CancellationPolicy,
  skipPolicy: boolean
): CancellationResult;
```

#### 3.4 `pricing.ts` — публичный API

```typescript
/**
 * Computes basePrice and totalPrice at booking creation time.
 * Snapshots pricePerHour from resource — changes to resource don't affect existing bookings.
 */
export function computeBookingPricing(
  startTime: Date,
  endTime: Date,
  pricePerHour: number | null,
  itemsTotal: number
): {
  pricePerHour: string;
  basePrice: string;
  totalPrice: string;
};
```

#### 3.5 `checkin.ts` — публичный API

```typescript
export type CheckInResult = {
  checkedInAt: string;
  checkedInBy: string;
};

export type NoShowResult = {
  noShowAt: string;
  noShowReason: "auto" | "manual";
};

export function buildCheckInMetadata(managerId: string, now: Date): CheckInResult;
export function buildNoShowMetadata(reason: "auto" | "manual", now: Date): NoShowResult;

/**
 * Returns list of CONFIRMED booking IDs that should be auto-marked NO_SHOW.
 * Condition: now >= startTime + noShowThresholdMinutes AND status = CONFIRMED.
 */
export async function findAutoNoShowCandidates(
  moduleSlug: string,
  noShowThresholdMinutes: number
): Promise<string[]>;
```

#### 3.6 `types.ts` — shared типы

```typescript
export type BookingMetadata = {
  // Существующие
  playerCount?: number;
  guestCount?: number;
  comment?: string;
  bookedByAdmin?: boolean;
  items?: unknown[];
  itemsTotal?: string;
  // Phase 1A
  pricePerHour?: string;
  basePrice?: string;
  totalPrice?: string;
  checkedInAt?: string;
  checkedInBy?: string;
  lateCheckedInAt?: string;
  noShowAt?: string;
  noShowReason?: "auto" | "manual";
  cancelPenalty?: {
    amount: string;
    reason: string;
    appliedAt: string;
  };
};

export type ModuleBookingConfig = {
  cancellationPenaltyThresholdHours: number;
  cancellationPenaltyPercent: number;
  autoNoShowAfterMinutes: number;
};

export const DEFAULT_MODULE_BOOKING_CONFIG: ModuleBookingConfig = {
  cancellationPenaltyThresholdHours: 2,
  cancellationPenaltyPercent: 50,
  autoNoShowAfterMinutes: 30,
};
```

---

### 4. API-контракты

Все новые эндпоинты следуют паттерну: `PATCH /api/{module}/bookings/{id}/{action}`. Существующий `PATCH /api/{module}/bookings/{id}` (смена статуса менеджером) расширяется для поддержки новых статусов.

#### 4.1 Чек-ин — `POST /api/{module}/bookings/{id}/checkin`

**Актор:** MANAGER / SUPERADMIN  
**Условие:** `booking.status === "CONFIRMED"` и `now >= booking.startTime`

Request:
```http
POST /api/ps-park/bookings/{id}/checkin
Authorization: Bearer <session_token>
Content-Type: application/json

{}
```

Response 200:
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "CHECKED_IN",
    "metadata": {
      "checkedInAt": "2026-04-12T14:05:00.000Z",
      "checkedInBy": "clx_manager_id"
    }
  }
}
```

Error 409 (слишком рано):
```json
{
  "success": false,
  "error": {
    "code": "CHECKIN_TOO_EARLY",
    "message": "Чек-ин доступен только после начала сессии"
  }
}
```

Error 409 (неверный статус):
```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Нельзя перевести из PENDING в CHECKED_IN"
  }
}
```

#### 4.2 Ручной no-show — `POST /api/{module}/bookings/{id}/no-show`

**Актор:** MANAGER / SUPERADMIN  
**Условие:** `booking.status === "CONFIRMED"` и `now >= booking.startTime + noShowThresholdMinutes`

Request:
```http
POST /api/ps-park/bookings/{id}/no-show
Authorization: Bearer <session_token>
Content-Type: application/json

{}
```

Response 200:
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "NO_SHOW",
    "metadata": {
      "noShowAt": "2026-04-12T14:35:00.000Z",
      "noShowReason": "manual"
    }
  }
}
```

#### 4.3 Late check-in (NO_SHOW → CHECKED_IN) — `POST /api/{module}/bookings/{id}/checkin`

Тот же эндпоинт `/checkin`. Логика:
- Если `status === "NO_SHOW"` → разрешён переход в `CHECKED_IN`
- В metadata добавляется `lateCheckedInAt` вместо `checkedInAt`

Response 200:
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "CHECKED_IN",
    "metadata": {
      "checkedInAt": "2026-04-12T14:05:00.000Z",
      "checkedInBy": "clx_manager_id",
      "noShowAt": "2026-04-12T14:35:00.000Z",
      "noShowReason": "auto",
      "lateCheckedInAt": "2026-04-12T14:50:00.000Z"
    }
  }
}
```

#### 4.4 Отмена с политикой штрафа — расширение `cancelBooking`

Клиентская отмена: `DELETE /api/{module}/bookings/{id}` (существующий)

Request body расширяется:
```json
{
  "cancelReason": "Изменились планы",
  "confirmPenalty": true
}
```

Response 200 (отмена без штрафа):
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "CANCELLED",
    "penaltyApplied": false
  }
}
```

Response 200 (отмена со штрафом, `confirmPenalty: true`):
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "CANCELLED",
    "penaltyApplied": true,
    "penaltyAmount": "500.00",
    "metadata": {
      "cancelPenalty": {
        "amount": "500.00",
        "reason": "Отмена менее чем за 2 часа до начала",
        "appliedAt": "2026-04-12T12:00:00.000Z"
      }
    }
  }
}
```

Response 402 (требуется подтверждение штрафа, `confirmPenalty` не передан или `false`):
```json
{
  "success": false,
  "error": {
    "code": "PENALTY_CONFIRMATION_REQUIRED",
    "message": "Отмена менее чем за 2 часа. Штраф: 500.00 ₽ (50% от стоимости). Передайте confirmPenalty: true для подтверждения."
  }
}
```

#### 4.5 Крон — `GET /api/cron/no-show`

**Актор:** внешний крон (Vercel Cron / systemd / cron)  
**Авторизация:** `Authorization: Bearer ${CRON_SECRET}` (env)

Request:
```http
GET /api/cron/no-show
Authorization: Bearer <CRON_SECRET>
```

Response 200:
```json
{
  "success": true,
  "data": {
    "processed": 3,
    "bookingIds": ["clx_a", "clx_b", "clx_c"]
  }
}
```

Response 401 (неверный токен):
```json
{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "Invalid cron token" }
}
```

#### 4.6 Изменение статуса менеджером — расширение `PATCH /api/{module}/bookings/{id}`

Существующий эндпоинт принимает новые значения статуса без изменения контракта:

Request:
```json
{ "status": "CHECKED_IN" }
```
или
```json
{ "status": "NO_SHOW" }
```

Валидация на уровне `assertValidTransition()` в service.ts.

---

### 5. Крон-задача авто-no-show

#### 5.1 Реализация

Файл: `src/app/api/cron/no-show/route.ts`

```typescript
import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized } from "@/lib/api-response";
import { findAutoNoShowCandidates, buildNoShowMetadata } from "@/modules/booking/checkin";
import { prisma } from "@/lib/db";
import { getModuleBookingConfig } from "@/modules/booking/config";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!authHeader || authHeader !== expected) {
    return apiUnauthorized("Invalid cron token");
  }

  const results: string[] = [];
  const now = new Date();

  for (const moduleSlug of ["ps-park", "gazebos"]) {
    const config = await getModuleBookingConfig(moduleSlug);
    const candidates = await findAutoNoShowCandidates(moduleSlug, config.autoNoShowAfterMinutes);

    for (const bookingId of candidates) {
      const noShowMeta = buildNoShowMetadata("auto", now);
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) continue;
      const existingMeta = (booking.metadata as Record<string, unknown>) ?? {};
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "NO_SHOW",
          metadata: { ...existingMeta, ...noShowMeta },
        },
      });
      results.push(bookingId);
    }
  }

  return apiResponse({ processed: results.length, bookingIds: results });
}
```

#### 5.2 Конфигурация крона

**Vercel (`vercel.json`):**
```json
{
  "crons": [
    {
      "path": "/api/cron/no-show",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**Системный cron (VPS, `/etc/cron.d/delovoy-no-show`):**
```cron
*/5 * * * * root curl -s -H "Authorization: Bearer ${CRON_SECRET}" https://delovoy-park.ru/api/cron/no-show
```

#### 5.3 Переменная окружения

Добавить в `.env`:
```env
CRON_SECRET="generate-a-secure-random-string"
```

---

### 6. Изменения в существующих сервисах

#### 6.1 `src/modules/ps-park/service.ts`

**`createBooking` и `createAdminBooking` — добавить ценообразование (US-4):**

```typescript
// После получения resource, перед prisma.booking.create:
import { computeBookingPricing } from "@/modules/booking/pricing";

const pricing = computeBookingPricing(
  start,
  end,
  Number(resource.pricePerHour ?? 0),
  itemsTotal
);

// В data.metadata добавить:
metadata: {
  ...existingMetaFields,
  pricePerHour: pricing.pricePerHour,
  basePrice: pricing.basePrice,
  totalPrice: pricing.totalPrice,
}
```

**`updateBookingStatus` — добавить поддержку новых статусов:**

```typescript
// Заменить hardcoded validTransitions на вызов assertValidTransition:
import { assertValidTransition } from "@/modules/booking/state-machine";
import { getModuleBookingConfig } from "@/modules/booking/config";

const config = await getModuleBookingConfig(MODULE_SLUG);
assertValidTransition({
  currentStatus: booking.status,
  targetStatus: status,
  actorRole,                       // новый параметр функции
  now: new Date(),
  startTime: booking.startTime,
  noShowThresholdMinutes: config.autoNoShowAfterMinutes,
});
```

Сигнатура `updateBookingStatus` расширяется:
```typescript
// Было:
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string
)

// Стало:
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  actorRole: ActorRole = "MANAGER"  // с дефолтом для backward compat
)
```

**`cancelBooking` — добавить политику штрафа (US-2):**

```typescript
// Было:
export async function cancelBooking(id: string, userId: string, cancelReason?: string)

// Стало:
export async function cancelBooking(
  id: string,
  userId: string,
  cancelReason?: string,
  actorRole: ActorRole = "CLIENT",
  confirmPenalty = false
): Promise<{ booking: Booking; penaltyApplied: boolean; penaltyAmount?: number }>
```

Внутри функции:
```typescript
import { computeCancellationPenalty } from "@/modules/booking/cancellation";
import { getModuleBookingConfig } from "@/modules/booking/config";

const config = await getModuleBookingConfig(MODULE_SLUG);
const meta = booking.metadata as BookingMetadata | null;
const basePrice = Number(meta?.basePrice ?? 0);

const penaltyResult = computeCancellationPenalty(
  booking.startTime,
  new Date(),
  basePrice,
  {
    thresholdHours: config.cancellationPenaltyThresholdHours,
    penaltyPercent: config.cancellationPenaltyPercent,
  },
  actorRole !== "CLIENT"  // skipPolicy для MANAGER/SUPERADMIN
);

if (penaltyResult.penaltyApplied && !confirmPenalty) {
  throw new PSBookingError(
    "PENALTY_CONFIRMATION_REQUIRED",
    `Отмена менее чем за ${config.cancellationPenaltyThresholdHours} часа. Штраф: ${penaltyResult.penaltyAmount} ₽`
  );
}
```

**`extendBooking` — обновлять `totalPrice` в metadata (US-4, AC-4.4):**

```typescript
// После обновления endTime, обновить ценообразование:
const existingMeta = (booking.metadata as BookingMetadata) ?? {};
const fixedPricePerHour = Number(existingMeta.pricePerHour ?? resource?.pricePerHour ?? 0);
const newPricing = computeBookingPricing(
  booking.startTime,
  newEndTime,
  fixedPricePerHour,  // используем зафиксированную цену, не текущую resource.pricePerHour
  Number(existingMeta.itemsTotal ?? 0)
);
// Включить в data обновления: metadata: { ...existingMeta, ...newPricing }
```

**Новые функции `checkIn` и `markNoShow` в ps-park/service.ts:**

```typescript
export async function checkInBooking(id: string, managerId: string) {
  // Делегирует в общую логику, специфичная обёртка для MODULE_SLUG
}

export async function markNoShow(id: string, managerId: string) {
  // Делегирует в общую логику
}
```

#### 6.2 `src/modules/gazebos/service.ts`

Те же изменения, что и для ps-park: ценообразование в create/createAdmin, новые функции `checkInBooking` и `markNoShow`, расширение `cancelBooking` с политикой штрафа, обновление `updateBookingStatus` через `assertValidTransition`.

Дублирования нет — вся логика в `src/modules/booking/`, сервисы только оркеструют вызовы с правильным `MODULE_SLUG`.

---

### 7. Конфиг-утилита

Файл: `src/modules/booking/config.ts`

```typescript
import { prisma } from "@/lib/db";
import type { ModuleBookingConfig } from "./types";
import { DEFAULT_MODULE_BOOKING_CONFIG } from "./types";

/**
 * Reads booking config from Module.config JSONB field.
 * Falls back to defaults if module not found or config not set.
 */
export async function getModuleBookingConfig(
  moduleSlug: string
): Promise<ModuleBookingConfig> {
  const module = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { config: true },
  });

  if (!module?.config) return DEFAULT_MODULE_BOOKING_CONFIG;

  const raw = module.config as Record<string, unknown>;
  const booking = (raw.booking ?? {}) as Partial<ModuleBookingConfig>;

  return {
    cancellationPenaltyThresholdHours:
      booking.cancellationPenaltyThresholdHours ??
      DEFAULT_MODULE_BOOKING_CONFIG.cancellationPenaltyThresholdHours,
    cancellationPenaltyPercent:
      booking.cancellationPenaltyPercent ??
      DEFAULT_MODULE_BOOKING_CONFIG.cancellationPenaltyPercent,
    autoNoShowAfterMinutes:
      booking.autoNoShowAfterMinutes ??
      DEFAULT_MODULE_BOOKING_CONFIG.autoNoShowAfterMinutes,
  };
}
```

---

### 8. Backward Compatibility

#### 8.1 Существующие вызовы `updateBookingStatus`

Новый параметр `actorRole` добавляется с дефолтным значением `"MANAGER"`. Все существующие вызовы продолжают работать без изменений.

#### 8.2 Существующие вызовы `cancelBooking`

Новые параметры `actorRole` и `confirmPenalty` добавляются с дефолтными значениями `"CLIENT"` и `false`. Текущее поведение (клиентская отмена без штрафа) сохраняется для существующих вызовов только если `basePrice` в metadata не установлен (старые брони без ценообразования).

```typescript
// В computeCancellationPenalty:
if (basePrice === 0) return { penaltyApplied: false }; // старые брони без цены
```

#### 8.3 Существующие статусы в БД

`CHECKED_IN` и `NO_SHOW` добавляются к enum через `ADD VALUE` — это аддитивная операция, не ломающая существующие записи со старыми статусами.

#### 8.4 Конфликты в `listBookings` и `getAvailability`

В `getAvailability` и `getTimeline` статусы `CHECKED_IN` и `NO_SHOW` необходимо добавить в фильтры занятости:

```typescript
// Было:
status: { in: ["PENDING", "CONFIRMED"] }

// Стало (CHECKED_IN — клиент пришёл, слот занят; NO_SHOW — слот освободить не нужно т.к. время уже прошло):
status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }
```

`NO_SHOW` не включается в фильтр занятости: если клиент не пришёл, ресурс технически свободен (но время уже прошло — практического значения для availability не имеет).

#### 8.5 TypeScript — расширение `BookingStatus`

После миграции Prisma автоматически регенерирует enum `BookingStatus` с новыми значениями. `switch/case` на статусе должны быть обновлены (TypeScript strict покажет exhaustive check warnings). Ключевые места:

- `src/modules/ps-park/service.ts`: `validTransitions`, `notificationType` switch
- `src/modules/gazebos/service.ts`: те же места
- Любые компоненты UI, отображающие статус брони

---

### 9. Тесты

По правилу CLAUDE.md — тесты пишутся вместе с кодом в том же PR.

| Файл теста | Что покрывает |
|------------|---------------|
| `src/modules/booking/__tests__/state-machine.test.ts` | Все допустимые и недопустимые переходы |
| `src/modules/booking/__tests__/cancellation.test.ts` | Пограничные случаи политики штрафа (ровно 2 часа, < 2 часа, актор MANAGER) |
| `src/modules/booking/__tests__/pricing.test.ts` | Расчёт basePrice/totalPrice, нулевой pricePerHour |
| `src/modules/booking/__tests__/checkin.test.ts` | buildCheckInMetadata, buildNoShowMetadata, findAutoNoShowCandidates (с мок БД) |
| `src/app/api/cron/__tests__/no-show.test.ts` | Авторизация (401 на неверный токен), happy path |
| `src/modules/ps-park/__tests__/service.test.ts` | Дополнить: checkIn, markNoShow, cancelBooking со штрафом, extendBooking с пересчётом цены |
| `src/modules/gazebos/__tests__/service.test.ts` | Аналогично ps-park |

---

### 10. План реализации (рекомендуемый порядок)

1. **Миграция БД** — добавить `CHECKED_IN`, `NO_SHOW` в enum, запустить `prisma migrate dev`
2. **Общий модуль** — реализовать `src/modules/booking/` (types, state-machine, cancellation, pricing, checkin, config)
3. **Обновить ps-park/service.ts** — ценообразование, новые статусы, функции checkIn/markNoShow, политика отмены
4. **Обновить gazebos/service.ts** — то же
5. **Новые API-эндпоинты** — `/checkin`, `/no-show` для обоих модулей; расширить cancel
6. **Крон** — `src/app/api/cron/no-show/route.ts`
7. **Тесты** — написать вместе с каждым шагом выше
8. **UI** — обновить менеджерские панели (кнопки «Отметить приход», «No-show», отображение новых статусов) — вне скоупа этого ADR

---

## Последствия

### Положительные

- Нет новых колонок в `Booking` — миграция минимальна (только enum)
- Общая логика вынесена в `src/modules/booking/` — ps-park и gazebos не дублируют код
- Пороги (2 часа, 30 минут, 50%) настраиваются через `Module.config` без деплоя
- Backward compatibility полная: существующие вызовы работают без изменений
- Крон легко адаптируется под Vercel Cron или системный cron

### Отрицательные / Риски

- Данные в `metadata: Json` не типизированы на уровне БД — ошибки типов возможны только при неправильном использовании. Митигация: строгие TypeScript-типы через `BookingMetadata` и функции-конструкторы из `src/modules/booking/`
- `getModuleBookingConfig` делает запрос к БД при каждом вызове. Митигация для Phase 1B: добавить Redis-кэш с TTL 60 секунд. В Phase 1A трафик позволяет обойтись без кэша
- Крон на VPS требует настройки `CRON_SECRET` в production. Если не настроен — авто-no-show не работает, только ручной. Задокументировать в CLAUDE.md

### Вне скоупа Phase 1A

- Онлайн-оплата штрафов
- Автоматические Telegram-напоминания клиенту о штрафе
- Чек-ин через QR-код
- Гибкие политики по типу ресурса
- Redis-кэш для `getModuleBookingConfig`
