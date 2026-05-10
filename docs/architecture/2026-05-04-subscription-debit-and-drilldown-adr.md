# ADR — F7: Автосписание абонемента + drill-down прошедшей сессии

- **Дата:** 2026-05-04
- **Статус:** Принято
- **RUN_ID:** `2026-05-04-subscription-debit-and-drilldown`
- **Branch:** `claude/wave-3-subscriptions-impl`
- **PRD:** `docs/requirements/2026-05-04-subscription-debit-and-drilldown-prd.md`
- **Зависимости:**
  - F1 ADR (payment guard в `updateBookingStatus`): `docs/architecture/2026-05-04-ps-park-payment-required-on-complete-adr.md`
  - F4 (`Booking.userId` для guest-link → registered-user) — в main
  - F5 (`Order.bookingId` reverse relation) — в main, `prisma/schema.prisma:305-306`
  - F6 ADR (модель Subscription + helpers): `docs/architecture/2026-05-04-subscriptions-module-impl-adr.md`

---

## 1. Контекст

F6 (этой же Wave 3) даст модель `Subscription` + `SubscriptionTransaction`, partial UNIQUE на (`userId`, `status='ACTIVE'`), helper `getActiveSubscriptionForUser(userId)` с lazy auto-EXPIRED/auto-DEPLETED. F6 НЕ реализует charge при completion — это F7.

F7 закрывает два пробела (PRD §Проблема):
1. Кассовое списание абонемента не связано с переводом сессии в `COMPLETED` — менеджер обнуляет часы вручную (риск двойного учёта).
2. История сессий показывает только сводную строку, без drill-down (гость → длительность → cafe-orders → способ оплаты).

Существующий ps-park flow (`src/modules/ps-park/service.ts:226-634`):
- `updateBookingStatus(id, status, managerId, cancelReason, cashAmount, cardAmount, discountInput, actorRole)`.
- Ветка `status === "COMPLETED"` (строки 404-562): расчёт `completedTotalBill` → discount → **F1 PAYMENT_REQUIRED guard** (строки 446-457) → `prisma.$transaction` с `booking.updateMany` + `financialTransaction.create` + `auditLog`.
- Финансовая запись пишется СНАЧАЛА после booking flip (строки 492-505).
- Все операции внутри одной транзакции — это критично сохранить для F7 (subscription debit должен быть в той же tx).

F4 (`Booking.userId`) уже даёт нам идентификатор гостя для поиска подписки. Гостевые брони (`userId === null`) — без подписки (PRD edge case).

---

## 2. Decisions matrix

### 2.1 Закрытие 4 open questions Architect (от parent agent)

| # | Вопрос | Решение | Обоснование |
|---|--------|---------|-------------|
| A1 | Где живёт `debitFromSession` | **Отдельный файл `src/modules/subscriptions/debit.ts`**, экспортирует `debitFromSession(tx, args)` | Clean separation: F6 service.ts уже плотный (CRUD + lazy status + adjust + cancel), debit — операция совсем другого слоя (вызывается извне субмодулем ps-park). Отдельный файл = (1) тестируется в изоляции (`debit.test.ts` с mock tx), (2) явный контракт `tx: Prisma.TransactionClient` в сигнатуре, (3) F6 module.ts экспортирует только то, что нужно его собственному UI. Аналог: `src/modules/inventory/sale.ts` / `src/modules/booking/discount.ts` — операционные хелперы вне service.ts. |
| A2 | Как F1 guard узнаёт про subscription credit | **(a) Сервер сам вычисляет `subscriptionCredit`** на основании переданного `subscriptionId` и серверного `completedTotalBill`. Payload содержит ТОЛЬКО `subscriptionId?: string`. | Single source of truth — UI не может «обмануть» guard, передав `subscriptionCredit: totalBill` без реального списания. Также соответствует Решению 5 PO («аддитивное слагаемое, не флаг-обход»). При `subscriptionId` присутствует и абонемент валиден → `subscriptionCredit = completedTotalBill` (бинарный выбор, Решение 4 PO «split вне скоупа»). |
| A3 | Drill-down endpoint расположение | **Новый `src/app/api/ps-park/sessions/[id]/route.ts`** (только GET) | Семантически чище: `/bookings/:id` — operations над брони (PATCH status, DELETE), `/sessions/:id` — read-only агрегатор для UI drill-down (booking + orders + payments). Не загромождаем `bookings/[id]/route.ts` (уже 207 строк). Refactor не нужен — оба URL живут параллельно. |
| A4 | Mutex subscription + discount + cash | **422 `INVALID_PAYMENT_COMBINATION`** при ЛЮБОЙ из комбинаций: `(subscriptionId && discountInput?.discountPercent > 0)` OR `(subscriptionId && (cashAmount > 0 OR cardAmount > 0))` | Одно семантическое правило: «либо абонемент, либо деньги/скидка». Один error code упрощает UI handling. Бинарный выбор (Решение 4 PO) → оплата подпиской исключает любой другой источник. |

### 2.2 Подтверждение 3 open questions PO

| Open Q (PRD §Open Questions) | Подтверждение |
|------|---------------|
| Q1: размещение `debitFromSession` | Подтверждено — `src/modules/subscriptions/debit.ts` (см. A1) |
| Q2: guard расширяется через `subscriptionCredit` | Подтверждено — серверная логика, payload только `subscriptionId` (см. A2) |
| Q3: отдельная страница vs вкладка | Подтверждено — отдельная страница `/admin/ps-park/sessions/[id]` (PRD §Решение 3 PO) |

---

## 3. Изменения в `prisma/schema.prisma`

**Нет.** Все необходимые поля уже добавляет F6 ADR (`Subscription`, `SubscriptionTransaction`, partial UNIQUE). F5 (`Order.bookingId`) уже в main. F7 не вводит новых таблиц/колонок/enum.

---

## 4. Service-layer изменения

### 4.1 Новый файл `src/modules/subscriptions/debit.ts`

