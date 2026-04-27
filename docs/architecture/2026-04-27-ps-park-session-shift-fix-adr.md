# ADR: Bugfix — Завершение сессии PS Park и выручка смены

**RUN_ID**: `2026-04-27-ps-park-session-shift-fix`
**Дата**: 2026-04-27
**Статус**: Принято
**Связанные документы**: PRD `docs/requirements/2026-04-27-ps-park-session-shift-fix-prd.md`

---

## 1. Контекст

PRD от PO описывает два связанных бага:
- **Bug #1**: кнопки «Завершить» и «Отменить» сессию в админке PS Park не реагируют — сессия остаётся в исходном статусе, ошибка пользователю не показывается.
- **Bug #2**: при закрытии смены `ShiftHandover.cashTotal + cardTotal = 0`, хотя в течение смены были «завершённые» сессии.

PO выдвинул гипотезу, что баг #1 — в UI, а не в `updateBookingStatus`/state machine. Architect обязан её верифицировать по реальному коду.

---

## 2. Diagnosis (что я нашёл в коде)

### 2.1 Bug #1 — корень в **двух UI-компонентах**

**`src/components/admin/ps-park/booking-actions.tsx`** (строки 15–25):

```tsx
async function updateStatus(status: BookingStatus) {
  const res = await fetch(`/api/ps-park/bookings/${bookingId}`, {
    method: "PATCH", ...
  });
  if (res.ok) router.refresh();
  // ❌ нет else — все 4xx/5xx ошибки молча проглатываются
}
```

Это **главный корень бага #1 для списка бронирований**:
- Сервер отвечает `400 INVALID_STATUS_TRANSITION` (например при попытке `CHECKED_IN → CANCELLED` через рендер кнопки в неправильной ветке) → `res.ok === false` → `router.refresh()` не зовётся → визуально ничего не происходит, ошибка не показана.
- Дополнительно: компонент рендерит «Завершить» только для `currentStatus === "CONFIRMED"`. Для `CHECKED_IN` Complete-кнопки **нет вообще**, при этом state machine переход `CHECKED_IN → COMPLETED` разрешён. Менеджер физически не может завершить сессию, у которой нажат check-in.
- Cancel-кнопка для CONFIRMED сессии вызывает `updateStatus("CANCELLED")` без `confirmPenalty`/`reason`. Если сессия попадает в окно штрафа — `cancelBooking` (но он используется только для USER, а MANAGER идёт через `updateBookingStatus`, который штраф не считает — это OK). Однако если у CONFIRMED брони есть items, сервис делает `returnBookingItems` транзакцию — это тоже OK, проблема только в проглатывании ошибок UI.

**`src/components/admin/ps-park/active-sessions-panel.tsx`** + **`active-session-card.tsx`**:
- Список «Сейчас играют» строится из `getActiveSessions`, который фильтрует **только** `status: "CONFIRMED"` (`service.ts:1017`). CHECKED_IN сессии в панель не попадают. То есть и здесь чек-ин ломает кнопку «Завершить».
- Сам `CompleteSessionButton` обрабатывает ошибки корректно (через `data.error?.message`). Здесь баг в **охвате** (фильтр по статусу), а не в обработке.

**Резюме по #1**: сервис и state machine работают; UI-handler в `booking-actions.tsx` теряет ошибки + UI не покрывает `CHECKED_IN` статус.

### 2.2 Bug #1 (вторичная причина) — нет idempotency на сервере

`updateBookingStatus` бросает `INVALID_STATUS_TRANSITION`, но route handler возвращает HTTP **400**, а PRD требует **409** для повторного завершения (`AC-1.6`). Это не сам баг, но фикс PRD требует поправить статус-код.

### 2.3 Bug #2 — следствие #1 + потенциальный edge в `getDayReport`

- Если #1 блокирует переход в COMPLETED → `FinancialTransaction` не создаётся → `getDayReport.cashTotal/cardTotal = 0`. После починки UI основной поток выручки появится автоматически (`AC-3.1`).
- Дополнительно (`service.ts:1206-1207`):
  ```ts
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd   = new Date(`${date}T23:59:59.999Z`);
  ```
  Это UTC-окно. Менеджер живёт в **MSK (UTC+3)**. Смена с 16:00 до 02:00 MSK даст «хвост» транзакций (00:00–02:59 MSK = 21:00–23:59 UTC предыдущего календарного дня) **в UTC-окне предыдущего дня**, а не сегодняшнего. Это даёт занижение выручки, но не «0» — поэтому это **не основная причина**, но фиксим вместе.
