# QA Report: Checkout Discount System
**RUN_ID:** `2026-04-17-checkout-discount-system`
**Дата:** 2026-04-17
**QA Engineer:** claude-sonnet-4-6

---

## Вердикт: FAIL

**Причины FAIL:**
1. **AC-1.8 FAIL** — ответ API не содержит требуемые поля `discountPercent`, `discountAmount`, `discountReason`, `finalAmount` на верхнем уровне `data`. Данные доступны только через `metadata.discount`.
2. **AC-3.3 FAIL** — UI аудит-лога не отображает суммарный размер скидок в рублях за выбранный период. Показывается только количество записей.
3. **AC-4.4 FAIL** — действие изменения настройки модуля логируется как `module.settings.update`, а не `module.config_updated` (как указано в AC). Это отклонение от спецификации.
4. **Minor UI bug** — `booking-detail-card.tsx` (газебо-тайм лайн): `canComplete` проверяет только `CONFIRMED`, игнорируя `CHECKED_IN`, хотя API и state machine поддерживают CHECKED_IN→COMPLETED.

---

## Тесты

```
npm test -- --run
Test Files  63 passed (63)
Tests  1041 passed (1041)
Duration  1.76s
```

**Результат: PASS** — все 1041 тест зелёный, регрессий нет.

---

## TypeScript Strict

```
npx tsc --noEmit
(no output — clean)
```

**Результат: PASS** — ошибок компиляции нет.

---

## Изменения на ветке (git diff main...HEAD)

19 файлов, +2192 / -56 строк:
- Новые: `src/modules/booking/discount.ts`, `validation.ts`, `types.ts` (дополнен), `__tests__/discount.test.ts`, `__tests__/validation.test.ts`
- Изменены: `src/modules/gazebos/service.ts`, `src/modules/ps-park/service.ts`, оба route handler, 4 UI-компонента
- Docs: ADR, PRD, context

---

## AC Coverage

| AC | Описание | Статус | Примечание |
|----|----------|--------|------------|
| AC-1.1 | Форма чекаута содержит необязательное поле "Скидка (%)", по умолчанию 0 | PASS | booking-actions.tsx и booking-detail-card.tsx, сброс в 0 реализован |
| AC-1.2 | Поле принимает целые числа 1..maxDiscountPercent | PASS | Zod-схема: `.int().min(1).max(100)`, UI clamping на maxDiscountPercent |
| AC-1.3 | При скидке > 0 поле "Причина" обязательно | PASS | discountReason — обязательное поле в схеме (не optional). API отклоняет без причины с ошибкой |
| AC-1.4 | Список причин (5 вариантов + "Другое" с текстом >= 5 символов) | PASS | `DISCOUNT_REASONS` содержит все 5 slugs, `DISCOUNT_REASON_LABELS` — русские названия, refine-валидация для "other" |
| AC-1.5 | Пересчёт итога в реальном времени в UI | PASS | Все три компонента вычисляют discountAmount/finalAmount реактивно через state |
| AC-1.6 | Скидка > maxDiscountPercent → ошибка DISCOUNT_EXCEEDS_LIMIT, HTTP 422 | PASS | Service бросает BookingError, route handler мапит на 422 |
| AC-1.7 | Скидка 0% или отсутствие поля — поведение без изменений | PASS | Route handler не вызывает safeParse если `discountPercent` не задан или = 0; service-ветка COMPLETED сохраняет существующий metadata без discount |
| AC-1.8 | В ответе API: discountPercent, discountAmount, discountReason, finalAmount | **FAIL** | Возвращается raw Booking объект через `apiResponse(updated)`. Discount-поля доступны только внутри `metadata.discount`, не на верхнем уровне |
| AC-2.1 | AuditLog с action="booking.discount_applied", entity="Booking" | PASS | Создаётся внутри prisma.$transaction, code проверен |
| AC-2.2 | AuditLog.metadata содержит полный снимок: managerId, managerName, originalAmount, discountPercent, discountAmount, finalAmount, discountReason, discountNote, bookingId, moduleSlug, resourceName, clientName, appliedAt | PASS | Все поля присутствуют в tx.auditLog.create() в обоих сервисах |
| AC-2.3 | Booking.metadata.discount содержит: percent, amount, reason, note, appliedBy, appliedAt | PASS | Структура BookingDiscount полная, originalAmount и finalAmount — строки (decimal strings) |
| AC-2.4 | FinancialTransaction для PS Park создаётся с totalAmount = finalAmount, metadata содержит originalAmount и discountPercent | PASS | Код подтверждён: completedTotalBill = finalAmount после скидки, billSnapshot дополняется originalAmount/discountPercent/discountAmount/finalAmount |
| AC-2.5 | Для газебо metadata.totalPrice обновляется до finalAmount | PASS | `updatedMetadata.totalPrice = discountData.finalAmount` |
| AC-3.1 | Фильтр по action="booking.discount_applied" в панели аудита | PASS | Audit logs page имеет поле фильтра "action" (свободный текст), поддерживает поиск по любому action |
| AC-3.2 | Каждая запись отображает: имя менеджера, ресурс, клиент, сумма, % скидки, итоговая сумма, дата | PASS | AuditTable отображает userId/userEmail, action, entity, metadata (через details/pre). Все данные в metadata.discount |
| AC-3.3 | Итого по периоду: количество скидок + суммарный размер в рублях | **FAIL** | UI показывает только total count ("N записей"). Суммарный размер скидок в рублях не вычисляется и не отображается |
| AC-4.1 | В настройках модуля поле maxDiscountPercent (1-100, default 30) | PASS | `moduleSettingsSchema` содержит `maxDiscountPercent: z.number().int().min(1).max(100).optional()` в обоих модулях |
| AC-4.2 | Изменение maxDiscountPercent вступает в силу немедленно | PASS | getMaxDiscountPercent() читает из БД при каждом чекауте, кэш не используется |
| AC-4.3 | Если maxDiscountPercent не задан — default 30% | PASS | `DEFAULT_MAX_DISCOUNT_PERCENT = 30`, getMaxDiscountPercent() возвращает его при отсутствии валидного значения |
| AC-4.4 | Изменение настройки логируется в AuditLog с action="module.config_updated" | **FAIL** | Логируется как `"module.settings.update"`, не `"module.config_updated"` как требует AC. Отклонение от спецификации |

