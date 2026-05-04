# ADR: PS Park — gate `PAYMENT_REQUIRED` при завершении сессии

**RUN_ID**: `2026-05-04-ps-park-payment-required-on-complete`
**Дата**: 2026-05-04
**Статус**: Принято
**Ветка**: `claude/fix-booking-session-closure-7SSOS`
**PRD**: [`docs/requirements/2026-05-04-ps-park-payment-required-on-complete-prd.md`](../requirements/2026-05-04-ps-park-payment-required-on-complete-prd.md)

---

## 1. Контекст и проблема

`updateBookingStatus` (`src/modules/ps-park/service.ts:225–617`) в ветке `status === "COMPLETED"` принимает `cashAmount`, `cardAmount` и `discountInput` без какой-либо серверной проверки того, что введённые суммы действительно покрывают счёт. UI (`session-bill-modal.tsx:373`) блокирует submit только при `!isBalanced || !discountValid`, но `isBalanced` сравнивает с `effectiveTotal`, который пользователь сам и формирует — значит достаточно прямого PATCH-запроса в обход интерфейса (или тривиального обнуления полей в DevTools), чтобы закрыть сессию на нулевую сумму.

PRD фиксирует 8 AC, явный edge `actorRole === "CRON"` (auto-complete не должен ломаться), edge `totalBill === 0` (техническая бронь без тарифа), а также race-condition guard (`updateMany` + `ALREADY_COMPLETED`), который **уже работает** и не подлежит изменению.

Скоуп — только `ps-park`. Беседки (F3), UI красной карточки (F2), карточка гостя (F4), `Order.bookingId` (F5), абонементы (F6/F7) — отдельные тикеты.

---

## 2. Варианты

### Вариант A — Guard в `assertValidTransition` (state-machine)

Расширить `TransitionContext` полями `totalBill`, `cashAmount`, `cardAmount`, `discountedAmount` и добавить `condition` к правилу `CONFIRMED:COMPLETED`/`CHECKED_IN:COMPLETED`.

- **Плюсы**: вся business-policy в одном месте (state-machine), легко переиспользовать для беседок (F3).
- **Минусы**: state-machine сейчас pure-функция от чисто статусных аргументов (`now`, `startTime`, `noShowThresholdMinutes`). Чтобы вычислить `totalBill`, нужен `Resource.pricePerHour` + items snapshot из `Booking.metadata` — это либо тянуть БД-доступ в state-machine (нарушение слоёв), либо передавать готовый `totalBill` снаружи как часть контекста. В обоих случаях state-machine перестаёт быть «sterile pure validator» и становится зависим от расчётов, специфичных для PS Park (и слегка иных для беседок). Открытие коробки Пандоры.

### Вариант B — Guard в `updateBookingStatus` (service.ts)

Добавить проверку в существующую ветку `status === "COMPLETED"` после расчёта `completedTotalBill` (с применённой скидкой), до `prisma.$transaction`.

- **Плюсы**: `completedTotalBill`, `resolvedCash`, `resolvedCard`, `actorRole`, `discountInput` — всё уже есть в локальной области функции (строки 303, 442–443). Изменение точечное (~15 строк), не трогает state-machine, не нарушает слоёв. Race-condition guard остаётся нетронутым.
- **Минусы**: будущая дублирующая логика для беседок. Митигация: в F3 выделим shared-helper `assertPaymentSufficient(totalBill, cash, card, actorRole)` в `src/modules/booking/payment-gate.ts`. На этом тикете преждевременно — YAGNI.

### Вариант C — Гибрид: расчёт в service, проверка в state-machine

Считать `totalBill` в service, передавать в `assertValidTransition` через расширенный `TransitionContext`, проверка живёт в правиле `CONFIRMED:COMPLETED`.

- **Плюсы**: формальное «правильное» разделение.
- **Минусы**: `assertValidTransition` вызывается на строке 244 — задолго до того, как мы знаем `completedTotalBill` (он рассчитывается на строках 312–325 после загрузки `resource`). Чтобы соблюсти порядок, либо вызывать state-machine дважды, либо переставлять расчёт totalBill наверх и тащить туда `resource`/`metadata` — лишний рефакторинг ради формальной чистоты.

### Решение: **Вариант B**