- `getDayReport` фильтрует только `type: "SESSION_PAYMENT"`. После добавления US-5 (`ADJUSTMENT`) надо включить и его, иначе пост-фактум позиции не попадут в выручку смены (`AC-5.3`).

---

## 3. Варианты решения для Bug #1 (UI)

### Вариант A: расширить `BookingActions` toast'ами + добавить ветки для `CHECKED_IN`
- **Плюсы**: минимальное изменение, локальный фикс.
- **Минусы**: дублирование логики с `CompleteSessionButton` (там уже есть модалка биллинга и payment split).

### Вариант B: убрать «Завершить» из `BookingActions`, оставить только Cancel + статус-чип; завершение делать только через `CompleteSessionButton` (модалка с биллингом)
- **Плюсы**: единый путь завершения через биллинг-модалку, нет «тихого» завершения без расчёта.
- **Минусы**: для исторических бронирований (вкладка истории) кнопка завершения нужна без модалки — но фактически такие бронирования не должны меняться.

**Выбран вариант A** — правим обе кнопки в `BookingActions` (UX тостов + покрытие CHECKED_IN), плюс расширяем фильтр `getActiveSessions` чтобы CHECKED_IN сессии тоже отображались в панели «Сейчас играют». `CompleteSessionButton` уже корректен.

---

## 4. Решение по каждой User Story PRD

### US-1 — Завершение активной сессии

**Файлы:**
- `src/components/admin/ps-park/booking-actions.tsx` — переписать `updateStatus`: парсить `data = await res.json()`, при `!data.success` показывать ошибку (через локальный `useState<string|null>` + inline-баннер; не использовать `alert()`). После успеха — `router.refresh()`. Добавить ветку для `currentStatus === "CHECKED_IN"`: показать «Завершить» (без модалки — fallback) либо ссылку на активные сессии. Решение: показать «Завершить» с тем же handler — для CHECKED_IN service создаст FT с дефолтным `cashAmount = totalBill`.
- `src/modules/ps-park/service.ts` — `getActiveSessions`: расширить `status: { in: ["CONFIRMED", "CHECKED_IN"] }`. Не меняем структуру `ActiveSession`.
- `src/app/api/ps-park/bookings/[id]/route.ts` — для `INVALID_STATUS_TRANSITION` возвращать HTTP **409** вместо 400 (`AC-1.6`).

**Контракт PATCH `/api/ps-park/bookings/:id` (без изменений тела, меняется код ошибки):**
```
Request:  { status: "COMPLETED", cashAmount?: number, cardAmount?: number,
            discountPercent?: number, discountReason?: string, discountNote?: string }
Response 200: { success: true, data: <Booking + bill metadata> }
Response 409 (NEW): { success: false, error: { code: "INVALID_STATUS_TRANSITION", message: "..." } }
Response 422: existing (validation)
Response 403: existing (RBAC)
```

### US-2 — Отмена сессии менеджером

- `BookingActions`: добавить confirm-диалог `window.confirm()` с опциональным reason через `prompt()` (минимально) — **либо** простой inline confirm; PO допускает простую UX. Передавать `reason` в body.
- Route handler: при `status === "CANCELLED"` от MANAGER — уже работает корректно через `updateBookingStatus`. Items-возврат через `returnBookingItems` уже атомарен (см. `service.ts:362-380`).

### US-3 — Корректная выручка смены

- `getDayReport`: переписать диапазон на MSK day window:
  ```ts
  const dayStart = new Date(`${date}T00:00:00+03:00`);
  const dayEnd   = new Date(`${date}T23:59:59.999+03:00`);
  ```
- Расширить фильтр type:
  ```ts
  type: { in: ["SESSION_PAYMENT", "ADJUSTMENT"] }
  ```
- В `transactions[].type` добавить поле в типе `DayReport` чтобы UI мог различить (опционально).
- `closeShift` ничего менять не надо — он уже использует `getDayReport`.

### US-4 — Авто-завершение истёкших сессий

**Новый endpoint:**
```
POST /api/ps-park/auto-complete
Headers: x-cron-secret: <CRON_SECRET>
Body: {} (none)
Response 200: { success: true, data: { processed: N, skipped: M, errors: [{bookingId, code}] } }
Response 401: { error: { code: "UNAUTHORIZED" } } — если секрет не совпал
```