**Итого AC:** 17 PASS / 3 FAIL

---

## Edge Cases

| Сценарий | Ожидаемый результат | Фактический результат | Статус |
|----------|--------------------|-----------------------|--------|
| Скидка 0% (discountPercent=0) | Нет скидки, metadata.discount не создаётся | Route не вызывает schema, service не создаёт discountData — корректно | PASS |
| Скидка отсутствует в body | Нет скидки, обратная совместимость | discountInput = undefined, service-ветка COMPLETED работает как раньше | PASS |
| Скидка > maxDiscountPercent | DISCOUNT_EXCEEDS_LIMIT, HTTP 422 | BookingError выбрасывается в service, route handler: `const status = error.code === "DISCOUNT_EXCEEDS_LIMIT" ? 422 : 400` | PASS |
| Причина "other" без note | VALIDATION_ERROR от Zod | checkoutDiscountSchema refine отклоняет, apiError(..., 422) | PASS |
| Причина "other" с note < 5 символов | Ошибка "Минимальная длина пояснения — 5 символов" | Zod: `min(5)` на discountNote, refine также проверяет | PASS |
| discountPercent > 0, без discountReason | Ошибка — причина обязательна | discountReason — обязательное поле (не optional) в схеме, safeParse вернёт false | PASS |
| totalPrice = 0 (бесплатное бронирование) | discountAmount=0, finalAmount=0, корректная запись | `applyDiscount(0, N) = {discountAmount: 0, finalAmount: 0}`, тест есть | PASS |
| CHECKED_IN → COMPLETED с discount (API) | Работает, state machine разрешает | assertValidTransition допускает CHECKED_IN→COMPLETED | PASS |
| CHECKED_IN → COMPLETED с discount (UI, booking-detail-card) | Кнопка видна | `canComplete = booking.status === "CONFIRMED"` — CHECKED_IN не обрабатывается | **FAIL (Minor UI bug)** |

---

## Качество кода

| Критерий | Статус | Примечание |
|----------|--------|------------|
| TypeScript strict, нет `any` | PASS | `any` нет, используются явные касты через `as unknown as Prisma.InputJsonValue` |
| Zod-валидация для всех входных данных | PASS | `checkoutDiscountSchema.safeParse()` в обоих route handlers перед передачей в service |
| apiResponse/apiError используются | PASS | Все ответы через хелперы из `@/lib/api-response` |
| Бизнес-логика в service.ts | PASS | Route handlers только парсят body, вызывают service, возвращают ответ |
| Тесты для бизнес-логики | PASS | `__tests__/discount.test.ts` (8 тестов), `__tests__/validation.test.ts` (13 тестов), `__tests__/service.test.ts` дополнен |
| $transaction для атомарности | PASS | booking.update + auditLog.create в одной транзакции в обоих сервисах |
| managerId из session, не из body | PASS | `session.user.id` передаётся в updateBookingStatus |
| Формула округления | PASS | `Math.round(originalAmount * discountPercent / 100)`, тест "discountAmount + finalAmount === originalAmount" |

---

## Безопасность