```ts
import type { Prisma } from "@prisma/client";

export class SubscriptionDebitError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "SubscriptionDebitError";
    if (metadata) this.metadata = metadata;
  }
}

export type DebitFromSessionArgs = {
  subscriptionId: string;
  bookingId: string;
  hours: number;            // billedHours (Decimal-safe number с шагом 0.25)
  performedById: string;
  performedByName: string;
};

export type DebitFromSessionResult = {
  hoursDebited: number;
  remainingAfter: number;
  becameDepleted: boolean;
};

/**
 * Atomically debit `hours` from a Subscription within an existing transaction.
 *
 * MUST be called inside `prisma.$transaction(async (tx) => { ... })` from the
 * caller (ps-park service). All four writes (Subscription update + ST insert
 * + AuditLog insert + caller's FT/Booking writes) must commit together.
 *
 * Race-safety: uses `updateMany WHERE id=? AND status=ACTIVE AND remainingHours >= ?`
 * (atomic compare-and-swap). If two concurrent debits race, the second receives
 * `count = 0` → throws INSUFFICIENT_HOURS.
 *
 * Lazy auto-DEPLETED: if `remainingAfter === 0`, sets status='DEPLETED' in the
 * same UPDATE call (single round-trip). Lazy auto-EXPIRED is NOT done here — that
 * is a precondition checked by the caller via `getActiveSubscriptionForUser`.
 */
export async function debitFromSession(
  tx: Prisma.TransactionClient,
  args: DebitFromSessionArgs
): Promise<DebitFromSessionResult> {
  const { subscriptionId, bookingId, hours, performedById, performedByName } = args;

  if (hours <= 0) {
    throw new SubscriptionDebitError(
      "INVALID_HOURS",
      "Часы для списания должны быть положительными",
      { hours }
    );
  }

  // Step 1: Atomic compare-and-swap. Single UPDATE with conditional WHERE.
  // Postgres Decimal arithmetic via Prisma `decrement` is exact (no float drift).
  // We SKIP setting status here because we don't yet know `remainingAfter`;
  // the auto-DEPLETED transition happens in step 3 if needed.
  const updateRes = await tx.subscription.updateMany({
    where: {
      id: subscriptionId,
      status: "ACTIVE",
      remainingHours: { gte: hours },
    },
    data: {
      remainingHours: { decrement: hours },
    },
  });

  if (updateRes.count === 0) {
    // Either: status flipped (CANCELLED/EXPIRED/DEPLETED), or remainingHours
    // dropped below `hours` due to a concurrent debit/adjust.
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { status: true, remainingHours: true },
    });
    throw new SubscriptionDebitError(
      "INSUFFICIENT_HOURS",
      "Недостаточно часов на абонементе",
      {
        requested: hours,
        remainingHours: sub?.remainingHours.toString() ?? "0",
        currentStatus: sub?.status ?? "UNKNOWN",
      }
    );
  }

  // Step 2: Read post-update balance (we need it for ST.balanceAfter and
  // auto-DEPLETED check). Same tx → consistent read.
  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { remainingHours: true, status: true },
  });
  const remainingAfter = Number(sub.remainingHours);
  const becameDepleted = remainingAfter <= 0 && sub.status === "ACTIVE";

  // Step 3: Auto-DEPLETED — if the debit drained the balance, transition status.
  // Conditional WHERE prevents flipping a CANCELLED/EXPIRED row (defensive).
  if (becameDepleted) {
    await tx.subscription.updateMany({
      where: { id: subscriptionId, status: "ACTIVE" },
      data: { status: "DEPLETED" },
    });
  }

  // Step 4: Immutable ledger entry (mirrors F6 SubscriptionTransaction contract).
  // type='DEBIT_SESSION' — see F6 §4.1 enum SubscriptionTransactionType.
  // NOTE: F6 ADR uses enum value `CHARGE` for auto-debit. F7 uses the same value
  // (no new enum needed). Naming clarification at the bottom of this section.
  await tx.subscriptionTransaction.create({
    data: {
      subscriptionId,
      type: "CHARGE",                        // F6 enum value, semantically "DEBIT_SESSION"
      hoursDelta: -hours,                    // negative = debit
      balanceAfter: remainingAfter,
      bookingId,
      performedById,
      performedByName,
    },
  });

  // Step 5: AuditLog inside same tx (atomic with FT/Booking writes from caller).
  await tx.auditLog.create({
    data: {
      userId: performedById,
      action: "subscription.debit_session",
      entity: "Subscription",
      entityId: subscriptionId,
      metadata: {
        bookingId,
        hoursDebited: hours,
        remainingAfter,
        becameDepleted,
      },
    },
  });

  return { hoursDebited: hours, remainingAfter, becameDepleted };
}
```

**Naming clarification:** PRD AC-6 пишет «`SubscriptionTransaction(type=DEBIT_SESSION)`», но F6 ADR §4.1 фиксирует enum `SubscriptionTransactionType { CHARGE | REFUND | MANUAL_TOPUP | MANUAL_DEDUCT }`. Architect использует `type='CHARGE'` (existing enum), не вводит новый вариант. Семантика идентична: «авто-списание из F7 (booking.completed)» — это ровно то, что F6 ADR §4.1 описывает как назначение `CHARGE`. AuditLog action остаётся `subscription.debit_session` (semantic для grep-ability в логах).

### 4.2 Изменения в `src/modules/ps-park/service.ts`

**Сигнатура `updateBookingStatus`** (строка 226-235) — расширяется новым опциональным параметром:

```ts
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number,
  discountInput?: CheckoutDiscountInput,
  actorRole: import("@/modules/booking/state-machine").ActorRole = "MANAGER",
  subscriptionId?: string                     // ← новое (F7)
)
```

**Backward compat:** опциональный 9-й параметр. Все существующие вызовы (`route.ts:83`, cron auto-complete) — без изменений.

**Pre-transaction (между discount apply и F1 PAYMENT_REQUIRED guard, строки 441-446):**

Вставка нового блока. Размещение строго ДО F1 guard — нам нужно загрузить subscription, проверить mutex, вычислить `subscriptionCredit` и передать его в guard.