Точечный guard в `service.ts` на ~15 строк, без изменения state-machine, без миграций, без новых зависимостей. Это согласуется с PO Решением 1 («gate — только в сервисном слое») и Решением 2 («CRON исключён из gate»).

---

## 3. Точная сигнатура нового кода

### 3.1 `src/modules/ps-park/service.ts`

Вставка **строго между** строкой 440 (закрывающая `}` блока `if (discountInput && ...)`) и строкой 442 (объявление `resolvedCash`).

```ts
// === PAYMENT GATE ===
// PRD F1 / ADR 2026-05-04-ps-park-payment-required-on-complete:
// Менеджер не должен закрыть сессию на нулевую сумму без явной 100%-скидки
// (которая уже зафиксирована выше в discountData + AuditLog "booking.discount_applied").
// CRON-завершение (autoCompleteExpiredSessions) — safety net для зависших
// сессий; блокировать его означало бы навечно занимать столы.
const paidByOperator = (cashAmount ?? 0) + (cardAmount ?? 0);
if (
  actorRole !== "CRON" &&
  completedTotalBill > 0 &&
  paidByOperator < completedTotalBill
) {
  const shortfall = Math.round((completedTotalBill - paidByOperator) * 100) / 100;
  throw new PSBookingError(
    "PAYMENT_REQUIRED",
    `Необходимо принять оплату: не хватает ${shortfall.toLocaleString("ru-RU")} ₽`,
    { shortfall, totalBill: completedTotalBill, paid: paidByOperator }
  );
}
```

Условие перевода из PRD AC дословно:
- `actorRole !== "CRON"` — Решение 2 PO, Edge Case «actorRole = CRON».
- `completedTotalBill > 0` — Решение 3 PO, Edge Case «totalBill = 0».
- `paidByOperator < completedTotalBill` — основной кейс AC-1, AC-2.
- `paidByOperator >= completedTotalBill` (в т.ч. переплата) — пропускается, AC-6 «cardAmount > totalBill разрешена» сохраняется.
- При 100%-скидке `completedTotalBill === 0` после строки 439 (`completedTotalBill = discountCalc.finalAmount`) — gate пропускает, AC-4 работает.

### 3.2 Расширение `PSBookingError` для metadata

Текущий класс на строках 1792–1799 принимает только `code` и `message`. Добавляем опциональный `metadata`:

```ts
export class PSBookingError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "PSBookingError";
    if (metadata) this.metadata = metadata;
  }
}
```

Остальные `throw new PSBookingError(code, msg)` остаются совместимыми (3-й аргумент опционален).

### 3.3 `src/app/api/ps-park/bookings/[id]/route.ts` (PATCH handler)

Расширяем существующий error-mapping на строках 119–130. Добавляем `PAYMENT_REQUIRED` в список 422-кодов и пробрасываем `metadata` через расширенный `apiError`:

```ts
if (error instanceof PSBookingError) {
  const conflictCodes = new Set([
    "INVALID_STATUS_TRANSITION",
    "ALREADY_COMPLETED",
    "ALREADY_CANCELLED",
  ]);
  const unprocessableCodes = new Set([
    "DISCOUNT_EXCEEDS_LIMIT",
    "PAYMENT_REQUIRED",   // ← новый
  ]);
  const status = conflictCodes.has(error.code)
    ? 409
    : unprocessableCodes.has(error.code)
      ? 422
      : 400;
  return apiError(error.code, error.message, status, error.metadata);
}
```

### 3.4 `src/lib/api-response.ts` — расширение `apiError`

Текущая сигнатура (строки 33–45) не принимает `metadata`. Добавляем 4-й опциональный параметр и расширяем `ApiErrorResponse`:

```ts
type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    metadata?: Record<string, unknown>;
  };
};

export function apiError(
  code: string,
  message: string,
  status = 400,
  metadata?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: metadata ? { code, message, metadata } : { code, message },
    },
    { status }
  );
}
```

Backward-compatible: 4-й аргумент опционален, существующие вызовы (десятки в `src/app/api/`) не меняются.

### 3.5 Zod-схема — `src/modules/ps-park/validation.ts`

