# QA Report: Issue #430 — gazebos `createAdminBooking` CRM attribution fix

## Скоуп

Модуль: `gazebos`. Ветка: `claude/issue-430-admin-booking-crm-attribution`.
Diff vs `main`: `src/modules/gazebos/service.ts`, `src/modules/gazebos/__tests__/service.test.ts`.

Баг: `createAdminBooking` (телефонная бронь беседки от лица админа/менеджера)
писал `Booking.userId: adminId`, никогда не заполнял `Booking.managerId` и не
вызывал `upsertClientByPhone` — карточка гостя в CRM не создавалась, бейдж
"Гость" в истории брони был некорректен, выручка и история визитов
атрибутировались на админа, а не на клиента.

Acceptance bar из issue: "upsert вызван, managerId записан, userId = клиент".
Эталон реализации — `createAdminBooking` в `src/modules/ps-park/service.ts`.

Нет отдельного PRD-файла для #430 (bug-fix issue) — AC взяты из текста issue,
и review-репорт (`docs/qa-reports/*-review.md`) для #430 в репозитории не найден
(проверка не блокирована).

## AC-таблица

| # | Acceptance Criteria | Статус | Свидетельство |
|---|---|---|---|
| AC-1 | `upsertClientByPhone` вызывается с телефоном/именем клиента | PASS | `src/modules/gazebos/service.ts:446-450` — `const { id: clientUserId } = await upsertClientByPhone(clientPhone, { name: clientName, source: "gazebos_booking" });`. Покрыто тестом `"дедуплицирует гостя по телефону через upsertClientByPhone"` (service.test.ts:804-816), который проверяет фактический вызов с правильными аргументами (не просто наличие мока). |
| AC-2 | `Booking.managerId` записывается как id админа | PASS | `service.ts:511`: `managerId: adminId` в `tx.booking.create`. Проверено в тесте `"creates admin booking with CONFIRMED status"` (`expect.objectContaining({ managerId: "admin-1" })`, service.test.ts:794). |
| AC-3 | `Booking.userId` — id клиента, а не админа | PASS | `service.ts:508`: `userId: clientUserId` (было `userId: adminId`). Тот же тест проверяет `userId: "client-1"` (мок `upsertClientByPhone` возвращает `{ id: "client-1" }`). Также поправлен `entityId`/`userId` в `enqueueNotification` (было `userId: adminId`, стало `userId: clientUserId`) — новый тест на строке 880 это проверяет. |

Все три критерия выполнены в реальном коде (не только в комментариях/тестах —
логика вызова находится строго перед `tx.booking.create`, так что
`clientUserId` гарантированно определён до записи брони).

## Регрессионное тестирование

- `npm test -- --run src/modules/gazebos/__tests__/service.test.ts` → **83/83 passed**.
- `npm test -- --run` (полный набор) → **202 test files, 3080 tests, все зелёные**. Побочных регрессий в других модулях от этого изменения нет.
- `npx tsc --noEmit` → **чисто, без ошибок типов**.
- `npm ci --dry-run` → зависимости резолвятся без конфликтов, `vitest` бинарник на месте (тестовый прогон уже подтвердил рабочее окружение).

## Трассировка потока (route → service → clients)

`src/app/api/gazebos/admin-book/route.ts` → `createAdminBooking(session.user.id, parsed.data)`
→ `src/modules/gazebos/service.ts` → `upsertClientByPhone(clientPhone, { name: clientName, source: "gazebos_booking" })`
→ `src/modules/clients/service.ts:951`.

Проверено построчно:
- Порядок аргументов `upsertClientByPhone(rawPhone, { name, source })` совпадает с сигнатурой функции и с вызовом в ps-park (`service.ts:927-930`) — расхождений нет.
- `adminCreateBookingSchema` (`src/modules/gazebos/validation.ts:159-160`) требует `clientPhone`/`clientName` как **обязательные непустые** строки (`z.string().min(1)`), в отличие от опционального варианта в другой Zod-схеме того же файла (используется для другого эндпоинта). Значит `clientPhone` в `createAdminBooking` никогда не `undefined` — ветка ps-park с fallback на "создать User без телефона" (`ps-park/service.ts:932-936`) газебо не нужна и корректно отсутствует.
- `upsertClientByPhone` при невалидном телефоне бросает `ClientError("INVALID_PHONE", ...)` — не `BookingError`. Роут `admin-book/route.ts` ловит только `BookingError` (`instanceof BookingError`), иначе отдаёт `apiServerError()` (500 вместо 400). Это **существующий паттерн, один-в-один унаследованный от эталонного ps-park** (`ps-park/admin-book/route.ts` та же обработка ошибок) — не регрессия этого PR, но отмечаю ниже как пункт для ручной проверки/будущего тикета.
- `AuditLog` (`booking.admin_create`) логирует `clientName`/`clientPhone` как раньше — без изменений, утечки не вносит (эндпоинт MANAGER-only).
- Ответ `apiResponse(booking, ...)` — сырой объект `Booking` без `select`, включает теперь `managerId`. Это MANAGER-only эндпоинт (RBAC-проверка `hasRole(session.user, "MANAGER")` в route.ts до вызова сервиса), так что раскрытие внутреннего `managerId`/`clientPhone` в ответе не является публичной утечкой данных — то же самое поведение уже принято как эталонное в ps-park.
- `saleBookingItems(tx, b.id, MODULE_SLUG, itemSnapshots, adminId)` — списание инвентаря по-прежнему атрибутируется на `adminId` (физически действие совершил менеджер), это осознанно не тронуто и совпадает с ps-park.