```ts
// === SUBSCRIPTION PRE-FLIGHT (F7) ===
// PRD F7 §AC-1, AC-9: validate subscription state BEFORE entering the tx.
// All checks here are READ-ONLY; the actual debit happens inside the tx below
// via debitFromSession() to keep COMPLETED + FT + ST + AuditLog atomic.
let subscriptionCredit = 0;
let activeSubscription: Awaited<
  ReturnType<typeof getActiveSubscriptionForUser>
> = null;

if (subscriptionId) {
  // (1) Mutex: subscription is incompatible with discount AND with cash/card.
  // PRD §Edge "Скидка + абонемент" (Решение 2 PO) + Решение 4 PO (no split).
  const hasDiscount = !!(discountInput && discountInput.discountPercent > 0);
  const hasCash = (cashAmount ?? 0) > 0;
  const hasCard = (cardAmount ?? 0) > 0;
  if (hasDiscount || hasCash || hasCard) {
    throw new PSBookingError(
      "INVALID_PAYMENT_COMBINATION",
      "Оплата абонементом несовместима со скидкой и с наличной/безналичной оплатой",
      { hasDiscount, hasCash, hasCard }
    );
  }

  // (2) Guest bookings (no userId) cannot use a subscription.
  // PRD §Edge "Гость без userId" — toggle hidden in UI; defensive 422 here.
  if (!booking.userId) {
    throw new PSBookingError(
      "INVALID_SUBSCRIPTION",
      "Абонемент недоступен для гостевой брони (нет привязанного пользователя)",
      { bookingId: id }
    );
  }

  // (3) Lazy-load active subscription for THIS user. Helper does the
  // auto-EXPIRED / auto-DEPLETED status flip if validTo < now or remaining <= 0
  // (F6 ADR §5.2). Returns null in those cases.
  activeSubscription = await getActiveSubscriptionForUser(booking.userId);
  if (!activeSubscription || activeSubscription.id !== subscriptionId) {
    // Race-catch: UI snapshot of active sub became stale (cancelled / expired /
    // depleted / replaced by a fresh one between modal open and submit).
    throw new PSBookingError(
      "INVALID_SUBSCRIPTION",
      "Активный абонемент изменился. Откройте окно завершения заново",
      { providedId: subscriptionId, currentActiveId: activeSubscription?.id ?? null }
    );
  }

  // (4) Hours availability — DEFENSIVE check. Authoritative debit happens in
  // the tx below (debitFromSession does its own atomic compare-and-swap). This
  // pre-check exists to surface a clean 422 INSUFFICIENT_HOURS instead of
  // reaching the tx body for the obvious case where the operator's snapshot
  // is already stale enough for a clean reject.
  if (Number(activeSubscription.remainingHours) < completedBilledHours) {
    throw new PSBookingError(
      "INSUFFICIENT_HOURS",
      `На абонементе недостаточно часов (нужно ${completedBilledHours}, осталось ${activeSubscription.remainingHours})`,
      {
        required: completedBilledHours,
        remainingHours: activeSubscription.remainingHours.toString(),
        subscriptionId,
      }
    );
  }

  // (5) Compute additive credit for F1 guard. Binary mode (Решение 4 PO):
  // entire bill is covered by subscription, so credit == completedTotalBill.
  subscriptionCredit = completedTotalBill;
}
```

**Изменение в F1 guard** (строки 446-457). Расширяем условие добавлением `subscriptionCredit`:

```ts
if (actorRole !== "CRON" && completedTotalBill > 0) {
  const paidByOperator = (cashAmount ?? 0) + (cardAmount ?? 0);
  const totalCovered = paidByOperator + subscriptionCredit;   // ← F7 additive
  if (totalCovered < completedTotalBill) {
    const shortfall = Math.round((completedTotalBill - totalCovered) * 100) / 100;
    throw new PSBookingError(
      "PAYMENT_REQUIRED",
      `Необходимо принять оплату: не хватает ${shortfall.toLocaleString("ru-RU")} ₽`,
      { shortfall, totalBill: completedTotalBill, paid: paidByOperator, subscriptionCredit }
    );
  }
}
```

При `subscriptionId` присутствует и валиден → `subscriptionCredit === completedTotalBill` → guard всегда проходит. При absent — старая логика `paid >= totalBill` сохраняется буквально.

**Изменения внутри `prisma.$transaction`** (строки 471-562). Перед `tx.financialTransaction.create` (строка 492) вставляется вызов `debitFromSession`. Также корректируется `resolvedCash`/`resolvedCard` при subscription mode:

```ts
// (Существующий) booking.updateMany (строки 475-485) — без изменений.
// При subscription mode: cashAmount === 0, cardAmount === 0 (mutex выше),
// поэтому resolvedCash = 0, resolvedCard = 0 — естественно.

// === F7: subscription debit inside the same tx ===
// MUST happen BEFORE FT.create so that if debit fails (race lost), we roll
// back the booking flip too. PRD AC-6: «в одной транзакции».
let subscriptionDebit:
  | { hoursDebited: number; remainingAfter: number; becameDepleted: boolean }
  | undefined;
if (subscriptionId && activeSubscription) {
  subscriptionDebit = await debitFromSession(tx, {
    subscriptionId,
    bookingId: id,
    hours: completedBilledHours,
    performedById,
    performedByName: managerName,
  });
}

// FT.create (строки 492-505) — изменение значений totalAmount/cash/card
// при subscription mode (бинарный, Решение 4 PO):
const ftTotal = subscriptionId ? 0 : completedTotalBill;
const ftCash = subscriptionId ? 0 : resolvedCash;
const ftCard = subscriptionId ? 0 : resolvedCard;

await tx.financialTransaction.create({
  data: {
    moduleSlug: MODULE_SLUG,
    type: "SESSION_PAYMENT",
    bookingId: id,
    totalAmount: ftTotal,
    cashAmount: ftCash,
    cardAmount: ftCard,
    performedById,
    performedByName: managerName,
    description: `Сессия: ${billSnapshot?.resourceName ?? "—"} · ${billSnapshot?.clientName ?? "—"}`,
    metadata: {
      ...(billSnapshot ? (billSnapshot as Record<string, unknown>) : {}),
      ...(subscriptionId && {
        paymentMethod: "SUBSCRIPTION",
        subscriptionId,
        subscriptionHoursDebited: subscriptionDebit?.hoursDebited,
        originalBillBeforeSubscription: completedTotalBill,
      }),
    } as import("@prisma/client").Prisma.InputJsonValue,
  },
});

// session.complete AuditLog (строки 510-532) — добавляем поля при subscription:
await tx.auditLog.create({
  data: {
    userId: performedById,
    action: completionAction,
    entity: "Booking",
    entityId: id,
    metadata: {
      bookingId: id,
      moduleSlug: MODULE_SLUG,
      resourceName: resource?.name ?? "—",
      clientName: booking.clientName ?? "—",
      totalAmount: ftTotal,
      cashAmount: ftCash,
      cardAmount: ftCard,
      billedHours: completedBilledHours,
      pricePerHour: completedPricePerHour,
      itemsTotal: completedItemsTotal,
      ...(actorRole === "CRON" && { actor: "CRON" }),
      ...(subscriptionId && {
        paymentMethod: "SUBSCRIPTION",
        subscriptionId,
        subscriptionHoursDebited: subscriptionDebit?.hoursDebited,
        subscriptionRemainingAfter: subscriptionDebit?.remainingAfter,
        subscriptionBecameDepleted: subscriptionDebit?.becameDepleted,
      }),
    },
  },
});
```