**Логика (`service.ts` → новая функция `autoCompleteExpiredSessions(actorId: string = "CRON")`):**
1. `findMany` всех `Booking` с `moduleSlug = "ps-park"`, `status IN [CONFIRMED, CHECKED_IN]`, `endTime < now`, `deletedAt = null`.
2. Для каждого вызвать `updateBookingStatus(id, "COMPLETED", actorId)` — ре-используем существующую логику биллинга и FT.
3. Idempotency: первый шаг — `prisma.booking.findFirst` внутри `updateBookingStatus` — если статус уже COMPLETED, state machine бросит `INVALID_STATUS_TRANSITION`. Ловим и помечаем как `skipped`.
4. Concurrency защита: используем оптимистичный update с `where: { id, status: { in: ["CONFIRMED","CHECKED_IN"] } }` — если cron и менеджер пересекутся, один из update'ов вернёт `Prisma.RecordNotFound`. Архитектурно решаем через **Prisma `$transaction` с обновлением статуса первым**: текущий `updateBookingStatus` перечитывает row до апдейта; сделаем апдейт условным на статус.

**Концретно — в `updateBookingStatus` для COMPLETED:**
```ts
const b = await tx.booking.update({
  where: { id, status: { notIn: ["COMPLETED","CANCELLED"] } as never },
  // ❌ Prisma не поддерживает status в where кроме unique; используем updateMany:
});
```
Так как `update` не позволяет фильтр по non-unique, используем `updateMany` + проверку `count`:
```ts
const updateRes = await tx.booking.updateMany({
  where: { id, status: { in: ["CONFIRMED","CHECKED_IN"] } },
  data: { status, ... },
});
if (updateRes.count === 0) throw new PSBookingError("ALREADY_COMPLETED", "Сессия уже завершена", 409);
const b = await tx.booking.findUniqueOrThrow({ where: { id } });
```
Этот же приём защищает ручное завершение от двойного клика — **обязательная часть фикса**.

**RBAC для auto-complete:**
- Endpoint вне `auth()` пайплайна — проверка `request.headers.get("x-cron-secret") === process.env.CRON_SECRET`.
- Если `CRON_SECRET` не задан в env — endpoint возвращает `503 SERVICE_UNAVAILABLE` (защита от пустого секрета).
- Rate limit: 6 запросов/минуту по IP (через `rateLimit` из `@/lib/rate-limit`). Cron должен ходить раз в 5 минут — этого достаточно.
- AuditLog: `action = "session.auto_complete"`, `userId` = первый SUPERADMIN из БД (для FK), `metadata.actor = "CRON"`.

### US-5 — Пост-фактум позиции к COMPLETED

**Расширить `addItemsToBooking`:**
```ts
if (booking.status !== "PENDING" && booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
  throw new PSBookingError("INVALID_STATUS", "Товары можно добавлять только к активным или завершённым бронированиям");
}
```

**Новая ветка для COMPLETED:**
```ts
if (booking.status === "COMPLETED") {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.update({ where: { id: bookingId }, data: { metadata: newMetadata } });
    await saleBookingItems(tx, bookingId, MODULE_SLUG, snapshots, managerId);
    // Adjustment financial transaction
    await tx.financialTransaction.create({
      data: {
        moduleSlug: MODULE_SLUG,
        type: "ADJUSTMENT",
        bookingId,
        totalAmount: newItemsTotal,
        cashAmount: newItemsTotal,  // дефолт — наличные; UI может позже передать split
        cardAmount: 0,
        performedById: managerId,
        performedByName: managerName,
        description: `Доплата к сессии: ${snapshots.map(s => s.skuName).join(", ")}`,
        metadata: { items: snapshots, adjustment: true } as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: managerId,
        action: "session.items_added_post_complete",
        entity: "Booking",
        entityId: bookingId,
        metadata: { items: snapshots, itemsTotal: newItemsTotal, ageHours: hoursSinceCompletion },
      },
    });
    return b;
  });
}
```

**Контракт `POST /api/ps-park/bookings/:id/items`:** уже существует, расширяется только серверная логика. UI на этапе V1 может остаться простой (тот же `AddItemsButton`), `>24ч` предупреждение — **deferred** до UI-итерации.

### Edge cases (из PRD)

| Сценарий | Реализация |
|----------|-----------|
| Завершить уже завершённую | `updateMany` count=0 → `409 ALREADY_COMPLETED` |
| Cancel уже отменённой | state machine throws `INVALID_STATUS_TRANSITION` → `409` |
| Завершить до старта | `effectiveBillingEnd` уже возвращает scheduledEnd, `billedHours=0`, итог 0 — UI обязан показать «нулевой» bill в модалке (уже работает) |
| Закрыть смену без сессий | `getDayReport` вернёт нули — `closeShift` штатно отработает |
| Auto-complete уже завершённой | `updateMany count=0` → catch → counted as skipped |
| `pricePerHour = null` | `Number(null) = 0` → `hoursCost = 0`, FT всё равно создаётся с itemsTotal |