| Проверка | Статус | Примечание |
|----------|--------|------------|
| Анонимный запрос → 401 | PASS | `auth()` → `if (!session?.user?.id) return apiUnauthorized()` в обоих handlers |
| USER пытается COMPLETED → 403 | PASS | `hasRole(session.user, "MANAGER")` — USER не имеет роли MANAGER |
| MANAGER без доступа к секции → 403 | PASS | `requireAdminSection(session, "gazebos"/"ps-park")` |
| managerId из session, не из body | PASS | `session.user.id` передаётся явно, body.managerId игнорируется |
| MANAGER модуля A дёргает модуль B | PASS | `requireAdminSection` проверяет конкретный moduleSlug |
| SQL injection через discountNote | PASS | Prisma параметризованные запросы, JSONB storage |
| Ретроактивная правка (COMPLETED → discount) | PASS | state machine assertValidTransition запретит переход из COMPLETED |
| Нет утечки данных в публичных ответах | PASS | Endpoint только для MANAGER/SUPERADMIN |
| Отсутствие stack trace в 500 | PASS | `apiServerError()` возвращает стандартный ответ без деталей ошибки |
| Rate limiting | PASS | Существующие правила (120 req/min для авторизованных) применяются |

**Вывод по безопасности: все обязательные security-кейсы PASS.**

---

## Найденные дефекты

### BUG-1 (Major): AC-1.8 — Ответ API не содержит discount-поля на верхнем уровне

**Файлы:**
- `src/app/api/gazebos/bookings/[id]/route.ts` (строка 92)
- `src/app/api/ps-park/bookings/[id]/route.ts` (строка 96)

**Описание:** Route handlers возвращают `apiResponse(updated)` — сырой объект `Booking` из Prisma. Поля скидки (`discountPercent`, `discountAmount`, `discountReason`, `finalAmount`) присутствуют только в `data.metadata.discount`, а не на верхнем уровне `data`.

**PRD ожидает:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "COMPLETED",
    "originalAmount": 1667,
    "discountPercent": 10,
    "discountAmount": 167,
    "finalAmount": 1500,
    "discountReason": "permanent_client"
  }
}
```

**Фактически:** Эти поля только внутри `data.metadata.discount`.

**Влияние:** Нарушение API-контракта. Клиенты (бот, мобилка) ожидают flat-структуру — получат undefined.

---

### BUG-2 (Minor): AC-3.3 — Нет суммарного размера скидок в рублях в UI

**Файл:** `src/app/admin/architect/logs/page.tsx`

**Описание:** Страница аудита отображает только количество записей ("N записей"). AC-3.3 требует суммарный размер скидок в рублях по фильтрованному периоду.

**Влияние:** Суперадмин не может одним взглядом увидеть общую сумму скидок за период без ручного подсчёта.

---

### BUG-3 (Minor): AC-4.4 — Неверный action в AuditLog при изменении настройки модуля

**Файл:** `src/app/api/gazebos/settings/route.ts` (строка 64), `src/app/api/ps-park/settings/route.ts`

**Описание:** При PATCH /api/gazebos/settings (изменение maxDiscountPercent) AuditLog создаётся с `action: "module.settings.update"`. AC-4.4 требует `action: "module.config_updated"`.

**Влияние:** Фильтрация по `action=module.config_updated` в аудите не найдёт эти записи. Нарушение именования из спецификации.

---

### BUG-4 (Minor): UI — booking-detail-card не показывает форму скидки при статусе CHECKED_IN

**Файл:** `src/components/admin/gazebos/booking-detail-card.tsx` (строка 46)

**Описание:** `const canComplete = booking.status === "CONFIRMED"` — пропущен `CHECKED_IN`. При этом `booking-actions.tsx` корректно обрабатывает оба статуса. State machine и API допускают CHECKED_IN→COMPLETED.

**Шаги для воспроизведения:**
1. Менеджер газебо, бронирование в статусе CHECKED_IN
2. Открыть timeline-попап (booking-detail-card)
3. Кнопка "Завершить со скидкой" недоступна

**Влияние:** Если клиент уже зачекинился, менеджер не может применить скидку через детальную карточку на timeline. Через booking-actions.tsx (список бронирований) скидка доступна.

---

## Итоговая таблица

| Категория | Результат |
|-----------|-----------|
| Тесты (npm test) | 1041/1041 PASS |
| TypeScript strict | PASS (чистый) |
| AC Coverage | 17/20 PASS |
| Edge Cases | 8/9 PASS |
| Качество кода | PASS |
| Безопасность | PASS (все обязательные кейсы) |
| Критических багов | 0 |
| Major багов | 1 (BUG-1: AC-1.8) |
| Minor багов | 3 (BUG-2, BUG-3, BUG-4) |

**Вердикт: FAIL** — BUG-1 (AC-1.8 API-контракт нарушен) и BUG-2 (AC-3.3 не реализован) требуют исправления.