**Сохраняется:**
- F1 PAYMENT_REQUIRED guard (расширен `+ subscriptionCredit`).
- Race-condition guard `booking.updateMany` (строки 475-486).
- Discount AuditLog (строки 535-559) — НЕ выполняется при subscription mode (mutex выше).
- Notification dispatch (строки 624-631).

**Импорты в `service.ts` (top of file):**
```ts
import { getActiveSubscriptionForUser } from "@/modules/subscriptions/service";
import { debitFromSession, SubscriptionDebitError } from "@/modules/subscriptions/debit";
```

**Mapping `SubscriptionDebitError → PSBookingError`** для единообразия в route handler. Делается двумя способами:
- (a) wrap `debitFromSession` в `try/catch` внутри `updateBookingStatus`, перебрасывать как `PSBookingError`. **Выбор Architect.** Преимущество: route handler ловит ОДИН тип error, единый mapping. Недостаток: stack-trace удлиняется на один уровень — приемлемо.

```ts
try {
  subscriptionDebit = await debitFromSession(tx, { ... });
} catch (err: unknown) {
  if (err instanceof SubscriptionDebitError) {
    throw new PSBookingError(err.code, err.message, err.metadata);
  }
  throw err;
}
```

---

## 5. API endpoints

### 5.1 Расширение `PATCH /api/ps-park/bookings/:id` (existing)

**Изменения в `src/app/api/ps-park/bookings/[id]/route.ts`:**

(а) Парсинг нового опционального поля `subscriptionId` (строка 55):
```ts
const { reason, confirmPenalty, cashAmount, cardAmount, subscriptionId } = body;
```

(б) Передача в `updateBookingStatus` (строка 83-88):
```ts
updated = await updateBookingStatus(
  id, status, session.user.id, reason,
  typeof cashAmount === "number" ? cashAmount : undefined,
  typeof cardAmount === "number" ? cardAmount : undefined,
  discountInput,
  "MANAGER",
  typeof subscriptionId === "string" && subscriptionId.length > 0 ? subscriptionId : undefined
);
```

(в) Расширение error mapping (строки 119-134):
```ts
const conflictCodes = new Set([
  "INVALID_STATUS_TRANSITION",
  "ALREADY_COMPLETED",
  "ALREADY_CANCELLED",
]);
const unprocessableCodes = new Set([
  "DISCOUNT_EXCEEDS_LIMIT",
  "PAYMENT_REQUIRED",
  "INVALID_PAYMENT_COMBINATION",     // ← F7
  "INVALID_SUBSCRIPTION",            // ← F7
  "INSUFFICIENT_HOURS",              // ← F7
  "INVALID_HOURS",                   // ← F7 (defensive)
]);
```

**Zod валидация для `subscriptionId`:** добавляем минимальную inline-проверку формата (cuid-like — string min 1 max 30) ДО передачи в сервис. Не вводим отдельную Zod schema (одно поле, тривиально).

**RBAC:** не меняется. `PATCH /api/ps-park/bookings/:id` уже защищён `auth() + requireAdminSection(session, "ps-park")` для MANAGER, `hasRole(session.user, "MANAGER")` для COMPLETE-операции (route.ts:65-67). USER не может вызвать с `subscriptionId` — он не получает COMPLETE-доступ вообще. Гость не может через bot — bot не выполняет COMPLETE.

**Rate limit:** не меняется (наследуется от global middleware, 120/min для authenticated).

**AuditLog:** мутации логируются внутри tx (`session.complete` + `subscription.debit_session` — оба).

### 5.2 Новый `GET /api/ps-park/sessions/[id]`

**Файл:** `src/app/api/ps-park/sessions/[id]/route.ts`

**Контракт:**
```http
GET /api/ps-park/sessions/{id}
```

**RBAC:**
- `auth()` обязателен.
- `requireAdminSection(session, "ps-park")` — SUPERADMIN/ADMIN автодоступ; MANAGER только с AdminPermission на `ps-park`; USER → 403.
- Soft-deleted booking (`deletedAt != null`) → 404 (PRD AC-10).
- Не-ps-park booking (`moduleSlug != 'ps-park'`) → 404.

**Rate limit:** authenticated 120/min (общая политика). Read-only endpoint, низкий риск.

**Validation:** path-param `id` — cuid format (`/^c[a-z0-9]{24,}$/`); невалидный → 422.

**Handler logic:**
```ts
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const denied = await requireAdminSection(session, "ps-park");
  if (denied) return denied;

  const { id } = await params;

  const booking = await prisma.booking.findFirst({
    where: { id, moduleSlug: "ps-park", deletedAt: null },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      // F5: Order.bookingId reverse relation
      orderBookings: {
        where: { deletedAt: null },
        include: {
          items: { include: { /* menuItem name resolved separately or via join */ } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!booking) return apiNotFound("Сессия не найдена");

  const resource = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
    select: { id: true, name: true, pricePerHour: true },
  });

  const financialTransactions = await prisma.financialTransaction.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "asc" },
  });

  const subscriptionTransaction = await prisma.subscriptionTransaction.findFirst({
    where: { bookingId: id, type: "CHARGE" },
    include: {
      subscription: { select: { id: true, totalHours: true, validFrom: true, validTo: true } },
    },
  });

  return apiResponse(buildSessionDetailDTO(booking, resource, financialTransactions, subscriptionTransaction));
}
```

> **NB:** в Prisma reverse-relation `Order.bookingId` exposed as `Booking.orderBookings` если в schema указан `@relation("OrderBooking")` reverse field. F5 ADR должен был добавить это в `Booking` model. Если не добавлено — F7 dev делает второй запрос `prisma.order.findMany({ where: { bookingId: id, deletedAt: null }, include: { items: true } })` и собирает DTO. Это операционная деталь — оба варианта валидны.

**Response shape (строгий contract):**
```jsonc
{
  "success": true,
  "data": {
    "session": {
      "id": "clxyz...",
      "status": "COMPLETED",
      "date": "2026-05-04",
      "startTime": "2026-05-04T18:00:00.000Z",
      "endTime": "2026-05-04T20:00:00.000Z",
      "billedHours": 2,
      "durationMin": 120,
      "totalBill": 600,
      "resource": { "id": "...", "name": "Стол PlayStation 1", "pricePerHour": 300 },
      "client": {
        "userId": "cl...",        // null для гостевой брони
        "name": "Иван Иванов",
        "phone": "+7...",
        "email": null
      }
    },
    "orders": [
      {
        "id": "...",
        "status": "DELIVERED",
        "totalAmount": 450,
        "createdAt": "...",
        "items": [
          { "name": "Кофе латте", "quantity": 2, "price": 200, "subtotal": 400 },
          { "name": "Чизкейк",    "quantity": 1, "price": 50,  "subtotal": 50  }
        ]
      }
    ],
    "payment": {
      "method": "SUBSCRIPTION",     // "CASH" | "CARD" | "MIXED" | "SUBSCRIPTION" | "FREE"
      "totalAmount": 0,
      "cashAmount": 0,
      "cardAmount": 0,
      "discount": null,             // или { percent, amount, reason }
      "subscription": {             // присутствует только при method = SUBSCRIPTION
        "subscriptionId": "...",
        "hoursDebited": 2,
        "balanceAfter": 8,
        "transactionId": "..."
      },
      "financialTransactionId": "..."
    }
  }
}
```