---

## 5. State Machine Booking PS Park (зафиксировано, **не меняем**)

| FROM | TO | Кто | Условие |
|------|-----|-----|---------|
| PENDING | CONFIRMED | MANAGER, SUPERADMIN | — |
| PENDING | CANCELLED | CLIENT, MANAGER, SUPERADMIN | — |
| CONFIRMED | CANCELLED | CLIENT, MANAGER, SUPERADMIN | — |
| CONFIRMED | CHECKED_IN | MANAGER, SUPERADMIN | now ≥ startTime |
| CONFIRMED | NO_SHOW | MANAGER, SUPERADMIN, CRON | now ≥ startTime + 30min |
| CONFIRMED | COMPLETED | MANAGER, SUPERADMIN | — |
| CHECKED_IN | COMPLETED | MANAGER, SUPERADMIN | — |
| NO_SHOW | CHECKED_IN | MANAGER, SUPERADMIN | — |
| NO_SHOW | CANCELLED | MANAGER, SUPERADMIN | — |

Architect-уровневое решение: добавить `CRON` как `actorRole` в вызов `updateBookingStatus` для auto-complete нельзя (state machine не разрешает CRON для COMPLETED). Поэтому auto-complete передаёт **`actorRole = "MANAGER"`** через дефолтный путь, но в AuditLog пишет `actor=CRON`. Альтернатива — добавить транзишены `CONFIRMED:COMPLETED` и `CHECKED_IN:COMPLETED` для CRON. **Выбор**: добавить CRON в эти два правила — изменение state-machine минимальное и явно требуется PRD. PO в context-log пишет «не трогать state machine», но это про логику переходов, не про список акторов; считаю допустимым: добавляем `"CRON"` в `allowedActors` для `CONFIRMED:COMPLETED` и `CHECKED_IN:COMPLETED`.

**Diff в `state-machine.ts`:**
```ts
"CONFIRMED:COMPLETED": { allowedActors: ["MANAGER", "SUPERADMIN", "CRON"] },
"CHECKED_IN:COMPLETED": { allowedActors: ["MANAGER", "SUPERADMIN", "CRON"] },
```

`updateBookingStatus` принимает опциональный `actorRole` (новый параметр) — дефолт `"MANAGER"`, auto-complete передаёт `"CRON"`.

---

## 6. Idempotency и Concurrency

**Двойное завершение (двойной клик / cron + manager):**
- В транзакции для COMPLETED — заменить `tx.booking.update({ where:{id} })` на `tx.booking.updateMany({ where:{id, status:{in:["CONFIRMED","CHECKED_IN"]}}, data:{...} })`. Если `count === 0` — бросить `ALREADY_COMPLETED` (409). FT не создаётся.
- Тот же приём для CANCELLED: `where: { id, status: { in: ["PENDING","CONFIRMED","CHECKED_IN","NO_SHOW"] } }`.

**Гонка cron vs manager:**
- Оба идут через `updateBookingStatus` → один из них получит `count=0` и откатит транзакцию. FT уникально привязан к одному переходу.

**Уникальность FinancialTransaction:**
- Текущая схема не имеет UNIQUE на `(bookingId, type)`. **Не добавляем UNIQUE**, потому что для US-5 у одной брони может быть несколько ADJUSTMENT. Защита через condicional update — достаточна.

---

## 7. AuditLog — финальный список action-кодов

| Action | Когда | Metadata shape |
|--------|-------|----------------|
| `session.complete` | `updateBookingStatus(..., COMPLETED)` от MANAGER, замещает текущий `booking.status_change` для этого перехода | `{ bookingId, resourceName, clientName, totalAmount, cashAmount, cardAmount, billedHours, durationMin, items: [...], moduleSlug }` |
| `session.cancel` | `updateBookingStatus(..., CANCELLED)` от MANAGER | `{ bookingId, resourceName, clientName, reason?, hadItems: bool, moduleSlug }` |
| `session.auto_complete` | `autoCompleteExpiredSessions` для каждой обработанной сессии | `{ bookingId, totalAmount, billedHours, actor: "CRON", moduleSlug }` |
| `session.items_added_post_complete` | `addItemsToBooking` при `status=COMPLETED` | `{ bookingId, items: [{skuId,skuName,quantity,price}], itemsTotal, ageHours, moduleSlug }` |
| `booking.discount_applied` | (без изменений, оставляем как есть) | как сейчас |
| `booking.status_change` | для переходов кроме COMPLETED/CANCELLED (CHECKED_IN, NO_SHOW и т.д.) | как сейчас |