**Не трогаем.** Проверка `cash + card >= totalBill` принципиально не выражается в Zod, потому что `totalBill` вычисляется на сервере из `Resource.pricePerHour + Booking.metadata.items + actualEndTime` и недоступен на этапе схемной валидации payload. Это явно зафиксировано в PO Open Question #3 («Zod подтверждает Architect»). Гарант — только сервис.

---

## 4. JSON-контракт ошибки для UI

### Запрос
```http
PATCH /api/ps-park/bookings/{id}
Content-Type: application/json
{ "status": "COMPLETED", "cashAmount": 0, "cardAmount": 0 }
```

### Ответ при недоплате (HTTP 422)
```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "Необходимо принять оплату: не хватает 500 ₽",
    "metadata": {
      "shortfall": 500,
      "totalBill": 500,
      "paid": 0
    }
  }
}
```

**Почему 422, а не 400.** Анализ существующего mapping в `src/app/api/ps-park/bookings/[id]/route.ts:127`: `DISCOUNT_EXCEEDS_LIMIT` → 422. Это ровно тот же класс ошибки — синтаксически валидный запрос (Zod прошёл, типы корректны), но семантически не выполняется бизнес-инвариант. RFC 4918: «422 Unprocessable Entity — server understands the content type and the syntax is correct, but was unable to process the contained instructions». Для единообразия с `DISCOUNT_EXCEEDS_LIMIT` фиксируем 422. Закрывает PO Open Question #2.

**Почему `metadata.shortfall`.** UI должен иметь возможность показать «не хватает 500 ₽» как структурное число (для подсветки полей оплаты, прогресс-бара, локализации) без regex-парсинга строки `message`. Поля `totalBill` и `paid` дополнительно дают контекст для отладки и для будущей диагностики.

---

## 5. UI changes

### 5.1 `src/components/admin/ps-park/session-bill-modal.tsx`

**Defense in depth — UI guard №2** (uplevel существующего `!isBalanced`).

Изменение на строке 373 (`disabled={confirming || !isBalanced || !discountValid}`):

```tsx
const isUnderpaid = effectiveTotal > 0 && (cash + card) < effectiveTotal;
// ...
disabled={confirming || !isBalanced || !discountValid || isUnderpaid}
```

`!isBalanced` уже фактически покрывает этот случай (потому что `isBalanced = remainder ≈ 0` строки 65–66), но добавление явного `isUnderpaid` делает intent читаемым в коде и страхует от любых будущих refactor'ов `isBalanced` (например, если кто-то решит трактовать переплату как «разбалансированную»). Это копеечная страховка.

**Inline-ошибка из API ответа.** В блоке actions (строки 361–378) добавить отдельный slot для ошибки от родителя:

```tsx
{apiError && (
  <p className="px-6 pb-3 text-sm text-red-600">{apiError}</p>
)}
```

И принимать `apiError?: string | null` через props (контролируется родителем — `complete-session-button.tsx`).

### 5.2 `src/components/admin/ps-park/complete-session-button.tsx`

Текущий код (строки 65–67) уже устанавливает `setError(data.error?.message ?? ...)` при `!data.success`. Но: ошибка показывается **только когда модалка закрыта** (строки 85–87, `error && !bill`). Это баг UX — после неудачного submit модалка должна оставаться открытой и показать ошибку внутри.

Изменения:
1. **НЕ закрывать `bill`** при ошибке (закрытие происходит только при `data.success` на строке 62 — это уже корректно).
2. Передать `apiError={error}` в `<SessionBillModal />` (новая prop из 5.1).
3. Сбрасывать `error` при открытии модалки (`handleClick`) — это уже сделано (`setError(null)` на строке 23).
4. Сбрасывать `error` при изменении полей оплаты — реализуется через ключ-зависимость в SessionBillModal (когда `cashRaw` или `cardRaw` меняется, можно вызвать `onErrorClear?.()`). Минимально: сброс при следующей попытке submit.

Никаких новых компонентов. Никакого toast-фреймворка.

---

## 6. Test plan

Все unit-тесты — **в существующем** `src/modules/ps-park/__tests__/service.test.ts` (моки `@/lib/db`, `@/modules/notifications/queue`, `@/modules/inventory/service`, `@/lib/google-calendar` уже настроены, строки 1–50).

### 6.1 Обязательные кейсы (один на каждый AC из PRD)