**Determining `payment.method`:**
- `subscriptionTransaction != null` → `SUBSCRIPTION`
- `discount != null && finalAmount === 0 && cash === 0 && card === 0` → `FREE`
- `cash > 0 && card > 0` → `MIXED`
- `cash > 0 && card === 0` → `CASH`
- `cash === 0 && card > 0` → `CARD`
- `totalAmount === 0 && no discount && no subscription` → `FREE` (гостевая бронь без тарифа)

### 5.3 Опциональный `GET /api/clients/:userId/subscriptions/active`

**Контекст из parent agent:** «Endpoint `/api/clients/:userId/subscriptions/active` — добавь как часть F6 dependencies».

**Решение Architect:** добавляем endpoint в скоуп F7 (не F6 — F6 уже сдаётся, не хотим перерыть его scope post-hoc), но реализация ОЧЕНЬ тонкая — обёртка над `getActiveSubscriptionForUser`.

**Файл:** `src/app/api/clients/[userId]/subscriptions/active/route.ts`

**Контракт:**
```http
GET /api/clients/{userId}/subscriptions/active

200: { "success": true, "data": { /* sub */ } | null }
```

**RBAC:**
- `auth()` обязателен.
- `requireAdminSection(session, "ps-park")` — это admin-side endpoint (используется `complete-session-button.tsx` для предзагрузки toggle state).
- Не публичный для USER (USER не должен знать чужой остаток).

**Response shape:**
```jsonc
{
  "success": true,
  "data": null   // нет активной подписки
}
// или
{
  "success": true,
  "data": {
    "id": "cl...",
    "totalHours": "10.00",
    "remainingHours": "8.50",
    "validFrom": "...",
    "validTo": "...",
    "status": "ACTIVE"
  }
}
```

**Rate limit:** authenticated 120/min.

**Логика:**
```ts
const session = await auth();
const denied = await requireAdminSection(session, "ps-park");
if (denied) return denied;
const { userId } = await params;
const sub = await getActiveSubscriptionForUser(userId);
return apiResponse(sub ?? null);
```

`getActiveSubscriptionForUser` уже делает lazy auto-EXPIRED/auto-DEPLETED (F6 ADR §5.2), поэтому endpoint всегда возвращает «реально usable» состояние.

---

## 6. UI changes

### 6.1 `src/components/admin/ps-park/session-bill-modal.tsx`

**Новые props:**
```ts
type SessionBillModalProps = {
  bill: BookingBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (split: PaymentSplit) => void;
  confirming: boolean;
  maxDiscountPercent?: number;
  apiError?: string | null;
  // === F7 ===
  activeSubscription?: {
    id: string;
    totalHours: string;       // Decimal as string
    remainingHours: string;
    validTo: string;          // ISO
  } | null;
};
```

**Расширенный `PaymentSplit`:**
```ts
export type PaymentSplit = {
  cashAmount: number;
  cardAmount: number;
  discountPercent?: number;
  discountReason?: string;
  discountNote?: string;
  subscriptionId?: string;     // ← F7
};
```

**Поведение:**

(1) Блок «Абонемент» вставляется СВЕРХУ блока «Скидка» (строки 240-305 в текущем коде — между breakdown и discount toggle). Условие отображения:
- `activeSubscription != null && bill.userId != null` (guest booking — блок скрыт, PRD AC-5).

(2) Toggle state:
```ts
const [useSubscription, setUseSubscription] = useState(false);    // PRD §Решение 1: opt-in
const subSufficient = activeSubscription
  ? Number(activeSubscription.remainingHours) >= bill.billedHours
  : false;
const subToggleDisabled = !activeSubscription || !subSufficient;
```

(3) При `useSubscription === true`:
- `cashRaw` → `"0"`, `cardRaw` → `"0"` (значения сбрасываются и поля становятся read-only через `disabled` prop) — PRD AC-2.
- Блок скидки disabled (вся секция блокируется через `pointer-events-none opacity-50`) — PRD AC-2.
- Кнопка «Завершить» enable условие меняется: `!confirming && !apiError` (без проверки `isBalanced`/`isUnderpaid` — guard выполняет сервер).

(4) При выключении toggle (PRD AC-3):
```ts
if (!useSubscription) {
  setCashRaw(String(effectiveTotal));
  setCardRaw("0");
}
```

(5) Tooltip «Не хватает X ч.» (PRD AC-4):
```tsx
{activeSubscription && !subSufficient && (
  <span title={`Не хватает ${bill.billedHours - Number(activeSubscription.remainingHours)} ч. (осталось ${activeSubscription.remainingHours} ч.)`}>
    Недостаточно часов
  </span>
)}
```

(6) В `handleConfirm` (строка 117-127):
```ts
function handleConfirm() {
  if (useSubscription && activeSubscription) {
    onConfirm({
      cashAmount: 0,
      cardAmount: 0,
      subscriptionId: activeSubscription.id,
    });
    return;
  }
  // existing logic — cash/card/discount
  const split: PaymentSplit = { cashAmount: cash, cardAmount: card };
  if (showDiscount && discountPercent > 0 && discountReason) {
    split.discountPercent = discountPercent;
    split.discountReason = discountReason;
    if (discountReason === "other" && discountNote) split.discountNote = discountNote;
  }
  onConfirm(split);
}
```

### 6.2 `src/components/admin/ps-park/complete-session-button.tsx`

**Изменения в `handleClick`** (строка 21-44):

