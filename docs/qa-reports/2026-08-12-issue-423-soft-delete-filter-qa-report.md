# QA Report: Issue #423 — soft-deleted брони не фильтруются (gazebos)

**Дата проверки:** 2026-08-12
**Ветка:** `claude/issue-423-soft-delete-filter` (2 коммита: `a0f7030`, `62449de`)
**Модуль:** gazebos
**Инспектор:** QA Engineer (Claude)
**Предшествующий этап:** code-reviewer — PASS (2 раунда, второй раунд закрыл конфликт-чек внутри транзакции `rescheduleBooking`)

---

## Вердикт: PASS

Все 6 acceptance criteria из issue подтверждены. Фикс точечный (только `src/modules/gazebos/service.ts` + его тест-файл, +20/-6 строк кода, +205 строк тестов), не затрагивает ничего за пределами заявленного скоупа. `npm test`, `npx tsc --noEmit`, `npm run lint` — зелёные. Регрессионные тесты добавлены на каждую из 13 точек чтения, независимо проверены на корректность мока транзакции (см. ниже).

---

## npm test / tsc / lint (перепрогнано самостоятельно, не доверяя предыдущим прогонам)

```
npm test -- --run src/modules/gazebos
 Test Files  4 passed (4)
      Tests  157 passed (157)

npm test -- --run   (полный набор)
 Test Files  198 passed (198)
      Tests  3014 passed (3014)

npx tsc --noEmit
(без ошибок)

npm run lint
✖ 15 problems (0 errors, 15 warnings)
```