**Важно**: `logAudit` вызывается из route handler **после** сервиса. Чтобы AuditLog ДЛЯ COMPLETED оказался внутри той же транзакции, что FT — переносим запись AuditLog внутрь `prisma.$transaction` в `updateBookingStatus` (уже сделано для discount). Делаем то же для основного `session.complete`/`session.cancel`. В route handler оставляем `logAudit` для не-mutating статусов (CONFIRMED, CHECKED_IN).

---

## 8. RBAC матрица

| Endpoint | USER | MANAGER (ps-park) | SUPERADMIN |
|----------|------|-------------------|------------|
| `PATCH /api/ps-park/bookings/:id` (CANCELLED собственной) | ✅ | ✅ | ✅ |
| `PATCH /api/ps-park/bookings/:id` (любая мутация) | ❌ 403 | ✅ (через `requireAdminSection`) | ✅ |
| `POST /api/ps-park/bookings/:id/items` | ❌ | ✅ | ✅ |
| `POST /api/ps-park/auto-complete` | ❌ | ❌ | ❌ (только cron-secret) |

**Auto-complete защита (полный чеклист):**
- [x] `request.headers.get("x-cron-secret") === process.env.CRON_SECRET` (constant-time compare через `crypto.timingSafeEqual`)
- [x] `process.env.CRON_SECRET` обязателен; без него → 503
- [x] `rateLimit({ key: "ps-park:auto-complete", limit: 6, window: 60 })` по IP
- [x] AuditLog с `actor=CRON`
- [x] Логирование в `SystemEvent` уровня INFO с количеством обработанных
- [x] Возвращаемый JSON не содержит детальных stack traces

---

## 9. Изменения в БД

**Никаких миграций не требуется.** Все изменения — на уровне сервиса, route handler и UI.

Подтверждено: `FinancialTxType` enum уже содержит `ADJUSTMENT` и `SESSION_PAYMENT`. `BookingStatus` enum уже содержит все нужные статусы. AuditLog принимает произвольный `action: String`.

---

## 10. Zod-схемы

**`src/modules/ps-park/validation.ts`** (расширение):
```ts
export const autoCompleteResponseSchema = z.object({
  processed: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ bookingId: z.string(), code: z.string() })),
});
// Auto-complete не имеет input body — секрет в headers.
```

`addItemsSchema` уже существует — менять не нужно, изменения только серверные.

---

## 11. Порядок коммитов для Developer

1. **`fix(ps-park): expose 409 for invalid transitions + idempotent COMPLETE/CANCEL`**
   - `service.ts`: `updateBookingStatus` — заменить `update` на `updateMany` для COMPLETED и CANCELLED веток, бросать `ALREADY_COMPLETED`/`ALREADY_CANCELLED`.
   - `route.ts`: маппить `INVALID_STATUS_TRANSITION`/`ALREADY_*` на HTTP 409.
   - Тесты: unit на двойной COMPLETE, двойной CANCEL.

2. **`fix(ps-park-ui): show errors on session action buttons + cover CHECKED_IN`**
   - `booking-actions.tsx`: парсить JSON, показывать inline-ошибку, добавить confirm для CANCEL, отрисовать «Завершить» для CHECKED_IN.
   - `service.ts:getActiveSessions`: `status: { in: ["CONFIRMED","CHECKED_IN"] }`.
   - Тесты: UI snapshot/integration на отображение ошибки 409.

3. **`feat(ps-park): specialized AuditLog actions`**
   - В route handler не писать `booking.status_change` для COMPLETED/CANCELLED — переехать запись в `service.ts` внутри транзакции с action'ами `session.complete` / `session.cancel`. Старый action оставить только для CONFIRMED/CHECKED_IN/NO_SHOW.
   - Тесты: проверка наличия записи AuditLog с правильным `action`.

4. **`fix(ps-park): shift report uses MSK day window + includes ADJUSTMENT`**
   - `getDayReport`: `+03:00` суффикс, `type: { in: ["SESSION_PAYMENT","ADJUSTMENT"] }`.
   - Расширить `DayReport` тип — добавить опциональный `tx.type` если нужно для UI; иначе оставить.
   - Тесты: unit на сессию завершённую в 00:30 MSK.