Дополнительный fetch активной подписки гостя (только если `bill.userId != null`):
```ts
const [activeSub, setActiveSub] = useState<ActiveSubscriptionDTO | null>(null);
// ...
async function handleClick() {
  setLoadingBill(true);
  setError(null);
  try {
    const [billRes, settingsRes] = await Promise.all([
      fetch(`/api/ps-park/bookings/${bookingId}/bill`),
      fetch("/api/ps-park/settings"),
    ]);
    const billData = await billRes.json();
    if (billData.success) {
      setBill(billData.data);
      // F7: lazy-fetch active subscription if guest is registered (userId != null).
      // Done as a separate request to avoid changing /bill response shape.
      if (billData.data?.userId) {
        const subRes = await fetch(`/api/clients/${billData.data.userId}/subscriptions/active`);
        const subData = await subRes.json();
        if (subData.success) setActiveSub(subData.data);
      }
    } else {
      setError(billData.error?.message ?? "Не удалось загрузить счёт");
    }
    // settings parse — без изменений
  } catch {
    setError("Ошибка при загрузке счёта");
  } finally {
    setLoadingBill(false);
  }
}
```

**`BookingBill` type** должен включать `userId?: string | null`. Если ещё не включён — это малое расширение в `src/modules/ps-park/types.ts`. Если уже есть — без изменений.

**Передача в модалку** (строка 90-98):
```tsx
<SessionBillModal
  bill={bill}
  isOpen={!!bill}
  onClose={() => { setBill(null); setError(null); setActiveSub(null); }}
  onConfirm={handleConfirm}
  confirming={confirming}
  maxDiscountPercent={maxDiscount}
  apiError={error}
  activeSubscription={activeSub}    // ← F7
/>
```

**`handleConfirm`** (строка 46-73): payload расширяется `subscriptionId`:
```ts
const payload: Record<string, unknown> = { status: "COMPLETED", cashAmount, cardAmount };
if (subscriptionId) payload.subscriptionId = subscriptionId;     // ← F7
if (discountPercent && discountPercent > 0 && discountReason) {
  payload.discountPercent = discountPercent;
  payload.discountReason = discountReason;
  if (discountNote) payload.discountNote = discountNote;
}
```

### 6.3 Новые файлы для drill-down

**`src/app/admin/ps-park/sessions/[id]/page.tsx`** (Server Component):

```ts
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { SessionDetail } from "@/components/admin/ps-park/session-detail";
import { getSessionDetail } from "@/modules/ps-park/service";  // new helper

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/admin/login");
  // RBAC через те же helpers, что и API
  const role = session.user.role;
  if (role === "USER") notFound();
  if (role !== "SUPERADMIN" && role !== "ADMIN") {
    const ok = await hasAdminSectionAccess(session.user.id, "ps-park");
    if (!ok) notFound();
  }
  const { id } = await params;
  const detail = await getSessionDetail(id);
  if (!detail) notFound();

  return <SessionDetail data={detail} />;
}
```

**`src/modules/ps-park/service.ts` — новый helper `getSessionDetail`:**

```ts
/**
 * F7 drill-down: aggregate booking + orders + financial + subscription tx
 * for a single session. Returns null for soft-deleted or wrong-module bookings.
 */
export async function getSessionDetail(id: string): Promise<SessionDetailDTO | null> {
  // Identical query as GET /api/ps-park/sessions/[id]; service-layer reuse so
  // both server-rendered page and API route hit the same logic. Single source
  // of truth for the DTO shape.
  // ... (implementation matches §5.2)
}
```

**`src/components/admin/ps-park/session-detail.tsx`** (Client Component):

Sections (PRD AC-11..AC-13):
1. **Сессия** — гость (имя+phone, link на `/admin/ps-park/clients/[userId]` если userId), стол, дата, start/end, durationMin, billedHours, hoursCost.
2. **Заказы в кафе** — список Order с items. Если orders.length === 0 → «Заказов не было».
3. **Оплата** — payment method label с цветным badge:
   - `SUBSCRIPTION` → «Абонемент №X — списано N ч.»
   - `CASH` / `CARD` / `MIXED` — суммы.
   - `FREE` (with discount) — «Бесплатно (скидка 100% — причина: …)».
4. Кнопка «← Назад» → `router.back()`.

### 6.4 `src/components/admin/ps-park/booking-history-table.tsx`

**Изменение** — добавить ссылку «Подробнее» в столбец «Действия» (строки 143-145) для строк COMPLETED:

```tsx
<td className="py-3" onClick={(e) => e.stopPropagation()}>
  <div className="flex items-center gap-2">
    {b.status === "COMPLETED" && (
      <Link
        href={`/admin/ps-park/sessions/${b.id}`}
        className="text-xs text-blue-600 hover:underline"
      >
        Подробнее
      </Link>
    )}
    <BookingActions bookingId={b.id} currentStatus={b.status as "COMPLETED" | "CANCELLED"} />
  </div>
</td>
```

Существующий `handleRowClick` (строки 60-74) с inline-bill modal оставляем — это альтернативный быстрый просмотр чека. Drill-down для глубокого разбора. Два разных UX, оба валидны.

---

## 7. Test plan

### 7.1 `src/modules/subscriptions/__tests__/debit.test.ts` (новый файл)

| # | Тест | Что проверяем |
|---|------|---------------|
| D1 | `debitFromSession happy path (sufficient hours, status remains ACTIVE)` | `remainingHours: 10`, debit `2` → `updateMany` called with `WHERE status=ACTIVE AND remainingHours>=2 { decrement: 2 }`, ST.create called с `type=CHARGE, hoursDelta=-2, balanceAfter=8, bookingId`, AuditLog `subscription.debit_session`, returns `{ hoursDebited: 2, remainingAfter: 8, becameDepleted: false }` |
| D2 | `debitFromSession race lost (concurrent debit) → INSUFFICIENT_HOURS` | Mock `tx.subscription.updateMany` returns `{ count: 0 }`; subsequent `findUnique` returns sub with `remainingHours: 0.5, status: ACTIVE` → throws `SubscriptionDebitError("INSUFFICIENT_HOURS")` с metadata `{ requested, remainingHours, currentStatus }` |
| D3 | `debitFromSession exhausts balance → auto-DEPLETED in same tx` | `remainingHours: 2`, debit `2`. After updateMany, post-read returns `remainingHours: 0, status: ACTIVE` → second updateMany called with `data: { status: 'DEPLETED' }`. Result `{ becameDepleted: true }` |
| D4 | `debitFromSession rejects hours <= 0` | hours=0 / hours=-1 → `SubscriptionDebitError("INVALID_HOURS")`. No DB calls. |
| D5 | `debitFromSession does not flip status if already CANCELLED` | Race: between updateMany (count=0) and findUnique, sub became CANCELLED. `currentStatus: "CANCELLED"` в metadata. No status flip. |

### 7.2 `src/modules/ps-park/__tests__/service.test.ts` (расширение)

