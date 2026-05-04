# ADR: Gazebos — gate `PAYMENT_REQUIRED` при завершении брони (F3)

**RUN_ID**: `2026-05-04-gazebos-payment-required-on-complete`
**Дата**: 2026-05-04
**Статус**: Принято
**Ветка**: `claude/wave-2-gazebos-subscriptions` (от main после merge Wave 1 PR #236)
**PRD**: [`docs/requirements/2026-05-04-gazebos-payment-required-on-complete-prd.md`](../requirements/2026-05-04-gazebos-payment-required-on-complete-prd.md)
**Образец-предшественник**: [`docs/architecture/2026-05-04-ps-park-payment-required-on-complete-adr.md`](./2026-05-04-ps-park-payment-required-on-complete-adr.md) (F1, mergedf)

---

## 1. Контекст и проблема

`updateBookingStatus` (`src/modules/gazebos/service.ts:363–584`) в ветке `status === "COMPLETED"` (`service.ts:469–549`) **никогда не принимает** оплату — нет параметров `cashAmount`/`cardAmount`, нет создания `FinancialTransaction`, нет проверки покрытия счёта. Менеджер беседок переводит бронь в COMPLETED одной кнопкой; деньги в кассу проходят (или не проходят) вне системы.

После F1 (merged, PR #236) PS Park закрывает этот класс ошибок через payment-gate в сервисном слое + расширенный `PSBookingError` с `metadata` + `apiError` 4-арный (см. `src/lib/api-response.ts:34–47`). PRD F3 явно требует **прямой перенос того же паттерна** на gazebos без изобретения новой архитектуры (PO Решения R1, R2 в context-log).

Скоуп F3 — только запрет завершения без оплаты + создание `FinancialTransaction`. Активная сессия беседок, items в счёте, абонементы, изменение F1 — out of scope.

---

## 2. Варианты

### Вариант A — Inline copy-paste guard'а из F1

Скопировать guard из `src/modules/ps-park/service.ts:443–456` в gazebos `service.ts` без выделения общего helper'а. F1 не трогается.

- **Плюсы**: минимальный diff (~20 строк добавления, никаких рефакторингов F1). Полная изоляция от F1: ошибка в F3 не сломает F1. Проще review.
- **Минусы**: дублирование. При появлении третьего потребителя (например, sauna в Phase 5.x) дубль будет в трёх местах. Изменение politики gate (например, добавить `Resource.metadata.allowPostPayment`) потребует править все копии.

### Вариант B — Shared helper `src/modules/booking/payment-gate.ts` + рефакторинг F1

Выделить функцию `assertPaymentSufficient(totalBill, cash, card, actorRole, ErrorClass)` в shared-модуле, вызвать её из ps-park (заменив inline-блок) и gazebos.

- **Плюсы**: DRY, единое место для будущих изменений политики.
- **Минусы**:
  - Расширяет scope F3: трогает F1, который уже в main и работает. Любая опечатка в helper'е ломает работающий PS Park.
  - Reviewer обязан вынести verdict NEEDS_CHANGES за scope creep (CLAUDE.md §«Scope guard»: «Каждый PR ≤ одна фича»).
  - Архитектурный рефакторинг F1 — это **отдельный** ADR/PR, не F3.

### Вариант C — Guard в state-machine

Расширить `TransitionContext` полем `totalBill` + `paid`, перенести проверку в правило `CONFIRMED:COMPLETED` / `CHECKED_IN:COMPLETED` (`src/modules/booking/state-machine.ts:51–56`).

- **Плюсы**: формальная чистота (политика в state-machine).
- **Минусы**: полностью отвергнут в F1 (см. F1 ADR §2 Вариант A). State-machine — pure-функция; добавление туда расчёта стоимости тащит зависимости от Resource/metadata/Discount. F3 не должен пересматривать архитектурное решение F1.

### Решение: **Вариант A**

Прямой перенос паттерна F1 в gazebos. Дублирование осознанное и временное — выделение shared-helper'а отложено до появления **третьего** потребителя (YAGNI). Это согласуется с PO Решением R1 (минимальный scope) и R2 (прямой перенос без изобретения нового).

Open Question #1 от PO **закрыт**: Variant inline (без shared-helper в этом PR).

---

## 3. Точная сигнатура нового кода

### 3.1 `src/modules/gazebos/service.ts` — расширение `updateBookingStatus`

**Текущая сигнатура** (`service.ts:363–369`):

```ts
export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  discountInput?: CheckoutDiscountInput
)
```

**Новая сигнатура** (порядок параметров идентичен PS Park `service.ts:226–235` для упрощения менторской работы — закрывает Open Question #4 PO):

```ts
import type { ActorRole } from "@/modules/booking/state-machine";

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  managerId?: string,
  cancelReason?: string,
  cashAmount?: number,
  cardAmount?: number,
  discountInput?: CheckoutDiscountInput,
  actorRole: ActorRole = "MANAGER"
)
```

`actorRole` дефолтится в `"MANAGER"` (gazebos не имеет CRON-завершения сегодня — context R5 — но параметр добавляется для симметрии и страховки на будущее, как в F1).

### 3.2 Расчёт `totalBill` (закрытие Open Question PO о снэпшоте vs пересчёте)

**Решение: брать `metadata.totalPrice`-снэпшот**, записанный при создании брони (`service.ts:222`, `service.ts:339` через `computeGazeboPricing`). Не пересчитывать.

**Обоснование** (закрывает PRD Open Question #2 + Architect Open Question #2):

1. **Бизнес-семантика** беседок отлична от PS Park: клиент бронирует слот заранее и оплачивает его целиком, а не «фактическое время сидения». Если клиент пришёл на 15 минут — это не повод выставить меньший счёт. (PS Park — игровая сессия с почасовой тарификацией; беседка — забронированный ресурс.)
2. `computeGazeboPricing` (`pricing.ts:108–141`) уже рассчитывает `totalPrice` с учётом weekday/weekend, дневного тарифа и `itemsTotal`. Используем готовый снэпшот, не дублируем расчёт.
3. Если применена скидка — после применения `discountInput` в блоке (`service.ts:474–504`) у нас уже есть `discountData.finalAmount`. Используем её.

**Псевдокод вставки** в `service.ts` после строки 504 (после построения `updatedMetadata`, **до** `prisma.$transaction`):

```ts
// === COMPLETED branch — replace lines 506–549 ===

// totalBill: post-discount snapshot of metadata.totalPrice.
// gazebos pricing is fixed-at-booking, not pay-as-you-go like PS Park.
const originalTotal = Number(existingMeta.totalPrice ?? 0);
const completedTotalBill = discountData
  ? Number(discountData.finalAmount)
  : originalTotal;

// === PAYMENT GATE ===
// PRD F3 / ADR 2026-05-04-gazebos-payment-required-on-complete:
// Менеджер не должен закрыть бронь на нулевую сумму без явной 100%-скидки
// (которая зафиксирована выше в discountData + AuditLog "booking.discount_applied").
// CRON-завершение не существует для gazebos сегодня (см. context R5),
// но guard написан так, чтобы не блокировать его в будущем.
if (actorRole !== "CRON" && completedTotalBill > 0) {
  const paidByOperator = (cashAmount ?? 0) + (cardAmount ?? 0);
  if (paidByOperator < completedTotalBill) {
    const shortfall =
      Math.round((completedTotalBill - paidByOperator) * 100) / 100;
    throw new BookingError(
      "PAYMENT_REQUIRED",
      `Необходимо принять оплату: не хватает ${shortfall.toLocaleString("ru-RU")} ₽`,
      { shortfall, totalBill: completedTotalBill, paid: paidByOperator }
    );
  }
}

const resolvedCash = cashAmount ?? completedTotalBill;
const resolvedCard = cardAmount ?? 0;

const managerUser = managerId
  ? await prisma.user.findUnique({
      where: { id: managerId },
      select: { name: true, email: true },
    })
  : null;
const managerName = managerUser?.name ?? managerUser?.email ?? "Менеджер";

updated = await prisma.$transaction(async (tx) => {
  // Idempotent COMPLETE — same race-guard pattern as PS Park
  // (src/modules/ps-park/service.ts:475–487).
  const res = await tx.booking.updateMany({
    where: { id, status: { in: ["CONFIRMED", "CHECKED_IN"] } },
    data: {
      status,
      ...(managerId && { managerId }),
      ...(googleEventId !== booking.googleEventId && { googleEventId }),
      metadata: updatedMetadata as unknown as import("@prisma/client").Prisma.InputJsonValue,
      cashAmount: resolvedCash,
      cardAmount: resolvedCard,
    },
  });
  if (res.count === 0) {
    throw new BookingError("ALREADY_COMPLETED", "Бронирование уже завершено");
  }
  const b = await tx.booking.findUniqueOrThrow({ where: { id } });

  // Financial ledger — immutable revenue record (totalAmount = post-discount).
  await tx.financialTransaction.create({
    data: {
      moduleSlug: MODULE_SLUG,
      type: "SESSION_PAYMENT",
      bookingId: id,
      totalAmount: completedTotalBill,
      cashAmount: resolvedCash,
      cardAmount: resolvedCard,
      performedById,
      performedByName: managerName,
      description: `Беседка: ${resource?.name ?? "—"} · ${booking.clientName ?? "—"}`,
      metadata: {
        resourceName: resource?.name ?? "—",
        clientName: booking.clientName ?? "—",
        date: booking.date.toISOString().split("T")[0],
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        originalTotal,
        ...(discountData && {
          discountPercent: discountData.percent,
          discountAmount: Number(discountData.amount),
          finalAmount: Number(discountData.finalAmount),
        }),
      } as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  // Specialized audit (atomic with FT, like F1 service.ts:512–532).
  const completionAction =
    actorRole === "CRON" ? "booking.auto_complete" : "booking.complete";
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
        totalAmount: completedTotalBill,
        cashAmount: resolvedCash,
        cardAmount: resolvedCard,
        ...(actorRole === "CRON" && { actor: "CRON" }),
      },
    },
  });

  if (discountData) {
    // Existing discount audit (preserved from current code lines 522–545)
    await tx.auditLog.create({
      data: {
        userId: performedById,
        action: "booking.discount_applied",
        entity: "Booking",
        entityId: id,
        metadata: {
          managerId: performedById,
          managerName,
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
```

**Округление billedHours для беседок** (Architect Open Question #2):
Не применяется — беседки используют **снэпшот `metadata.totalPrice`**, а не пересчёт по часам. `computeGazeboPricing` (`pricing.ts:121`) уже считает часы как `(endTime - startTime) / 3600000` (десятичные доли часов через дневной тариф учитываются автоматически). 15-минутный шаг PS Park не релевантен.

### 3.3 Расширение `BookingError` (закрытие Architect Open Question #3)

Текущий `BookingError` в `service.ts:1052–1058` принимает только `(code, message)`. Расширяем по образцу F1 `PSBookingError`:

```ts
export class BookingError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "BookingError";
    if (metadata) this.metadata = metadata;
  }
}
```

**Не создаём** отдельный `GazeboBookingError` — `BookingError` уже привязан к gazebos (используется в `service.ts:132`, `144`, `149`, `179`, `251`, `256`, `280`, etc.) и в роуте `route.ts:13`. Создание нового класса ломает все существующие импорты ради косметики.

Backward-compatibility: 3-й аргумент опционален — все существующие `throw new BookingError(code, msg)` остаются валидными. Аналогично F1 решению с `PSBookingError`.

### 3.4 `src/app/api/gazebos/bookings/[id]/route.ts` — error mapping

**Текущий блок** (`route.ts:108–114`):

```ts
if (error instanceof BookingError) {
  const status = error.code === "DISCOUNT_EXCEEDS_LIMIT" ? 422 : 400;
  return apiError(error.code, error.message, status);
}
```

**Замена** (один-в-один с PS Park `route.ts:119–134`):

```ts
if (error instanceof BookingError) {
  const conflictCodes = new Set([
    "INVALID_STATUS_TRANSITION",
    "ALREADY_COMPLETED",
    "ALREADY_CANCELLED",
  ]);
  const unprocessableCodes = new Set([
    "DISCOUNT_EXCEEDS_LIMIT",
    "PAYMENT_REQUIRED",
  ]);
  const status = conflictCodes.has(error.code)
    ? 409
    : unprocessableCodes.has(error.code)
      ? 422
      : 400;
  return apiError(error.code, error.message, status, error.metadata);
}
```

**Также** в PATCH handler (`route.ts:55, 84`) — добавить парсинг `cashAmount`/`cardAmount` и пробросить в сервис:

```ts
// route.ts:55 — расширить деструктуризацию
const { reason, confirmPenalty, cashAmount, cardAmount } = body;

// route.ts:84 — обновить вызов
updated = await updateBookingStatus(
  id,
  status,
  session.user.id,
  reason,
  typeof cashAmount === "number" ? cashAmount : undefined,
  typeof cardAmount === "number" ? cardAmount : undefined,
  discountInput
);
```

### 3.5 Zod-схема — `src/modules/gazebos/validation.ts`

**Не трогаем.** Аналогично F1: `cash + card >= totalBill` принципиально не выражается в Zod, потому что `totalBill` — серверная величина из `metadata.totalPrice`. Гарант — только сервис (см. F1 ADR §3.5).

### 3.6 RBAC и Rate Limiting

**Изменений нет** — endpoint `PATCH /api/gazebos/bookings/:id` уже защищён:

- `auth()` (`route.ts:44`) → 401 если нет сессии.
- `requireAdminSection(session, "gazebos")` (`route.ts:67`) → 403 для USER без модульной привязки. SUPERADMIN/ADMIN — full access; MANAGER — только при `hasAdminSectionAccess(userId, "gazebos")`.
- USER может только `cancelBooking` своих броней (`route.ts:59–64`); COMPLETED для USER невозможен.
- Rate limiting — глобальный middleware (CLAUDE.md «Rate Limiting», 120 req/min для авторизованных).
- Audit: `logAudit("booking.status_change", ...)` (`route.ts:89`) сохраняется как наружный аудит; специализированные `booking.complete`/`booking.discount_applied` пишутся внутри транзакции (см. §3.2).

Нет новых endpoints, нет новых ролей, нет изменения CORS / NextAuth / Telegram / Redis.

---

## 4. JSON-контракт ошибки для UI

Идентичен F1 (PRD AC-1, AC-2 требуют поля `shortfall`, `totalBill`, `paid`).

### Запрос (попытка завершить без оплаты)
```http
PATCH /api/gazebos/bookings/{id}
Content-Type: application/json
{ "status": "COMPLETED", "cashAmount": 0, "cardAmount": 0 }
```

### Ответ при недоплате (HTTP 422)
```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "Необходимо принять оплату: не хватает 1 500 ₽",
    "metadata": {
      "shortfall": 1500,
      "totalBill": 1500,
      "paid": 0
    }
  }
}
```

### Ответ при race-condition (HTTP 409)
```json
{
  "success": false,
  "error": { "code": "ALREADY_COMPLETED", "message": "Бронирование уже завершено" }
}
```

### Ответ при успехе (HTTP 200)
Стандартный `apiResponse(updated)` — обогащённая бронь с верхнеуровневыми discount-полями (если применима скидка), как сейчас в `route.ts:96–104`.

422 (не 400) — единообразно с `DISCOUNT_EXCEEDS_LIMIT` и с F1, RFC 4918 «Unprocessable Entity».

---

## 5. UI changes

### 5.1 Можно ли переиспользовать `session-bill-modal.tsx` из ps-park?

**Решение: создать новый, упрощённый `gazebo-bill-modal.tsx`.**

`session-bill-modal.tsx` (`src/components/admin/ps-park/session-bill-modal.tsx`) тесно связан с типом `BookingBill` из ps-park (`bill.items`, `bill.billedHours`, `bill.durationMin`, `bill.hoursCost`, `bill.itemsTotal`) — для беседок это лишняя сложность:
- беседки **не имеют** items на чекауте (PRD: «items/inventory вне scope»);
- беседки используют **снэпшот** `totalPrice`, без `billedHours`/`durationMin` пересчёта;
- импорт PS Park модального окна в gazebos нарушит domain isolation (CLAUDE.md «каждый модуль изолирован»).

Поэтому создаём `src/components/admin/gazebos/gazebo-bill-modal.tsx` — структура аналогична PS Park, но проще:

```tsx
type GazeboBill = {
  resourceName: string;
  clientName: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  totalBill: number;   // metadata.totalPrice (number)
};

type Props = {
  bill: GazeboBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (split: PaymentSplit) => void;
  confirming: boolean;
  maxDiscountPercent?: number;
  apiError?: string | null;
};

export type PaymentSplit = {
  cashAmount: number;
  cardAmount: number;
  discountPercent?: number;
  discountReason?: string;
  discountNote?: string;
};
```

Логика разбиения cash/card, скидки, кнопка disable при `isUnderpaid` — копируется из PS Park (с тем же inline-комментарием «Defense in depth — server enforces PAYMENT_REQUIRED»).

### 5.2 `src/components/admin/gazebos/booking-actions.tsx` — переделка

Текущий код (`booking-actions.tsx:81–198`) показывает кнопки «Завершить»/«Завершить со скидкой» прямо в карточке. После F3:

1. Кнопка «Завершить» **открывает** `<GazeboBillModal />` вместо прямого PATCH.
2. Старая «Завершить со скидкой» удаляется — скидка переезжает внутрь модалки (toggle «+ Применить скидку», как в PS Park).
3. PATCH с `cashAmount`/`cardAmount`/`discountPercent` отправляется из `onConfirm` модалки.
4. Если ответ 422 `PAYMENT_REQUIRED` — модалка остаётся открытой, `apiError` пробрасывается из родителя как prop, поля cash/card можно перебрать.
5. Кнопки «Подтвердить» (PENDING → CONFIRMED) и «Отменить» — без изменений.

`totalPrice` для модалки берётся из `metadata.totalPrice` брони — тот самый снэпшот (см. §3.2).

### 5.3 Что НЕ создаём

- ❌ Активная сессия беседок, таймер, статус CHECKED_IN — out of scope (PO R1).
- ❌ items/inventory в счёте — out of scope.
- ❌ Toast-фреймворк, новая UI-библиотека.
- ❌ Изменения `complete-session-button.tsx` или `session-bill-modal.tsx` (PS Park).

---

## 6. Test plan

Файл — **существующий** `src/modules/gazebos/__tests__/service.test.ts` (моки `@/lib/db`, `@/modules/notifications/queue`, `@/modules/inventory/service`, `@/lib/google-calendar` уже настроены, строки 3–51). Расширить mock `prisma.booking.updateMany` (нет в текущем — добавить) и `prisma.financialTransaction.create`:

```ts
// расширение vi.mock("@/lib/db") в service.test.ts
booking: {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),                    // ← новый
  findUniqueOrThrow: vi.fn(),             // ← новый, для возврата после updateMany
  count: vi.fn(),
},
financialTransaction: { create: vi.fn() }, // ← новый
```

И в `$transaction` mock (`service.test.ts:37–49`) добавить `tx.booking.updateMany`, `tx.booking.findUniqueOrThrow`, `tx.financialTransaction.create`.

### 6.1 Минимальный набор кейсов (по AC из PRD, без копирования F1-кейсов)

| # | AC | Test | Setup | Assert |
|---|----|------|-------|--------|
| T1 | AC-1 | `gazebos: throws PAYMENT_REQUIRED when cash=0, card=0, totalBill=1500` | booking `metadata.totalPrice="1500.00"`, `status=CONFIRMED`, `cashAmount`/`cardAmount` не переданы | `BookingError.code === "PAYMENT_REQUIRED"`, `metadata.shortfall === 1500`, `metadata.totalBill === 1500`, `metadata.paid === 0`. `financialTransaction.create` НЕ вызвана. `booking.updateMany` НЕ вызвана. |
| T2 | AC-2 | `gazebos: throws PAYMENT_REQUIRED on partial payment (cash=1000, card=0, totalBill=1500)` | as above | `metadata.shortfall === 500`, `metadata.paid === 1000` |
| T3 | AC-3 | `gazebos: succeeds when cash + card === totalBill, creates FinancialTransaction` | `cash=1000, card=500, totalBill=1500`, `updateMany` mock returns `{count:1}` | `financialTransaction.create` вызвана с `moduleSlug="gazebos"`, `type="SESSION_PAYMENT"`, `bookingId`, `totalAmount=1500`, `cashAmount=1000`, `cardAmount=500`, `performedById`. AuditLog `booking.complete` создан. No throw. |
| T4 | AC-4 | `gazebos: 100% discount with reason allows cash=0, card=0` | `discountPercent=100, discountReason="permanent_client"`, `originalTotal=1500`, `module.config.maxDiscountPercent=100` (mock-update) | `financialTransaction.create` с `totalAmount=0`. AuditLog `booking.complete` + `booking.discount_applied`. No throw. |
| T5 | AC-5 | `gazebos: succeeds when totalBill === 0 (no priceList, no pricePerHour)` | `metadata.totalPrice="0.00"`, `cash=0, card=0` | `financialTransaction.create` вызвана с `totalAmount=0`. PAYMENT_REQUIRED НЕ выброшен. |
| T6 | AC-6 | `gazebos: throws ALREADY_COMPLETED on race (updateMany.count=0)` | `updateMany` mock returns `{count: 0}`, `cash=1500, card=0, totalBill=1500` | `BookingError.code === "ALREADY_COMPLETED"`. `financialTransaction.create` НЕ вызвана внутри транзакции (так как throw до неё в callback). |

### 6.2 Дополнительные кейсы (полезная регресс-защита, не копирующая F1)

| # | Test | Justification |
|---|------|---------------|
| T7 | `gazebos: snapshot totalPrice is used, not recomputed from pricePerHour × hours` | Регресс на ключевое решение §3.2: если кто-то решит «сделать как PS Park» и пересчитать по факту — этот тест упадёт. Setup: `metadata.totalPrice="2000"` (дневной тариф), но `pricePerHour=500` × 4 часа = 2000 (совпало) ИЛИ `pricePerHour=500` × 4 часа но `metadata.totalPrice="1800"` (день дешевле) — gate использует 1800, не 2000. |
| T8 | `gazebos: cardAmount > totalBill (overpayment) succeeds` | Edge — переплата картой не запрещена (PRD: AC-3 "≥"). |
| T9 | `gazebos: actorRole="CRON" bypasses gate even with totalBill > 0` | Хотя CRON пока не вызывается для gazebos (context R5), guard написан так чтобы не ломать будущий cron. Регресс-защита. |

### 6.3 Что НЕ покрываем

- E2E через Playwright/Cypress — out of scope.
- Тесты UI-модалки `gazebo-bill-modal.tsx` — отдельный smoke-тест (не блокирующий).
- Дублирующие кейсы из F1 PS Park (T1, T7 базовых F1 уже покрыты в `src/modules/ps-park/__tests__/service.test.ts`).

### 6.4 Команда

```bash
npm test -- src/modules/gazebos/__tests__/service.test.ts
```

Должны проходить ВСЕ существующие тесты gazebos + 9 новых (T1–T9).

---

## 7. Rollout / откат

### Rollout

1. Ветка `claude/wave-2-gazebos-subscriptions` → PR → merge в main → деплой prod.
2. **Не требуется**: миграция Prisma (поля `cashAmount`, `cardAmount` в `Booking` и модель `FinancialTransaction` уже в схеме, `prisma/schema.prisma:197–198, 247–265`); seed; config-изменения.
3. Smoke-test после деплоя:
   - PATCH `/api/gazebos/bookings/{id}` `{status:"COMPLETED",cashAmount:0,cardAmount:0}` на тестовой брони с `metadata.totalPrice > 0` → ожидать 422 `PAYMENT_REQUIRED` с `metadata.shortfall`.
   - PATCH `{status:"COMPLETED",cashAmount:full,cardAmount:0}` → ожидать 200, бронь COMPLETED, появилась запись в `FinancialTransaction` с `moduleSlug='gazebos'`.
   - Двойной submit (race) → второй вернёт 409 `ALREADY_COMPLETED`, `FinancialTransaction` ровно одна.

### Откат

`git revert <merge-commit>`. Изменения локализованы:
- `src/modules/gazebos/service.ts` — расширение сигнатуры + COMPLETED branch;
- `src/modules/gazebos/__tests__/service.test.ts` — новые кейсы;
- `src/app/api/gazebos/bookings/[id]/route.ts` — error mapping + parse cash/card;
- `src/components/admin/gazebos/booking-actions.tsx` — переделка;
- `src/components/admin/gazebos/gazebo-bill-modal.tsx` — новый файл.

5 файлов, без миграций, без новых таблиц/колонок, без новых endpoints. Полностью обратимо в один коммит.

### Метрики после релиза

SQL-инвариант из PRD (раздел Метрики успеха) проверяется еженедельно. Должен возвращать пустой результат начиная с момента деплоя. Дополнительно: `SELECT count(*) FROM "FinancialTransaction" WHERE "moduleSlug"='gazebos'` должен быть > 0 уже за первые сутки.

---

## 8. Влияние на существующие модули

| Модуль | Влияние |
|--------|---------|
| `gazebos` | Прямое: новый guard, новый `cashAmount`/`cardAmount` в Booking row, FT-запись, audit `booking.complete`. |
| `ps-park` (F1) | **Нулевое.** Не трогаем service, route, components, tests. |
| `booking` (state-machine, validation, discount) | Нулевое. State-machine — не трогаем. `applyDiscount`/`getMaxDiscountPercent` — используем как есть. |
| `analytics` | Косвенное положительное: `getAnalytics` в `gazebos/service.ts:892–997` уже умеет считать revenue из `metadata.totalPrice` (строки 919–927). После F3 появятся ещё и `FinancialTransaction` записи — это **обновление источника истины** для будущего dashboard (Phase 5.3). В этом PR analytics не меняем. |
| `rental/reports` | Нулевое. Rental не использует `FinancialTransaction` сейчас; новый `moduleSlug='gazebos'` фильтр-аномалий в rental-агрегациях не создаёт (Architect Open Question #5 от PO — проверено: `src/modules/rental/` не делает aggregations по `FinancialTransaction.moduleSlug`). |
| `notifications` | Нулевое. `enqueueNotification("booking.completed")` уже вызывается (`service.ts:573–581`) — продолжает работать. |
| `inventory` | Нулевое. Items при completion не трогаем (текущий код не вызывает inventory в COMPLETED branch — только в CONFIRMED/CANCELLED, см. `service.ts:438–468`). |
| `src/lib/api-response.ts` | Нулевое — `apiError` уже расширен в F1, поддерживает 4-й параметр `metadata`. |

### RBAC

Без изменений (см. §3.6). Никаких новых endpoints, ролей, permissions. Существующая цепочка `auth → requireAdminSection("gazebos") → MANAGER/SUPERADMIN` сохраняется.

### Security (см. agents/SECURITY.md)

- Новых внешних URL, env-переменных, npm-зависимостей **нет**.
- Секреты в response не возвращаются (FT.metadata содержит только бизнес-данные брони).
- Audit для каждой мутации (`booking.complete` + `booking.discount_applied`) — внутри транзакции, атомарно с FT.
- Rate limiting — наследуется от глобального middleware.
- Никаких SQL-like / file-path / URL входов от пользователя — только числовые `cashAmount`/`cardAmount` (тип проверяется `typeof === "number"` на route-уровне, см. §3.4).

---

## 9. Decisions matrix (закрытие Open Questions)

| Open Q | Источник | Варианты | **Выбрано** | Обоснование |
|--------|----------|----------|-------------|-------------|
| **#1: Shared helper или inline?** | Architect Open Q | (a) shared `payment-gate.ts` + рефактор F1; (b) inline copy-paste | **(b) inline** | F1 в main, рефакторинг расширяет scope F3 и нарушает CLAUDE.md «PR ≤ одна фича». Выделение helper — отдельный ADR при появлении 3-го потребителя (sauna в Phase 5.x). YAGNI. |
| **#2: `totalBill` — снэпшот или пересчёт?** | PO + Architect Open Q | (a) `metadata.totalPrice` снэпшот; (b) пересчёт `pricePerHour × billedHours(start, now)` | **(a) снэпшот** | Беседки — фикс-цена за слот, не pay-as-you-go. Используем готовый `computeGazeboPricing` (`pricing.ts:108–141`), не дублируем. |
| **#3: Округление `billedHours`** | Architect Open Q | (a) 15 мин (как PS Park); (b) 1 час; (c) не применяется | **(c) не применяется** | Следствие #2: при снэпшоте `totalPrice` округление часов уже зашито в `computeGazeboPricing`. |
| **#4: `BookingError` или `GazeboBookingError`?** | Architect Open Q | (a) расширить `BookingError`; (b) новый класс | **(a) расширить `BookingError`** | `BookingError` уже привязан к gazebos в 8+ местах (`service.ts:132,144,179,251,...`) и в роуте. Новый класс ломает все импорты ради косметики. Добавить опциональный 3-й аргумент `metadata` — backward-compatible. |
| **#5: Параметры `updateBookingStatus`** | Architect Open Q | (a) симметрия с PS Park; (b) свой порядок | **(a) симметрия** | `(id, status, managerId?, cancelReason?, cashAmount?, cardAmount?, discountInput?, actorRole?)` — bit-to-bit как PS Park. Упрощает менторскую работу, диагональное чтение, и, в перспективе, выделение shared-helper. |
| **#6: Создавать ли отдельный modal-компонент?** | PO + Architect | (a) переиспользовать `session-bill-modal.tsx`; (b) новый `gazebo-bill-modal.tsx` | **(b) новый** | Domain isolation (CLAUDE.md). PS Park modal завязан на items, billedHours, durationMin — для беседок лишний шум. Дублирование ~150 строк осознанно. |
| **#7: Имя audit action** | внутренний | (a) `session.complete` (как PS Park); (b) `booking.complete` | **(b) `booking.complete`** | gazebos оперирует «бронированиями», не «сессиями». Семантика отличается. Парный CRON-вариант — `booking.auto_complete`. |

---

## 10. Что НЕ делаем (явный анти-скоуп)

Чтобы Developer и Reviewer не поддались соблазну расширить:

- ❌ **UI «активной сессии» беседок** (таймер, статус CHECKED_IN визуально) — отдельная фича, не запрошена.
- ❌ **Items / inventory в счёте при checkout беседки** — gazebos не работает с goods-checkout.
- ❌ **Изменения F1 (PS Park)** — не трогаем `src/modules/ps-park/`, `src/components/admin/ps-park/`, `src/app/api/ps-park/`.
- ❌ **Subscriptions / абонементы (F6/F7)** — отдельные тикеты Wave 2.
- ❌ **Refactor `BookingError` → `GazeboBookingError`** — Decisions matrix #4.
- ❌ **Shared `src/modules/booking/payment-gate.ts`** — Decisions matrix #1.
- ❌ **Изменения `prisma/schema.prisma`** — не нужны.
- ❌ **Новые npm-зависимости** — нет.
- ❌ **Новые env-переменные** — нет.
- ❌ **Изменения NextAuth, RBAC, Redis, Telegram-бота, CORS** — нет.
- ❌ **Изменения `checkoutDiscountSchema` (Zod)** — оставляем как есть.
- ❌ **State-machine** — оставляем pure-функцию.
- ❌ **Исторические данные** — не пересчитываем существующие COMPLETED брони. Они зафиксированы как «до релиза» (PRD Метрики успеха).
- ❌ **Изменения `src/lib/api-response.ts`** — `apiError` уже 4-арный после F1.
- ❌ **`computeGazeboPricing`** — не трогаем pricing-логику.
- ❌ **Импорт `session-bill-modal.tsx` из ps-park** — domain isolation.

---

## 11. Чеклист готовности к Developer

- [x] ADR написан, обоснован, ≤ 400 строк
- [x] Точные сигнатуры (path:line) указаны: `service.ts:363–584`, `service.ts:1052–1058`, `route.ts:55,84,108–114`, `pricing.ts:108–141`
- [x] Класс ошибки определён (`BookingError` с расширенным конструктором)
- [x] HTTP-mapping определён (422 для `PAYMENT_REQUIRED`, 409 для `ALREADY_COMPLETED`)
- [x] JSON-контракт ошибки определён (с `metadata.shortfall/totalBill/paid`)
- [x] UI-изменения определены: новый `gazebo-bill-modal.tsx`, переделка `booking-actions.tsx`
- [x] Test plan конкретен (T1–T9, файл и моки указаны)
- [x] CRON edge явно покрыт тестом (T9)
- [x] Rollback-план: revert PR
- [x] Никаких миграций, новых зависимостей, env, новых endpoints
- [x] RBAC: проверки не меняются, новые endpoint'ы не появляются (см. §3.6)
- [x] Все Open Questions PO + Architect закрыты в Decisions matrix
- [x] Anti-scope-creep явно зафиксирован (§10)
- [x] Образец F1 уважён, F1 не модифицируется

---

**Готово к передаче Developer.**