Разрывов в цепочке route → service → clients не найдено.

## Проверка регрессий по старой (баговой) семантике `userId`

Grep по `.managerId` (реальные обращения к полю `Booking.managerId`, не локальные
переменные с тем же именем в `telephony`/`notifications`/`checkin`/`overdue-reminders`,
которые не относятся к `Booking.managerId`) — других читателей поля `Booking.managerId`
для gazebos в коде нет. Значит фиче некуда "утечь" в старую семантику.

- `src/components/admin/gazebos/booking-history-table.tsx`: бейдж "Гость" построен
  как `isGuest: !b.userId`. И до, и после фикса `userId` для admin-бронирования —
  непустой (раньше `adminId`, теперь `clientUserId`), так что сам бейдж не менял
  поведения в этом компоненте от данного PR (он и раньше не показывал "Гость" для
  админских броней). Реальная польза фикса тут — что `userId` теперь указывает на
  правильного человека (для клика в карточку клиента/историю), а не искажает бейдж.
- `src/modules/clients/service.ts` (`BOOKING_MODULES = ["gazebos", "ps-park"]`) —
  читает брони клиента по `userId`; это именно тот потребитель, который был
  сломан багом и теперь получает правильные данные. Проверено, что merge-логика
  (`mergeUsers`) тоже переносит `booking.userId` при слиянии дублей — не задета.
- `src/modules/analytics/` — grep на использование `booking.userId`/`managerId` для
  атрибуции выручки ничего не нашёл; аналитика по броням gazebos этот баг не
  использовала напрямую (риска регресса в отчётах не вижу, но и подтверждения,
  что она теперь корректно считает per-manager KPI, тоже нет — вне зоны, где это
  поле уже читается).
- Других мест в `src/modules/gazebos/service.ts`, где создаётся бронь с
  `userId: adminId` (тот же баг-паттерн, не тронутый этим PR), не найдено — grep
  на `userId:\s*adminId` в файле даёт ноль совпадений после фикса.

Явных мест, которые полагались бы на старую (баговую) семантику
`userId === adminId` для админских броней беседок, не обнаружено.

## Security / RBAC (функциональные кейсы)

- Роут `admin-book` уже (без изменений в этом PR) требует `session.user.id` (401
  при анонимном запросе) и `hasRole(session.user, "MANAGER")` (403 для USER).
  Тест на это не входит в diff — но и не должен, RBAC-логика роута не менялась.
- Подмены `userId` через body невозможны — `adminCreateBookingSchema` не содержит
  поля `userId`/`clientUserId`, оно вычисляется сервером через
  `upsertClientByPhone`, лишние поля в body игнорируются Zod-схемой.
- Новых публичных полей/эндпоинтов PR не добавляет — площадь для утечки данных
  не расширилась.

Security-кейсов FAIL не найдено.

## Вердикт: PASS

Все три acceptance criteria (`upsertClientByPhone` вызван, `managerId`
записан, `userId` = клиент) подтверждены в реальном коде и покрыты тестами.
Полный набор тестов зелёный (3080/3080), типы проходят чисто, зависимости
устанавливаются без конфликтов. Регрессий в существующих потребителях
`Booking.userId`/`managerId` для gazebos не найдено.

## Что стоит дополнительно проверить руками в админке после мержа

1. **CRM-карточка гостя**: создать телефонную бронь беседки через
   `/admin/gazebos` (форма ручного бронирования) → зайти в "Гости Барбекю
   Парка" (`clients`) → убедиться, что карточка появилась/обновилась с
   правильным именем/телефоном, а не осталась пустой.
2. **Повторная бронь тем же телефоном** (разный формат: `+7999...` vs
   `8 999...` vs с пробелами) → убедиться, что создаётся ОДНА карточка
   клиента (дедупликация через `normalizePhone`), а не дубликат.
3. **Некорректный телефон** (например, короткая невалидная строка, которая
   проходит Zod `min(1).max(30)`, но не парсится `normalizePhone`) → сейчас
   упадёт в 500 (`INVALID_PHONE` из `ClientError` не перехватывается роутом
   как `BookingError`) вместо ожидаемого 400 с понятным сообщением менеджеру.
   Это не регрессия данного PR (тот же паттерн в ps-park), но стоит завести
   отдельный тикет — плохой UX для менеджера при опечатке в телефоне.
4. **История брони / детальная карточка** (`/admin/gazebos/bookings/[id]`) —
   убедиться, что после фикса отображение клиента и связь с его историей
   визитов/выручкой в клиентской карточке выглядят согласованно (визуальная
   проверка бейджа "Гость" и агрегатов расходов в `clients`).
5. **Списание инвентаря** (`saleBookingItems`) на админской брони с товарами
   — подтвердить, что списание по-прежнему атрибутируется на менеджера
   (`adminId`), это осталось неизменным намеренно.