| # | Тест | Что проверяем |
|---|------|---------------|
| P1 | `updateBookingStatus COMPLETE with valid subscriptionId → success` | Mock `getActiveSubscriptionForUser` returns sub matching id, `remainingHours >= billedHours`. Inside tx: `debitFromSession` called с правильными args, FT.create called с `totalAmount=0, cashAmount=0, cardAmount=0, metadata.paymentMethod="SUBSCRIPTION"`, AuditLog с `subscriptionHoursDebited`. No discount AuditLog. |
| P2 | `updateBookingStatus with subscriptionId + discountInput → INVALID_PAYMENT_COMBINATION (422)` | Throws `PSBookingError("INVALID_PAYMENT_COMBINATION")` с `metadata.hasDiscount=true`. No tx opened. |
| P3 | `updateBookingStatus with subscriptionId + cashAmount > 0 → INVALID_PAYMENT_COMBINATION` | `cashAmount: 100, subscriptionId: "..."` → throws с `metadata.hasCash=true`. |
| P4 | `updateBookingStatus with subscriptionId + cardAmount > 0 → INVALID_PAYMENT_COMBINATION` | Symmetric to P3. |
| P5 | `updateBookingStatus with subscriptionId for guest booking (userId=null) → INVALID_SUBSCRIPTION` | Booking has `userId: null`. Throws `INVALID_SUBSCRIPTION` с `metadata.bookingId`. No subscription lookup. |
| P6 | `updateBookingStatus with subscriptionId not matching active sub → INVALID_SUBSCRIPTION` | `getActiveSubscriptionForUser` returns sub with `id: "abc"`, payload `subscriptionId: "xyz"` → throws с `metadata.providedId, currentActiveId`. |
| P7 | `updateBookingStatus with subscriptionId, no active sub (lazy expired) → INVALID_SUBSCRIPTION` | `getActiveSubscriptionForUser` returns `null` (sub expired in helper). Throws `INVALID_SUBSCRIPTION` с `currentActiveId: null`. |
| P8 | `updateBookingStatus with subscriptionId but insufficient hours (defensive pre-check) → INSUFFICIENT_HOURS (422)` | Sub has `remainingHours: 1`, `billedHours: 2`. Throws `INSUFFICIENT_HOURS` с `metadata.required, remainingHours`. No tx opened. |
| P9 | `updateBookingStatus with subscriptionId, race lost inside tx → INSUFFICIENT_HOURS (rethrown as PSBookingError)` | Pre-check passes (mock sub fresh), but `debitFromSession` throws `SubscriptionDebitError("INSUFFICIENT_HOURS")` inside tx. Rethrown as `PSBookingError("INSUFFICIENT_HOURS")` с metadata. Booking flip rolled back. |
| P10 | `updateBookingStatus subscription depletes balance → FT, ST, AuditLog all atomic` | `debitFromSession` returns `becameDepleted: true`. AuditLog metadata contains `subscriptionBecameDepleted: true`. |
| P11 | `updateBookingStatus without subscriptionId → existing F1 guard untouched (cash + card check)` | No `subscriptionId`, `cash=0, card=0, totalBill=300` → `PAYMENT_REQUIRED` (regression for F1). |
| P12 | `updateBookingStatus actorRole=CRON ignores subscription path entirely` | CRON never passes `subscriptionId` (cron has no UI). If somehow passed → still ignored or throws (defensive). Architect choice: CRON branch never reaches subscription pre-flight (we add early return: `if (subscriptionId && actorRole === 'CRON') throw INVALID_PAYMENT_COMBINATION`). One additional test for explicitness. |

### 7.3 Route handler tests

**`src/app/api/ps-park/bookings/[id]/__tests__/route.test.ts`** (расширение):
- R1: `PATCH ... { status:"COMPLETED", subscriptionId:"..." }` → calls service с правильным 9-м аргументом.
- R2: `INVALID_PAYMENT_COMBINATION` → HTTP 422 с metadata пробрасывается в response.
- R3: `INSUFFICIENT_HOURS` → HTTP 422.

**`src/app/api/ps-park/sessions/[id]/__tests__/route.test.ts`** (новый):
- S1: GET happy path → returns DTO with session/orders/payment.
- S2: GET soft-deleted booking → 404.
- S3: GET wrong-module booking → 404.
- S4: GET as USER → 403.
- S5: GET subscription-paid session → `payment.method === "SUBSCRIPTION"`, `subscription.hoursDebited` correct.
- S6: GET guest booking (userId=null) → DTO без `client.userId`, no subscription block.

**`src/app/api/clients/[userId]/subscriptions/active/__tests__/route.test.ts`** (новый):
- C1: GET active sub → 200 с DTO.
- C2: GET when no active sub → 200 с `data: null`.
- C3: GET as USER → 403.

### 7.4 UI snapshot / interaction tests

Если тест-инфра позволяет (Vitest + React Testing Library):
- U1: `SessionBillModal` без активной подписки → блок «Абонемент» отсутствует.
- U2: `SessionBillModal` с activeSubscription, sufficient hours → toggle отображается, enabled, выключен по умолчанию.
- U3: `SessionBillModal` toggle ON → `cashAmount/cardAmount` поля disabled, discount section pointer-events-none, кнопка «Завершить» enabled.
- U4: `SessionBillModal` toggle OFF после ON → значения восстановлены до `effectiveTotal`/`0`.
- U5: `SessionBillModal` с insufficient hours → toggle disabled, tooltip с цифрой.

Если UI-тестов нет — пропускаем (CLAUDE.md test rule: bizlogic mandatory, UI nice-to-have).

**Минимум для merge:** D1-D5 + P1-P12 + R1-R3 + S1-S6 = **26 тестов**.

---

## 8. Файлы для изменения / создания

### Создать

| Путь | Назначение |
|------|------------|
| `src/modules/subscriptions/debit.ts` | `debitFromSession` + `SubscriptionDebitError` (см. §4.1) |
| `src/modules/subscriptions/__tests__/debit.test.ts` | Unit-тесты D1-D5 (§7.1) |
| `src/app/api/ps-park/sessions/[id]/route.ts` | GET drill-down (§5.2) |
| `src/app/api/ps-park/sessions/[id]/__tests__/route.test.ts` | Route tests S1-S6 |
| `src/app/api/clients/[userId]/subscriptions/active/route.ts` | GET active subscription для UI (§5.3) |
| `src/app/api/clients/[userId]/subscriptions/active/__tests__/route.test.ts` | Route tests C1-C3 |
| `src/app/admin/ps-park/sessions/[id]/page.tsx` | Server-rendered drill-down page (§6.3) |
| `src/components/admin/ps-park/session-detail.tsx` | Client component для drill-down UI (§6.3) |

### Изменить