| # | Test name | Setup | Assert |
|---|-----------|-------|--------|
| T1 (AC-1) | `throws PAYMENT_REQUIRED when cash=0, card=0, no discount, totalBill=300` | `Resource.pricePerHour=300`, `Booking.startTime/endTime`=1h, `status=CHECKED_IN` | `PSBookingError.code === "PAYMENT_REQUIRED"`, `metadata.shortfall === 300`, `prisma.financialTransaction.create` НЕ вызвана, `prisma.booking.updateMany` НЕ вызвана |
| T2 (AC-2) | `throws PAYMENT_REQUIRED on partial payment (cash=300, card=0, totalBill=500)` | as above, `pricePerHour=500` | `PSBookingError.code === "PAYMENT_REQUIRED"`, `metadata.shortfall === 200` |
| T3 (AC-3) | `succeeds when cash + card === totalBill` | `cash=300, card=200, totalBill=500` | `updateMany.count` mock returns 1, `financialTransaction.create` вызвана с `totalAmount=500, cashAmount=300, cardAmount=200`, no throw |
| T4 (AC-4) | `succeeds with 100% discount and discountReason="permanent_client"` | `discountPercent=100, discountReason=permanent_client`, `cash=0, card=0`, `originalTotal=500`, `module.config.maxDiscountPercent=100` | `financialTransaction.create` вызвана с `totalAmount=0`, `auditLog.create` вызвана дважды (`session.complete` + `booking.discount_applied`), no throw |
| T5 (AC-5) | covered by Zod tests in `src/modules/booking/__tests__/validation.test.ts` (или эквивалентном) | n/a | UI-level, отмечен как «N/A — Zod schema in route handler» |
| T6 (AC-6) | `succeeds when cardAmount exceeds totalBill (overpayment)` | `cash=0, card=600, totalBill=500` | `financialTransaction.create` вызвана с `cashAmount=0, cardAmount=600`, no throw |
| T7 (AC-7) | `succeeds when totalBill === 0 (no pricePerHour, no items)` | `Resource.pricePerHour=null`, no items, `cash=0, card=0` | `financialTransaction.create` вызвана с `totalAmount=0`, no throw, `PAYMENT_REQUIRED` НЕ выброшен |
| T8 (AC-8) | `throws ALREADY_COMPLETED on race condition` | `updateMany` mock returns `{ count: 0 }` для второго запроса | `PSBookingError.code === "ALREADY_COMPLETED"`. **Уже покрыто существующим тестом**, при необходимости — обновить assertions с учётом нового guard'а (он срабатывает ДО `updateMany`, race не достигается). |

### 6.2 Дополнительный кейс — CRON branch (Open Question #4)

| # | Test name | Setup | Assert |
|---|-----------|-------|--------|
| T9 | `CRON auto-complete bypasses PAYMENT_REQUIRED gate` | `actorRole="CRON"`, `cashAmount=undefined, cardAmount=undefined`, `totalBill=300` | `financialTransaction.create` вызвана с `totalAmount=300, cashAmount=300` (fallback `cashAmount ?? completedTotalBill` на строке 442), no throw, `auditLog.create` вызвана с `action="session.auto_complete"` и `metadata.actor="CRON"` |

Это явный кейс — даёт регресс-защиту против случайного «починим gate, потом обнаружим, что cron не работает».

### 6.3 Что НЕ покрываем в этом PR

- E2E через Playwright/Cypress — out of scope (unit-уровень достаточен, route handler — тонкая обёртка).
- Тест на Zod (поскольку `cash + card >= totalBill` в Zod не валидируется — см. §3.5).
- Тест на изменение `apiError` сигнатуры в isolation (тривиально, покрывается косвенно через T1, T2).

### 6.4 Команда

```bash
npm test -- src/modules/ps-park/__tests__/service.test.ts
```

Должны проходить ВСЕ существующие тесты + 8 новых (T1–T4, T6, T7, T9; T5 N/A; T8 already exists).

---

## 7. Rollout / откат

### Rollout