Все 15 lint-warning — pre-existing, не в файлах, затронутых этим PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts`). Ни один errors, ни один warning не в `src/modules/gazebos/**`. Регрессий нет.

---

## Проверка диффа (git diff f2ce14a..62449de -- src/modules/gazebos)

Дифф состоит ровно из 13 добавленных/восстановленных `deletedAt: null` в `where`-условиях `src/modules/gazebos/service.ts` — построчно сверено с перечнем из issue:

| # | Функция | Строка (после фикса) | Подтверждено в коде |
|---|---------|----------------------|----------------------|
| 1 | `listBookings` | 129 | ✅ |
| 2 | `getBooking` | 157 | ✅ |
| 3 | `createBooking` — конфликт-чек в `$transaction` | 263 | ✅ |
| 4 | `createAdminBooking` — предварительный конфликт-чек | 432 | ✅ |
| 5 | `createAdminBooking` — `raced`-чек внутри `$transaction` | 486 | ✅ |
| 6 | `rescheduleBooking` — конфликт-чек целевого слота внутри `$transaction` (найден 2-м раундом ревью) | 691 | ✅ |
| 7 | `updateBookingStatus` | 742 | ✅ |
| 8 | `cancelBooking` | 1073 | ✅ |
| 9 | `checkInBooking` | 1201 | ✅ |
| 10 | `markNoShow` | 1247 | ✅ |
| 11 | `getAvailability` | 1303 | ✅ |
| 12 | `getTimeline` | 1357 | ✅ |
| 13 | `getAnalytics` | 1413 | ✅ |
| 14 | `listBookingsPaginated` | 1531 | ✅ |

(14 строк в таблице — issue перечисляет 13 функций, но `createAdminBooking` содержит 2 независимых конфликт-чека, оба пофикшены отдельно, что верно.)

`rescheduleBooking`'s собственный `findFirst` по `bookingId` (строка 560, поиск самой переносимой брони) — это тот единственный `deletedAt: null`, что существовал ДО фикса; не тронут, продолжает работать.

---

## Верификация acceptance criteria

### AC-1: Soft-deleted бронь не блокирует слот при создании (createBooking, createAdminBooking) — PASS

- `createBooking`: конфликт-чек внутри `$transaction` (после `lockSlot`) содержит `deletedAt: null` (service.ts:263). Тест `"createBooking игнорирует soft-deleted брони в конфликт-чеке"` — PASS.
- `createAdminBooking`: **оба** конфликт-чека — предварительный (вне транзакции, service.ts:432) и авторитетный `raced`-чек внутри `$transaction` под `lockSlot` (service.ts:486) — оба содержат `deletedAt: null`. Тест `"createAdminBooking игнорирует soft-deleted брони в обоих конфликт-чеках"` итерирует ВСЕ вызовы `findFirst` (`calls.length >= 2`) и проверяет `deletedAt: null` в каждом — PASS, тест устроен правильно (не проверяет только первый вызов).

### AC-2: Soft-deleted бронь не блокирует целевой слот при переносе (rescheduleBooking) — PASS

Конфликт-чек внутри `$transaction` (после `lockSlot(tx, ...)`, service.ts:691) содержит `deletedAt: null`. Это именно тот случай, который был пропущен первым раундом ревью и найден вторым — подтверждаю, что он действительно исправлен в финальном коде. Тест `"rescheduleBooking игнорирует soft-deleted брони в конфликт-чеке целевого слота"` мокает **два последовательных** вызова `findFirst` (первый — поиск самой брони, второй — конфликт-чек) и явно ассертит на 2-й вызов (`toHaveBeenNthCalledWith(2, ...)`) — корректно отличает поиск исходной брони от конфликт-чека, не даёт ложного PASS через совпадение с первым вызовом.

Проверил, что мок `$transaction` в тест-файле (`vi.mock("@/lib/db")`, строки 62-77) делегирует `tx.booking.*` на тот же `prisma.booking` mock — то есть ассерты по `prisma.booking.findFirst` действительно ловят вызовы, сделанные через `tx.booking.findFirst` внутри транзакции, а не пропускают их молча. Это устраняет риск false-positive теста, о котором стоило бы беспокоиться отдельно.

### AC-3: Soft-deleted бронь не появляется в listBookings / listBookingsPaginated / getBooking — PASS

Все три подтверждены и в коде (129, 1531, 157), и тестами (`findMany`+`count` для listBookings, `findMany`+`count`+`resource.findMany` для listBookingsPaginated, `findFirst` для getBooking).

### AC-4: Soft-deleted бронь не попадает в getAvailability / getTimeline — PASS

`getAvailability` (service.ts:1303): фильтр применён к `existingBookings`, тест дополнительно проверяет бизнес-эффект, а не только форму where-условия — `result.resources[0].slots.every((s) => s.isAvailable)` при пустом (замоканном) результате `findMany`, т.е. слот, который бы блокировала soft-deleted бронь, теперь свободен. `getTimeline` (service.ts:1357) — фильтр подтверждён тестом.

### AC-5: Soft-deleted бронь не искажает getAnalytics — PASS

`getAnalytics` (service.ts:1413): единственный источник `bookings` для `totalBookings`, `completedBookings`/`completed.filter(...)`, `cancelledBookings`, `totalRevenue`, `byDay`, `byResource`, `topHours` — все вычисляются из одного отфильтрованного массива `bookings`, значит фильтрация одной строки автоматически исключает soft-deleted записи из всех производных метрик разом (нет отдельных незафильтрованных чтений). Тест подтверждает фильтр в `findMany`.

Отдельное наблюдение (не блокер AC-5): `totalReceived` считается через `financialTransaction.aggregate` — это отдельная неизменяемая финансовая проводка, не связанная с `Booking.deletedAt` напрямую; в issue это поле не упоминается как искажаемое soft-delete, и по бизнес-логике это корректно — деньги, реально поступившие в кассу, не должны исчезать из отчёта, даже если сама бронь потом была удалена администратором. Не дефект.

### AC-6: updateBookingStatus/cancelBooking/checkInBooking/markNoShow кидают BOOKING_NOT_FOUND на soft-deleted бронь — PASS

Все 4 функции (service.ts:742, 1073, 1201, 1247) содержат `deletedAt: null` в первичном `findFirst`. Тесты для всех четырёх мокают `findFirst` → `null` и ассертят `rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" })` — соответствует требованию «должны кидать BOOKING_NOT_FOUND, а не оперировать удалённой записью».

---

## Проверка DELETE /api/gazebos/bookings/[id]/route.ts — согласованность с обновлённым getBooking

Прочитан `src/app/api/gazebos/bookings/[id]/route.ts`. `DELETE`-хендлер:
1. Авторизация (`authorizeSuperadminDeletion`, allowAdmin: true).
2. `const booking = await getBooking(id)` — **теперь** фильтрует `deletedAt: null`.
3. Если `!booking` → `apiNotFound("Бронирование не найдено")` (404) **до** записи `deletedAt`.
4. Только затем `prisma.booking.update({ data: { deletedAt: new Date() } })`.

**Проверенный сценарий "повторный DELETE той же брони":**
- 1-й DELETE: `getBooking` находит живую бронь → ставит `deletedAt`. Успех.
- 2-й DELETE той же брони: `getBooking` теперь возвращает `null` (запись уже имеет `deletedAt != null`) → маршрут отвечает `404 Бронирование не найдено`, **не доходя** до `prisma.booking.update`. `deletedAt` не перезаписывается повторно (не тихая идемпотентная запись того же значения, а явный, предсказуемый 404).

Это ровно тот out-of-two-options исход, который требовался проверить («либо 404, либо явная ошибка, но не тихо перезаписывать `deletedAt`») — подтверждаю **404, без побочных эффектов**. Логика `route.ts` не менялась в этом PR (не должна была — она уже полагалась на `getBooking()`, и фикс на уровне сервиса автоматически сделал её корректной). Согласованность подтверждена.

---

## Security / RBAC — функциональные кейсы (QA-надбавка к ревью)

Фикс не меняет модель авторизации (роуты не тронуты), но фильтр `deletedAt: null` сам по себе имеет security-релевантный эффект — устраняет утечку данных удалённой брони:

- **Data leakage — PASS.** До фикса `getBooking(id)` возвращал soft-deleted бронь любому, кто знал/подобрал её `id`, через `GET /api/gazebos/bookings/:id` (публично доступный без авторизации — сам роут это не проверяет). После фикса такой запрос отвечает `404`, бронь (включая `clientPhone`/`clientName`) больше не читаема после «удаления». Это устраняет реальную утечку PII через «удалённые» записи.
- **RBAC — не затронуто фиксом, регрессии не обнаружено.** `DELETE` по-прежнему требует `authorizeSuperadminDeletion` (ADMIN/SUPERADMIN); `PATCH` по-прежнему требует `hasRole(MANAGER)` для смены статуса менеджером и владения (`booking.userId !== userId → FORBIDDEN`) для отмены пользователем — оба пути читают бронь через уже пофикшенные `updateBookingStatus`/`cancelBooking`, т.е. soft-deleted бронь для этих операций теперь корректно недостижима (см. AC-6), что само по себе усиливает RBAC-периметр (нельзя случайно менять статус «удалённой» брони).
- **Rate limiting / input validation** — не в скоупе этого фикса (не менялись), регрессии не обнаружено (роуты не менялись).

---

## Наблюдения вне скоупа issue #423 (не блокируют PASS, для бэклога)

Найдены при whole-file чтении, зафиксированы для трассируемости, **не требуют исправления в этом PR** (issue #423 явно ограничен `src/modules/gazebos/service.ts`; расширение скоупа = отдельная задача по правилу CLAUDE.md «No scope expansion without PO»):

1. `src/app/api/gazebos/health/route.ts:12` — `prisma.booking.count()` для `todayBookings` не фильтрует `deletedAt`, слегка завышает метрику здоровья модуля при наличии удалённых сегодняшних броней. Мониторинговая метрика, не бизнес-логика бронирования, не входит в перечень issue.
2. `src/app/api/webapp/bookings/route.ts` (`GET`/`DELETE`) — читает `prisma.booking` напрямую, в обход сервисного слоя `gazebos/service.ts` целиком (не только `deletedAt`, но и не проверяет `moduleSlug`, обходит `cancelBooking()` — штраф-политика, инвентарь, календарь, `AuditLog`). Это тот же класс бага (нет `deletedAt: null`), но в другом файле и в существенно более широком масштабе (уже описан как отдельная находка №7 в предыдущем QA-аудите `docs/qa-reports/2026-08-10-booking-relaunch-audit.md`). Рекомендую отдельное issue, а не расширение текущего PR.
3. `src/app/api/bot/my-bookings/route.ts`, `src/app/api/bot/cancel-booking/route.ts` — аналогично читают `prisma.booking` напрямую в обход сервиса; та же рекомендация.

---

## Итог

| AC | Вердикт |
|----|---------|
| 1. createBooking/createAdminBooking конфликт-чеки игнорируют soft-deleted | PASS |
| 2. rescheduleBooking конфликт-чек целевого слота игнорирует soft-deleted | PASS |
| 3. listBookings/listBookingsPaginated/getBooking исключают soft-deleted | PASS |
| 4. getAvailability/getTimeline исключают soft-deleted | PASS |
| 5. getAnalytics не искажается soft-deleted | PASS |
| 6. updateBookingStatus/cancelBooking/checkInBooking/markNoShow → BOOKING_NOT_FOUND | PASS |
| DELETE endpoint — повторный вызов предсказуем (404, без побочных эффектов) | PASS |
| npm test / tsc / lint | Зелёные, регрессий нет |
| Security (data leakage через soft-deleted запись) | PASS |

## Вердикт: PASS

Фикс готов к мержу.