| Путь | Изменение |
|------|-----------|
| `src/modules/ps-park/service.ts:226-635` | Добавить 9-й параметр `subscriptionId`, subscription pre-flight (§4.2), расширить F1 guard, debit внутри tx, FT/AuditLog metadata. Новый exported `getSessionDetail` для page.tsx. |
| `src/modules/ps-park/__tests__/service.test.ts` | Тесты P1-P12 (§7.2) |
| `src/modules/ps-park/types.ts` | Добавить `SessionDetailDTO`, `SessionPaymentDTO`, `ActiveSubscriptionDTO` (если ещё нет — `BookingBill` extend `userId?: string \| null`). |
| `src/app/api/ps-park/bookings/[id]/route.ts:55,83-88,119-134` | Парсинг `subscriptionId`, передача в сервис, расширение error mapping (§5.1) |
| `src/app/api/ps-park/bookings/[id]/__tests__/route.test.ts` | Тесты R1-R3 |
| `src/components/admin/ps-park/session-bill-modal.tsx` | Toggle «Абонемент», PaymentSplit с `subscriptionId` (§6.1) |
| `src/components/admin/ps-park/complete-session-button.tsx` | Fetch activeSub, проброс в модалку, `subscriptionId` в payload (§6.2) |
| `src/components/admin/ps-park/booking-history-table.tsx:143-145` | Ссылка «Подробнее» → `/admin/ps-park/sessions/[id]` (§6.4) |

### НЕ изменяется в F7 (явный анти-скоуп)

- **`prisma/schema.prisma`** — без изменений. F6 уже даёт `Subscription`, `SubscriptionTransaction`, F5 даёт `Order.bookingId`.
- **`src/modules/booking/state-machine.ts`** — без изменений. Subscription debit живёт в service-слое (как F1 guard, см. F1 ADR §2 Вариант B).
- **`src/modules/booking/payment-gate.ts`** — не выделяем shared helper (YAGNI; беседки subscription не используют).
- **F6 service.ts (`getActiveSubscriptionForUser`)** — F7 потребляет, не модифицирует.
- **Notifications** — не добавляем «уведомление гостю о списании часов» (PRD §Вне скоупа V1).
- **Refund/возврат часов при отмене COMPLETED** — PRD §Вне скоупа.
- **Split-payment** — PRD §Вне скоупа (Решение 4 PO).
- **CLAUDE.md «Реальный список модулей»** — `subscriptions` уже добавлен в F6 PR. F7 не вводит новый модуль.

### Anti-scope guard

- ❌ Никаких новых npm-зависимостей.
- ❌ Никаких новых env переменных.
- ❌ Никаких изменений NextAuth/RBAC infrastructure.
- ❌ Никаких изменений других модулей (cafe, gazebos, rental).
- ❌ Никаких изменений Telegram-бота.
- ❌ Никакого refactor существующего F1 guard за пределами добавления `+ subscriptionCredit`.
- ❌ Никаких изменений schema.prisma.

---

## 9. Влияние на существующие модули

| Модуль | Влияние |
|--------|---------|
| `ps-park` | Прямое: `updateBookingStatus` 9-й параметр; новый `getSessionDetail`. UI: toggle в модалке + drill-down page. |
| `subscriptions` (F6) | Расширение: новый `debit.ts` файл в директории модуля. Reads `getActiveSubscriptionForUser` from service.ts. F6 service.ts НЕ модифицируется. |
| `booking` (state-machine, validation) | Нулевое — вся логика в service-слое (как F1). |
| `cafe` (orders) | Нулевое — F7 только READS `Order.bookingId` для drill-down (F5 link уже в main). |
| `clients` | Нулевое в API. UI: link с drill-down page → `/admin/ps-park/clients/[userId]` если он существует (F4); не зависит от внутренних деталей clients module. |
| `notifications` | Нулевое (V1; уведомление о списании — V1.5 PRD §Вне скоупа). |
| `monitoring` | Нулевое. Existing `SystemEvent` логирование `updateBookingStatus` errors сохраняется. |
| `analytics` | Нулевое прямое. F7-данные (subscription payments) уже доступны через `FinancialTransaction.metadata.paymentMethod` для будущей агрегации без code-changes. |

### RBAC matrix

| Endpoint | USER | MANAGER (без ps-park grant) | MANAGER (с ps-park grant) | SUPERADMIN/ADMIN |
|----------|------|----------------------------|---------------------------|------------------|
| `PATCH /api/ps-park/bookings/:id` (с subscriptionId) | 403 (only own CANCEL) | 403 | 200/422 | 200/422 |
| `GET /api/ps-park/sessions/:id` | 403 | 403 | 200/404 | 200/404 |
| `GET /api/clients/:userId/subscriptions/active` | 403 | 403 | 200 | 200 |
| `/admin/ps-park/sessions/:id` (page) | 404 | 404 | render | render |

Все endpoints следуют единому паттерну: `auth() → requireAdminSection(session, "ps-park") → service`. RBAC реализация копирует существующую модель `bookings/[id]/route.ts:65-67`.

### Defense-in-depth для injection

- `subscriptionId` — string, валидируется через cuid-format check ДО передачи в Prisma; параметризованный запрос `where: { id: subscriptionId }` (нет string concat).
- `userId` в path-params — то же.
- AuditLog `metadata` пишется через Prisma (JSON-serialization, нет SQL injection vector).
- PRD не вводит URL/file/SQL string inputs от пользователя — SSRF/path traversal не применимы.

---

## 10. Чек-лист готовности к Developer

- [x] ADR написан, ≤ 400 строк, с реальными `path:line`
- [x] Schema — без изменений (F6 + F5 уже покрывают)
- [x] API контракты определены: расширение PATCH bookings, новые GET sessions/:id и clients/:userId/subscriptions/active
- [x] RBAC проставлен на каждом endpoint, rate limit указан
- [x] Zod валидация: для `subscriptionId` — inline cuid check, остальное reuse существующего checkoutDiscountSchema
- [x] Миграция данных не нужна
- [x] Backward compat: 9-й параметр опциональный, FT.metadata расширяется опциональными полями
- [x] Decisions matrix: 4 open questions Architect + 3 PO закрыты
- [x] Test plan: D1-D5 (debit) + P1-P12 (ps-park service) + R1-R3 + S1-S6 + C1-C3 = 26 обязательных
- [x] Anti-scope-creep явно зафиксирован (§8 НЕ изменяется)
- [x] Security: injection vectors закрыты (cuid format check, parameterized Prisma queries, no URL/file inputs)
- [x] No new npm dependencies, no new env vars

**Готово к передаче Developer.**