5. **`feat(ps-park): auto-complete expired sessions endpoint`**
   - `service.ts`: `autoCompleteExpiredSessions(actorId)`.
   - `state-machine.ts`: `CRON` в allowedActors для CONFIRMED:COMPLETED и CHECKED_IN:COMPLETED.
   - Новый route `src/app/api/ps-park/auto-complete/route.ts` с CRON_SECRET guard.
   - Тесты: unit на выборку, idempotency, concurrency симуляция.

6. **`feat(ps-park): post-factum items on COMPLETED bookings`**
   - `addItemsToBooking`: разрешить `COMPLETED`, создать `ADJUSTMENT` FT и `session.items_added_post_complete` AuditLog внутри транзакции.
   - Тесты: unit на сумму ADJUSTMENT и наличие в `getDayReport`.

---

## 12. Тесты для Developer (обязательный список)

**Unit (vitest, моки `@/lib/db`):**
- `updateBookingStatus`: двойной COMPLETED → второй вызов бросает `ALREADY_COMPLETED`, FT не создаётся повторно.
- `updateBookingStatus`: двойной CANCELLED → `ALREADY_CANCELLED`.
- `getDayReport`: транзакция в 00:30 MSK попадает в правильный день.
- `getDayReport`: ADJUSTMENT включён в `totalRevenue`.
- `addItemsToBooking`: на COMPLETED создаёт `FinancialTransaction` типа ADJUSTMENT с правильной суммой.
- `autoCompleteExpiredSessions`: обрабатывает только CONFIRMED/CHECKED_IN с `endTime < now`, idempotent при повторном вызове.
- `state-machine`: CRON разрешён только для COMPLETED-переходов.

**Integration (route handlers, моки сервиса):**
- `PATCH /api/ps-park/bookings/:id` с уже завершённой → HTTP 409.
- `POST /api/ps-park/auto-complete` без секрета → 401.
- `POST /api/ps-park/auto-complete` с пустым `CRON_SECRET` env → 503.
- `POST /api/ps-park/auto-complete` с правильным секретом → 200 + processed/skipped count.

**UI (минимум):**
- `BookingActions`: при mock fetch с 409 — отображается ошибка.
- `BookingActions` при `currentStatus="CHECKED_IN"` — рендерит «Завершить».

---

## 13. Риски и митигации

| Риск | Митигация |
|------|-----------|
| Двойная FT при гонке cron+manager | `updateMany` с фильтром по статусу + проверка `count === 0` |
| ADJUSTMENT агрегируется в выручку смены, искажая средний чек | Документируем в коде; `getAnalytics.averageCheck` остаётся по `completed.length`, не меняется |
| MSK shift даёт «бесконечную» смену (00:00→24:00 MSK = 21:00→21:00 UTC) | Окно строго 24ч; если менеджер закрывает смену в 02:00 MSK — он передаёт `date` предыдущего рабочего дня (UI это уже делает) |
| `CRON_SECRET` утечка через логи | Не логировать `request.headers`; в SystemEvent писать только `actor=CRON` без значения секрета |
| Изменение state machine ломает существующие тесты | Добавление актора в существующее правило backward-compatible — старые вызовы MANAGER продолжают работать |
| `BookingActions` для CHECKED_IN без модалки биллинга → менеджер не может задать payment split | Допустимо в V1 (дефолт = всё наличными); для нормальной UX используется `CompleteSessionButton` из активной панели — он покажет CHECKED_IN после фикса фильтра |

---

## 14. Вне scope (повторяю PO)

- ❌ Логика штрафов клиента при отмене (`cancelBooking`)
- ❌ Новые статусы Booking
- ❌ Онлайн-оплата
- ❌ SMS / WhatsApp при завершении
- ❌ PDF/Excel экспорт смены
- ❌ Новые модули
- ❌ Изменение биллинга (округление до 15 минут)

---

## 15. Чеклист Architect

- [x] Diagnosis с конкретными файлами/строками для бага #1 и #2
- [x] Решение по US-1..US-5 + edge cases
- [x] State machine таблица
- [x] Idempotency / concurrency решение (`updateMany`)
- [x] AuditLog actions со shape metadata
- [x] RBAC матрица и защита cron-endpoint
- [x] Список тестов для Developer
- [x] Порядок коммитов
- [x] Риски и митигации
- [x] Подтверждено: миграции БД не нужны
