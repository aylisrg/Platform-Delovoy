# Review: F3 — Gazebos: запрет завершения брони без оплаты

**RUN_ID**: `2026-05-04-gazebos-payment-required-on-complete`  
**Commit**: `763a8c7`  
**Reviewer**: LLM-as-Judge (claude-sonnet-4-6)  
**Дата**: 2026-05-04

---

## Вердикт: NEEDS_CHANGES

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 (gate — нет оплаты) | PASS | `service.ts:509–521`: `paidByOperator < completedTotalBill` → `BookingError("PAYMENT_REQUIRED", ..., { shortfall, totalBill, paid })`. Route возвращает 422. Тест T1. |
| AC-2 (gate — недоплата) | PASS | Та же ветка, `metadata.shortfall = completedTotalBill − paidByOperator`. Тест T2, shortfall=500 проверен. |
| AC-3 (успешное завершение) | PASS | `updateMany + findUniqueOrThrow + financialTransaction.create + auditLog.create` внутри транзакции. Тест T3 проверяет moduleSlug, type, cashAmount, cardAmount. |
| AC-4 (скидка 100%) | PASS | `discountData.finalAmount = 0` → `completedTotalBill = 0` → gate пропускается. FT с `totalAmount=0` создаётся. Тест T4: 2 auditLog (complete + discount_applied). |
| AC-5 (нет тарифа) | PASS | `Number(existingMeta.totalPrice ?? 0) = 0` → gate пропускается. Тест T5. |
| AC-6 (race condition guard) | PASS | `updateMany WHERE status IN [CONFIRMED, CHECKED_IN]`, `count === 0 → BookingError("ALREADY_COMPLETED")`. Route: 409. Тест T6. |
| AC-7 (форма с суммой) | PASS | `GazeboBillModal`: два поля cash/card, `effectiveTotal` отображается. По умолчанию `cash = totalBill, card = 0`. |
| AC-8 (клиентская блокировка) | PASS | `disabled={... isUnderpaid}` в кнопке подтверждения. Комментарий "Defense in depth — server enforces PAYMENT_REQUIRED". |
| AC-9 (ошибка сервера) | PASS | `data.error?.message` сохраняется в `apiError` state, передаётся как prop в `GazeboBillModal`, отображается как `<p role="alert">`. Модалка не закрывается при ошибке. |

---

## Scope Check

- **Scope creep**: Нет
- **F3 commit (763a8c7) трогает ровно 5 файлов**: `service.ts`, `route.ts`, `gazebo-bill-modal.tsx` (новый), `booking-actions.tsx`, `service.test.ts` — строго по ADR §A11.
- `src/modules/ps-park/`, `src/lib/api-response.ts`, `src/app/api/ps-park/`, `src/components/admin/ps-park/` — не тронуты F3-коммитом (они в Wave 1 merge commit `7c3042f`).
- Shared helper `payment-gate.ts` не создан — ADR Variant A соблюдён.
- Схема Prisma не изменена.
- Новых npm-зависимостей нет.

---

## Архитектура

- Бизнес-логика в `service.ts`, route handler только парсит и маппит — OK.
- Snapshot `metadata.totalPrice` согласован с ADR §3.2 и тестом T7 (регресс-защита от пересчёта по часам).
- `BookingError` расширен опциональным 3-м аргументом `metadata` — backward-compatible, все 8+ существующих `throw new BookingError(code, msg)` невредимы.
- `updateBookingStatus` — новые параметры опциональны, дефолт `actorRole = "MANAGER"` — backward-compatible.
- Race guard `updateMany` — идентичен PS Park; `count === 0 → ALREADY_COMPLETED` до вызова `financialTransaction.create` — двойных записей нет.
- `auditLog.create` — внутри транзакции, атомарно с `financialTransaction.create` — OK.

---

## Качество кода

- **TypeScript strict**: нет `any` в новом коде. `as unknown as Prisma.InputJsonValue` — допустимый паттерн для JSON-полей, используется в F1.
- **Zod**: не изменялась — ADR §3.5 явно это обосновывает (`totalBill` — серверная величина).
- **API формат**: `apiError(code, message, status, error.metadata)` — 4-арный вызов корректен.
- **AuditLog**: `booking.complete` и `booking.discount_applied` пишутся внутри транзакции, внешний `logAudit("booking.status_change")` сохраняется в `route.ts:89` — двойная запись намеренна (специализированный + обобщённый лог).
- **Тесты**: 9 кейсов T1–T9 покрывают все 9 AC. T1/T2 проверяют `updateMany NOT called` и `financialTransaction.create NOT called` — нет частичного эффекта. T7 — регресс на snapshot. T9 — CRON bypass.

---

## Issues

### Issue 1 — BLOCKER (AC-7/AC-8): `totalPrice` не передаётся в callers `BookingActions` — модалка всегда показывает 0

**Где**: `src/components/admin/gazebos/booking-list-mobile.tsx:96` и `src/app/admin/gazebos/page.tsx:151`.