1. Merge PR → деплой на prod.
2. **Не требуется**: миграция Prisma (схема не меняется), seed (нет новых данных), config-изменения (`Module.config.maxDiscountPercent` остаётся в текущем значении, см. §9 Decisions matrix).
3. Smoke-test после деплоя:
   - PATCH `/api/ps-park/bookings/{id}` `{status:"COMPLETED",cashAmount:0,cardAmount:0}` на тестовой брони с `totalBill > 0` → ожидать 422 `PAYMENT_REQUIRED`.
   - PATCH с `cash=full,card=0` → ожидать 200, статус → COMPLETED.
   - Запустить `/api/ps-park/auto-complete` (cron endpoint) → ожидать `processed > 0` без `errors`.

### Откат

`git revert <merge-commit>` — изменения локализованы в 4 файлах (`service.ts`, `route.ts`, `api-response.ts`, `session-bill-modal.tsx` + `complete-session-button.tsx`), без миграций, без новых таблиц/колонок. Полностью обратимо в один коммит.

### Метрики после релиза (PRD)

SQL-инвариант из PRD (раздел Метрики успеха) проверяется еженедельно. Должен возвращать пустой результат начиная с момента deploy'а.

---

## 8. Влияние на существующие модули

| Модуль | Влияние |
|--------|---------|
| `ps-park` | Прямое: новый guard в `updateBookingStatus`, новый код ошибки `PAYMENT_REQUIRED`. |
| `booking` (state-machine, validation) | Нулевое. State-machine не трогаем (Вариант A отвергнут). `checkoutDiscountSchema` не трогаем (см. Decisions matrix). |
| `gazebos` | Нулевое в этом PR. F3 (отдельный тикет) применит ту же логику; при необходимости в F3 выделим shared-helper в `src/modules/booking/payment-gate.ts`. |
| `notifications`, `inventory`, `analytics` | Нулевое. Никаких новых событий, инвентарных операций, метрик. Существующие `enqueueNotification("booking.completed")` / `FinancialTransaction` — не трогаются. |
| `src/lib/api-response.ts` | Расширение `apiError`: добавлен опциональный 4-й параметр `metadata`. Backward-compatible — десятки существующих вызовов не меняются. Новое поле `error.metadata` появляется ТОЛЬКО когда оно явно передано (см. ternary в §3.4). |

### RBAC

Новый код **не добавляет новых endpoints** и не меняет существующие RBAC-проверки:

- `PATCH /api/ps-park/bookings/:id` уже защищён: `auth()` → `requireAdminSection(session, "ps-park")` → проверка `hasRole(session.user, "MANAGER")` (route.ts:44–67). USER может только отменять свои брони. SUPERADMIN наследует доступ.
- Rate limiting: уже применяется на уровне global middleware (см. CLAUDE.md, раздел «Rate Limiting», 120 req/min для авторизованных).
- AuditLog: записи `session.complete` / `session.auto_complete` / `booking.discount_applied` пишутся в существующей транзакции (service.ts:495–542) — не меняются.
- Гость не может вызвать `updateBookingStatus(..., "COMPLETED")` напрямую (route handler требует `MANAGER` для COMPLETE).

Новых секретов, env-переменных, внешних URL/SQL-инъекций нет. SECURITY.md guardrails не нарушены.

---

## 9. Decisions matrix (закрытие Open Questions PO)

