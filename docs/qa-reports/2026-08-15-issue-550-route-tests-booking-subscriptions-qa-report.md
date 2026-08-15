# QA Report: issue #550 — route-тесты book/admin-book/bill/extend + subscriptions/validation

**Ветка:** `claude/issue-550-route-tests-booking-subscriptions` (2 коммита на main: `e361bb42`, `e6f1a6b3`)
**Тип PR:** test-only (test debt cleanup, аудит 2026-08-10), 0 изменений production-кода.

## Скоуп

Issue #550 — тест-долг: отсутствовали route-тесты на `book`/`admin-book`/`bookings/[id]/bill`/`bookings/[id]/extend` для gazebos и ps-park, и на `subscriptions/validation.ts`. PR добавляет 7 новых тестовых файлов, ни одной строки production-кода не тронуто.

Т.к. это чисто тестовый PR без изменения рантайм-поведения, стандартная UI-верификация неприменима — акцент QA сделан на: (1) действительно ли ассерты в тестах соответствуют реальному коду роутов/схем, а не тавтологичны; (2) mutation-check — доказательство, что тесты не проходят вслепую независимо от корректности кода.

## 1. Регрессия / статический анализ

| Проверка | Результат |
|---|---|
| `npm test -- --run` (полный сьют) | **PASS** — 265 test files, 3778 tests, все зелёные |
| `npx tsc --noEmit` | **PASS** — чисто, без ошибок (stale `.next` кэш от #596 не воспроизвёлся) |
| `npx eslint` на все 7 новых файлов | **PASS** — 0 warnings/errors |
| `git diff main...HEAD --stat` | **PASS** — ровно 7 файлов, все под `__tests__/`, 0 изменений production-кода (см. ниже) |

```
src/app/api/gazebos/admin-book/__tests__/route.test.ts
src/app/api/gazebos/book/__tests__/route.test.ts
src/app/api/ps-park/admin-book/__tests__/route.test.ts
src/app/api/ps-park/book/__tests__/route.test.ts
src/app/api/ps-park/bookings/[id]/bill/__tests__/route.test.ts
src/app/api/ps-park/bookings/[id]/extend/__tests__/route.test.ts
src/modules/subscriptions/__tests__/validation.test.ts
```

## 2. Построчная сверка всех 7 файлов с реальным источником

Проверены все 7 файлов (не только обязательный минимум 3) против соответствующих `route.ts`/`validation.ts`:

- **`gazebos/book`** — сверено с `src/app/api/gazebos/book/route.ts` и `createBookingSchema` (`gazebos/validation.ts`). Гостевая ветка (`GUEST_CONTACTS_REQUIRED` при отсутствии `guestName`/`guestPhone`), `BookingError`→400, `InventoryError`→400, refine `startTime<endTime`→422, аудит только для авторизованных (`logAudit`) vs `log.info` для гостей — всё соответствует коду 1:1.
- **`gazebos/admin-book`** — сверено с `route.ts` и `adminCreateBookingSchema`. `hasRole(user, "MANAGER")` из `src/lib/permissions.ts` (иерархия `USER:0 < MANAGER:1 < ADMIN:2 < SUPERADMIN:3`) — тест "суперадмин тоже проходит role-check" корректно проверяет иерархию, а не точное совпадение роли. 401/403/422/400/500 — коды и статусы совпадают.
- **`ps-park/book`** — сверено с `route.ts`/`createPSBookingSchema`. В отличие от gazebos, здесь нет гостевой ветки — `apiUnauthorized()` сразу при отсутствии сессии; тест это подтверждает явно ("требует авторизацию — гостевого бронирования в ps-park нет"). Соответствует.
- **`ps-park/admin-book`** — сверено с `route.ts`/`adminCreatePSBookingSchema`. Важная деталь: в ps-park `clientPhone` — **опционален** (в отличие от gazebos, где `clientPhone` обязателен) — тест корректно убирает из тела только `clientName`, не `clientPhone`, что соответствует реальной схеме.
- **`ps-park/bookings/[id]/bill`** (GET) — сверено с `route.ts`. `hasRole` MANAGER-гейт, `getBookingBill(id)` вызывается с распакованным `params.id`, `PSBookingError`→400 как есть, unexpected→500 `INTERNAL_ERROR`. Соответствует.
- **`ps-park/bookings/[id]/extend`** (POST) — сверено с `route.ts`. `extendBooking(id, session.user.id)` — аргументы в тесте `("bk-1", "mgr-1")` совпадают с порядком в вызове сервиса; `logAudit` с `newEndTime: updated.endTime.toISOString()` проверяется через `expect.objectContaining`. Соответствует.
- **`subscriptions/validation.ts`** — все 5 схем (`createSubscriptionSchema`, `updateSubscriptionSchema`, `adjustHoursSchema`, `cancelSubscriptionSchema`, `listSubscriptionsSchema`) сверены построчно. Отмечено точное соответствие: `multipleOf(0.25)`, `pricePaid >= 0`, refine `validFrom < validTo` (строго меньше, равные даты корректно отклоняются отдельным тестом), `updateSubscriptionSchema.strict()` блокирует протаскивание `totalHours` в обход `adjustHours`, `trim()` в `reason` (тест "  ок  " → 2 символа после trim → отклонено), `z.coerce.number()` в `limit`/`offset` для query-параметров.

Тавтологичных ассертов (только `expect(mock).toHaveBeenCalled()` без проверки реального HTTP-ответа) не обнаружено — каждый тест-кейс проверяет `res.status` и/или `body.error.code`/`body.success`, а не только факт вызова мока.

## 3. Проверка заявленных "уже покрыто, не дублируем"

| Заявление в commit message | Проверено | Результат |
|---|---|---|
| `timeline` (gazebos) уже покрыт (#560) | `src/app/api/gazebos/timeline/__tests__/route.test.ts` существует, реально проверяет role-check regression (комментарий "GET had no role check at all") | **Подтверждено** |
| `timeline` (ps-park) уже покрыт | `src/app/api/ps-park/timeline/__tests__/route.test.ts` существует | **Подтверждено** |
| gazebos `checkInBooking`/`markNoShow` покрыты внутри `service.test.ts` (не отдельным файлом) | Найдено 8+ тест-кейсов на оба метода в `src/modules/gazebos/__tests__/service.test.ts` (строки ~1774–1961): конфликт-чек #478, soft-delete фильтр #423, конфигурируемый порог неявки #440 — реальное, не поверхностное покрытие | **Подтверждено** |
| У gazebos нет `bookings/[id]/bill` / `.../extend` (не в скоупе — нет почасовых сессий) | `find src/app/api/gazebos -type d` — директорий `bill`/`extend` нет; у ps-park — есть (сессии по часам) | **Подтверждено** |
| 9 из 12 cron-роутов не покрыты → вынесены в #617 | Найдено 12 `route.ts` под `src/app/api/cron/*`, из них тесты есть только у 3 (`avito-reviews-sync`, `notifications`, `overdue-session-reminders`) → 9 непокрытых. Issue #617 существует, open, корректно ссылается "продолжение #550" | **Подтверждено, число точное** |

## 4. Mutation-check (замена стандартной UI-проверки для test-only PR)

Три независимые точечные мутации production-кода — тесты запускались точечно (`npx vitest run <file>`), затем код возвращался в исходное состояние (`git status --porcelain` — чисто после каждого отката):

1. **RBAC bypass** — в `gazebos/admin-book/route.ts` закомментирована проверка `hasRole(session.user, "MANAGER")`. Тест `"не пускает обычного пользователя — 403 FORBIDDEN"` упал: `expected 201 to be 403`. Остальные 6 тестов файла прошли.
2. **Неверный статус-код** — в `ps-park/bookings/[id]/bill/route.ts` `apiResponse(bill)` (200) заменён на `apiResponse(bill, undefined, 201)`. Тест `"менеджеру отдаёт чек по завершённой брони"` упал: `expected 201 to be 200`.
3. **Ослабление Zod-схемы** — в `subscriptions/validation.ts` убран `.multipleOf(0.25, ...)` у `totalHours`. Тест `"отклоняет totalHours не кратный 0.25"` упал: `expected true to be false`.

Все три мутации были обнаружены соответствующим тестом, все остальные тесты в затронутых файлах остались зелёными (мутация не давала ложных срабатываний в несвязанных кейсах) — тесты не проходят вслепую, они реально зависят от корректности проверяемого кода. После проверки код восстановлен из бэкапа, `git diff --stat` пуст, `npm test -- --run` повторно зелёный (265/265, 3778/3778).

## 5. Security-чеклист (функциональный, применительно к новым эндпоинтам)

- [x] Анонимный запрос к защищённому endpoint → 401 (ps-park book/admin-book/bill/extend — все тестируют `mockAuth.mockResolvedValue(null)` → 401)
- [x] USER на MANAGER-only endpoint → 403 `FORBIDDEN` (admin-book оба модуля, bill, extend)
- [x] Иерархия ролей (SUPERADMIN проходит MANAGER-гейт) — явно протестировано для gazebos admin-book, косвенно подтверждено чтением `hasRole()` для остальных (одна и та же функция)
- [x] Подмена `userId` в body невозможна — во всех роутах `userId`/`managerId` берутся из `session.user.id`, не из тела запроса; тела запросов в схемах не содержат поля `userId`/`managerId` (кроме `subscriptions.createSubscriptionSchema.userId`, но это админский эндпоинт создания подписки для клиента, не self-service — вне скоупа этого PR)
- [x] Ошибки 500 не содержат stack trace/пути — `apiServerError()` всегда возвращает статичное сообщение "Внутренняя ошибка сервера" и код `INTERNAL_ERROR`, тесты явно проверяют `body.error.code`, а не пробрасывание `error.message` из `new Error("boom")`
- [~] Rate limiting — не применимо к этому PR: тесты вызывают route-хендлеры напрямую в обход middleware-цепочки (стандартная практика unit-тестов роутов в этом репо), rate-limit проверяется отдельно на уровне `src/lib/rate-limit.ts` и не является предметом данного тест-долга

Security-кейсов FAIL не обнаружено.

## 6. Acceptance criteria (из текста issue #550)

| AC | Статус |
|---|---|
| route-тесты на book/admin-book/bookings[id]/bill/extend (gazebos+ps-park), включая HTTP-маппинг 409/422/402 | **PASS** (маппинг в реальности 400/422/500, не 409/402 — коды ошибок в этом проекте используют `apiError(code, message)` с дефолтным статусом 400 для доменных ошибок и 422 для Zod-валидации; 409/402 в issue — неточная формулировка, тесты покрывают фактическое поведение кода корректно) |
| timeline — не дублировать, уже покрыто | **PASS**, проверено независимо (см. п.3) |
| cron-роуты без тестов | **Осознанно вынесено** в отдельный issue #617 (подтверждено существование issue, число 9/12 точное) — не является дефектом этого PR, согласовано в PR description автором |
| `subscriptions/validation.ts` без тестов | **PASS** — все 5 схем покрыты |
| gazebos `checkInBooking`/`markNoShow` без тестов | **PASS** — уже покрыты в `service.test.ts`, корректно не задублировано |

## Итог

- Полный тест-сьют зелёный (3778/3778), `tsc --noEmit` чист, ESLint чист на всех 7 файлах.
- Диф — ровно 7 тестовых файлов, 0 изменений production-кода, подтверждено.
- Все 7 новых файлов построчно сверены с реальным исходным кодом роутов/схем — расхождений в статус-кодах, кодах ошибок или аргументах вызовов сервисов не найдено. Тавтологичных ассертов нет.
- Три независимые mutation-проверки (RBAC bypass, неверный статус-код, ослабленная Zod-схема) доказали, что тесты реально ловят регрессии, а не проходят вслепую.
- Заявления "уже покрыто в другом месте" (timeline ×2, checkIn/noShow, отсутствие bill/extend у gazebos, точное число 9/12 непокрытых cron-роутов) — все независимо подтверждены.
- Security-функциональные кейсы (401/403/RBAC-иерархия/no-userId-spoofing/no-stack-trace-leak) — пройдены.

## Вердикт: PASS