**Проблема**: Оба caller передают только `bookingId` и `currentStatus`, не передают `totalPrice`, `resourceName`, `clientName`, `date`, `startTime`, `endTime`. Пропы опциональны с дефолтами (`totalPrice = 0`, `resourceName = "—"`, и т.д.). При открытии модалки `totalBill = 0` → `isUnderpaid = false` → кнопка активна → менеджер завершает бронь без ввода суммы. **Серверный gate при этом сработает** (сервер знает реальный `metadata.totalPrice` брони), но UX ломается: менеджер увидит 422 `PAYMENT_REQUIRED` только после нажатия кнопки с пустой формой.

**Примечание**: Сейчас `page.tsx` и `booking-list-mobile.tsx` показывают только `status: PENDING` бронирования, для которых `canComplete = false` и кнопка «Завершить» не рендерится. Поэтому в production этот путь технически не достижим через существующие UI-поверхности. Но callers не передают нужные данные — это структурная ошибка, которая проявится как только появится новая страница с CONFIRMED бронированиями.

**Что исправить**: В `page.tsx:151` и `booking-list-mobile.tsx:96` добавить передачу `totalPrice`, `resourceName`, `clientName`, `date`, `startTime`, `endTime` из данных брони. Например, в `page.tsx` эти данные уже доступны из query (`b.clientName`, `gazeboName`, `b.startTime`, `b.endTime`, `b.date`, `metadata.totalPrice`).

---

### Issue 2 — MINOR (AC-8 / T8 inconsistency): `isBalanced` блокирует переплату в UI, T8 проверяет что сервер её принимает

**Где**: `src/components/admin/gazebos/gazebo-bill-modal.tsx:67, 309`.

**Проблема**: `isBalanced = Math.abs(effectiveTotal - cash - card) < 0.01`. При переплате (например, card=2000, total=1500) `remainder = -500`, `isBalanced = false`, кнопка задизейблена. T8 проверяет, что сервер принимает `cardAmount=2000 > totalBill=1500` — но UI не позволяет это отправить. PRD AC-8 говорит блокировать при `cash + card < totalBill`, про переплату не сказано. Расхождение между T8 и возможностями UI.

**Что исправить**: Заменить `isBalanced` в disabled на `isUnderpaid` (или дополнить: `disabled={confirming || isUnderpaid || !discountValid}`). Либо убрать T8, если переплата намеренно не разрешается через UI. Выбор остаётся за Developer.

---

## Security

- **Secrets leakage**: В F3 diff нет паролей, токенов, NEXTAUTH-переменных, Telegram token. `FT.metadata` содержит только бизнес-данные брони — OK.
- **RBAC**: Endpoint `PATCH /api/gazebos/bookings/:id` не изменяет существующую цепочку `auth() → requireAdminSection("gazebos")`. `userId` для `performedById` берётся из `session.user.id` (route.ts), не из body. USER-ветка позволяет только отмену своих броней — не затронута. OK.
- **Injection**: Нет `$executeRawUnsafe`, нет raw SQL. `cashAmount`/`cardAmount` проверяются `typeof === "number"` на уровне route до передачи в сервис. `dangerouslySetInnerHTML` — отсутствует. OK.
- **Supply chain**: Новых npm-зависимостей нет. `package.json` F3-коммитом не изменялся. OK.
- **Dangerous ops**: Нет. OK.

**Security verdict: PASS** (инцидентов не обнаружено).

---

## Что хорошо

- Точное следование ADR Variant A: inline copy-paste без рефакторинга F1, F1 не тронут.
- Snapshot `metadata.totalPrice` вместо пересчёта — семантически верно для беседок; T7 обеспечивает регресс-защиту.
- `BookingError` расширен минимально и backward-compatible — существующие throws не сломаны.
- Транзакция атомарна: `updateMany + findUniqueOrThrow + financialTransaction.create + auditLog.create` — правильный порядок, двойных FT-записей нет.
- `gazebo-bill-modal.tsx` создан как новый файл (domain isolation), не переиспользован PS Park modal.
- `apiError` prop в модалке — правильный паттерн: modal не закрывается при 422, пользователь видит shortfall message.
- Все 9 AC покрыты тестами T1–T9 с чёткими assert на отсутствие побочных эффектов (T1/T2: NOT called).
- Commit scope clean: ровно 5 файлов, no scope creep.

---

## Что исправить (обязательно перед QA)

1. **`src/app/admin/gazebos/page.tsx:151`** — передать `totalPrice` (из `(b.metadata as {totalPrice?: string})?.totalPrice`), `resourceName` (`gazeboName`), `clientName` (`name`), `date` (`b.date.toISOString().split("T")[0]`), `startTime`/`endTime` (форматированные HH:MM) в `GazeboBookingActions`.
2. **`src/components/admin/gazebos/booking-list-mobile.tsx:96`** — аналогично, передать `totalPrice` и display-поля из данных бронирования (тип `GazeboMobileBookingRow` уже содержит нужные поля).
3. **`src/components/admin/gazebos/gazebo-bill-modal.tsx:309`** — уточнить семантику `isBalanced` в `disabled`: если переплата (AC-3: `>= totalBill`) должна разрешаться, заменить условие.