| Open Q | Варианты | **Выбрано** | Обоснование |
|--------|----------|-------------|-------------|
| **#1: maxDiscountPercent vs 100%-скидка** | (a) `allowFullDiscount: boolean` в `Module.config`; (b) 100% только SUPERADMIN, MANAGER ≤ `maxDiscountPercent`; (c) 100% любому MANAGER при наличии reason. | **(c) с условием — оставить как есть, поднять `Module.config.maxDiscountPercent` до 100 для `ps-park`** | Текущий `getMaxDiscountPercent` (`src/modules/booking/discount.ts:38–49`) и `applyDiscount` уже поддерживают значения 1–100 (Zod `max(100)`). PO рекомендовал (b), но (b) требует **новой проверки роли** в `updateBookingStatus` (`if (discountPercent === 100 && actorRole !== "SUPERADMIN") throw`), что добавляет API-сюрприз: «менеджер выбрал 100%, форма прошла валидацию, бэк вернул 403». Это плохой UX. Альтернатива: установить `Module.config.maxDiscountPercent=100` для модуля `ps-park` через admin-UI (`/admin/ps-park/settings`) **отдельно** от этого PR (op-задача, не код). Все обязательные guards (непустой `discountReason`, AuditLog, причина из enum) уже работают. **Скоуп ADR это не расширяет** — единственное действие в этом PR: подтвердить, что схема и код **уже** позволяют 100% при условии настроенного config. Если оператор хочет ограничить менеджеров 30% — оставит config как есть, и тогда «закрыть бесплатно» сможет только SUPERADMIN, физически меняя config (что само по себе аудит-trail). Это решение **минимально инвазивно** и не требует новых полей/проверок ролей. |
| **#2: HTTP-статус 400 vs 422** | 400 / 422 | **422** | Соответствует существующему mapping в этом же handler'е: `DISCOUNT_EXCEEDS_LIMIT` → 422 (route.ts:127). Семантически: запрос синтаксически валиден, но бизнес-инвариант не выполнен — RFC 4918 «Unprocessable Entity». Единообразие важнее формального следования task brief'у. |
| **#2.bis: `metadata.shortfall` в ошибке** | да / нет | **да** | UI должен подсвечивать недоплату числом, не regex'ом по `message`. Также пробрасываем `totalBill` и `paid` для отладки/локализации. Стоимость: +1 опциональный параметр в `apiError`, +1 опциональное поле в `error`. Backward-compatible. |
| **#3: где живёт guard** | service / state-machine / hybrid | **service.ts (Вариант B)** | `completedTotalBill`, `actorRole`, `discountInput` уже в локальной области функции. State-machine не получает БД-доступ к `Resource.pricePerHour` и items — её надо ломать или дублировать. PO рекомендовал service. Подтверждаем. |
| **#4: тест CRON-ветки** | включать / не включать | **включать (T9)** | Без явного теста любая будущая правка gate может незаметно сломать `autoCompleteExpiredSessions`. Один доп. unit-тест — низкая стоимость, высокая регресс-ценность. |

---

## 10. Что НЕ делаем (явный анти-скоуп)

Отдельный список, чтобы Developer и Reviewer не поддались соблазну расширить:

- ❌ **Беседки (gazebos)** — отдельный тикет F3.
- ❌ **UI красной карточки истёкшей сессии** — F2.
- ❌ **Карточка гостя** — F4.
- ❌ **`Order.bookingId`** — F5.
- ❌ **Абонементы** — F6/F7.
- ❌ **Изменения `prisma/schema.prisma`** — никаких новых полей, моделей, миграций.
- ❌ **Новый shared-helper `payment-gate.ts`** — выделим в F3, когда появится второй потребитель. YAGNI.
- ❌ **Новые npm-зависимости** — нет.
- ❌ **Новые env-переменные** — нет.
- ❌ **Изменения NextAuth, RBAC, Redis, Telegram-бота** — нет.
- ❌ **Изменения checkoutDiscountSchema (Zod)** — оставляем `max(100)`, текущая схема уже корректна.
- ❌ **Refactor state-machine** — оставляем pure-функцию.
- ❌ **Исторические данные** — не пересчитываем существующие COMPLETED брони с `cashAmount + cardAmount = 0`. Они идут в SQL-инвариант мониторинга PRD как «зафиксированные раньше».

---

## 11. Чеклист готовности к Developer

- [x] ADR написан, обоснован, ≤ 400 строк
- [x] Точные сигнатуры (path:line) указаны: `service.ts:440-442`, `service.ts:1792-1799`, `route.ts:119-130`, `api-response.ts:33-45`, `session-bill-modal.tsx:373`, `complete-session-button.tsx:65-87`
- [x] Класс ошибки определён (`PSBookingError` с расширенным конструктором)
- [x] HTTP-mapping определён (422 для `PAYMENT_REQUIRED`)
- [x] JSON-контракт ошибки определён (с `metadata.shortfall/totalBill/paid`)
- [x] UI-изменения определены (без новых компонентов)
- [x] Test plan конкретен (T1–T9, файл и моки указаны)
- [x] CRON branch явно покрыт тестом (T9)
- [x] Rollback-план: revert PR
- [x] Никаких миграций, новых зависимостей, env, новых endpoints
- [x] RBAC: проверки не меняются, новые endpoint'ы не появляются
- [x] Все Open Questions PO закрыты в Decisions matrix
- [x] Anti-scope-creep явно зафиксирован (§10)

---

**Готово к передаче Developer.**
