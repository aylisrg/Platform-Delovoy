# QA Report: Аудит перезапуска модуля бронирования (gazebos + ps-park)

**Дата проверки:** 2026-08-10
**Ветка:** `claude/delovoy-park-booking-relaunch-ebero8`
**Тип задачи:** верификация списка кандидатов в баги, найденных до формального code review (по коду, без правок)
**Инспектор:** QA Engineer (Claude)

---

## Вердикт: FAIL

Модуль **не готов к перезапуску** в текущем виде. Все 10 P0-кандидатов подтверждены как реальные баги (CONFIRMED), степень серьёзности — от «двойное бронирование занятого стола» до «бот сообщает клиенту об отмене брони, которая по факту не отменена». Отдельно подтверждён функциональный security-кейс: неавторизованный, невалидируемый эндпоинт `session-ending-alert` с HTML-инъекцией в Telegram-сообщение — по правилам `agents/qa.md` это само по себе форсирует FAIL вне зависимости от остального.

`npm test` зелёный (2825/2825), `tsc --noEmit` чистый — регрессий на уровне модульных тестов нет, потому что описанные баги **не покрыты тестами** (это и есть основная причина, почему они дожили до релиза).

---

## npm test / tsc

Окружение изначально не имело `node_modules`; `npm ci` упал с `EUSAGE` (package-lock.json не синхронизирован: `magicast@0.3.5`, `typescript@5.9.3` отсутствуют в лок-файле). Зафиксировано как отдельная находка ниже (не относится к бронированию, но блокирует чистый CI-инсталл). Восстановлено через `npm install` (без изменения `package.json`).

```
 Test Files  193 passed (193)
      Tests  2825 passed (2825)
   Duration  30.39s
```

`npx tsc --noEmit` — 0 ошибок.

**Вывод:** зелёные тесты и чистый tsc не гарантируют качество релиза — ни один из 15 описанных багов не имеет регрессионного теста (нет теста на "listBookings включает soft-deleted", нет теста на "CHECKED_IN исключён из конфликт-чека", нет теста на UI-層 `!res.ok`).

---

## Находка 0 (инфраструктура, вне скоупа бронирования): package-lock.json рассинхронизирован

`npm ci` — обязательный шаг любого чистого деплоя/CI раннера — падает до старта тестов:
```
npm error `npm ci` can only install packages when your package.json and package-lock.json
npm error or npm-shrinkwrap.json are in sync.
npm error Missing: magicast@0.3.5 from lock file
npm error Missing: typescript@5.9.3 from lock file
```
Severity: WARNING (инфраструктурная, не блокирует функциональный вердикт по бронированию, но блокирует холодный CI/деплой прямо сейчас). Рекомендация: `npm install` + коммит обновлённого `package-lock.json` отдельным PR.

---

## Таблица верификации P0-кандидатов

| № | Вердикт | Файл:строки | Severity | Кратко |
|---|---------|--------------|----------|--------|
| 1 | **CONFIRMED** | `src/modules/gazebos/service.ts` — единственное `deletedAt: null` во всём файле: строка 526 (`rescheduleBooking`). Отсутствует в `listBookings` (125-151), `getBooking` (153-157), конфликт-чеке `createBooking` (234-244), конфликт-чеке `createAdminBooking` (416-428), `updateBookingStatus` (698-700), `cancelBooking` (1029-1031), `checkInBooking` (1157-1159), `markNoShow` (1203-1205), `getAvailability` (1257-1264), `getTimeline` (1310-1315), `getAnalytics` (1365-1370). Эталон `src/modules/ps-park/service.ts` — 17 вхождений `deletedAt` (111, 139, 171, 898, 1228, 1268, 1315, 1390, 1453, 1737, 1759, 1838, 1883, 1895, 1904, 1922, 2015). | **Critical (P0)** | Soft-deleted (`DELETE /api/gazebos/bookings/:id`) бронь беседки продолжает блокировать слот навсегда (её видит конфликт-чек `createBooking`/`createAdminBooking`), остаётся доступна по прямому GET `getBooking(id)`, попадает в `listBookings`, аналитику и availability. Удаление в gazebos фактически не работает как soft-delete нигде, кроме reschedule. |
| 2 | **CONFIRMED** | Оба модуля, все конфликт-чеки и `getTimeline`/`getAvailability` фильтруют `status: { in: ["PENDING", "CONFIRMED"] }` без `CHECKED_IN`: gazebos — `createBooking` :238, `createAdminBooking` :420, `rescheduleBooking` :611, `getAvailability` :1261, `getTimeline` :1314; ps-park — `createBooking` :173, `createAdminBooking` :900, `extendBooking` (соседний час) :1456, `getAvailability` :1230, `getTimeline` :1270. | **Critical (P0)** | Бронь в статусе `CHECKED_IN` (гость уже заехал/играет) не учитывается ни как занятость ресурса, ни в таймлайне. Второй клиент/менеджер может забронировать или админ-забронировать тот же стол/беседку на то же время поверх активного гостя — «невидимый двойной слот». Прямое следствие в UI — см. Новую находку №1. |
| 3 | **CONFIRMED** | `src/components/admin/gazebos/booking-detail-card.tsx:73-107` (`updateStatus` L73-85, `handleComplete` L87-107); `src/components/admin/ps-park/booking-detail-card.tsx:44-56` (`updateStatus`). Гейт: `gazebos/service.ts:840-851` / `ps-park/service.ts:519-537` (`PAYMENT_REQUIRED`, если `paidByOperator + onlinePaid < completedTotalBill`). Контраст: `src/components/admin/gazebos/booking-actions.tsx:49-81` правильно собирает `cashAmount`/`cardAmount` через `GazeboBillModal` и обрабатывает `data.success === false`. | **Critical (P0)** | Обе `booking-detail-card.tsx` (открываются кликом по брони в таймлайне/расписании) шлют `PATCH { status: "COMPLETED" }` **без** `cashAmount`/`cardAmount`. Для любой платной брони (`completedTotalBill > 0`) сервис всегда вернёт `422 PAYMENT_REQUIRED`. Обработчики проверяют только `if (res.ok) onStatusChanged()` — при ошибке ничего не показывают пользователю. Кнопка «Завершить» в детальной карточке молча не работает; рабочий путь завершения платной брони есть только через `booking-actions.tsx` + `GazeboBillModal`/аналог PS Park (используется, судя по коду, в других списках/таблицах, не в самой карточке таймлайна). |
| 4 | **CONFIRMED** | `src/modules/gazebos/service.ts:463-489` (`createAdminBooking`, транзакция `$transaction`): `data: { ..., userId: adminId, ... }` — ключа `managerId` нет вовсе, `upsertClientByPhone` не вызывается. Эталон: `src/modules/ps-park/service.ts:910-925` (`upsertClientByPhone` по E.164-телефону) + `:955-989` (`userId: clientUserId, managerId: adminId` в `create`). | **Major (P0)** | Админ-бронь беседки записывает `booking.userId = adminId` (не клиента!) и не создаёт/не дедуплицирует клиента по телефону — в отличие от ps-park, где F4 ADR специально исправлял дублирование гостей по телефону. Для gazebos клиент CRM (`clients`) не привязывается к брони, `managerId` пуст — теряется атрибуция, кто из менеджеров создал бронь (кроме подмены её в `userId`, что и есть баг: `userId` — это ID клиента по контракту API, а не менеджера). |
| 5 | **CONFIRMED** | UI: `src/components/admin/gazebos/booking-history-table.tsx:81,86` шлёт `page`/`perPage` в query. Схемы `bookingFilterSchema` (`src/modules/gazebos/validation.ts:39-45`) и `psBookingFilterSchema` (`src/modules/ps-park/validation.ts:47-53`) не содержат полей `page`/`perPage` — Zod (`z.object`, не `.passthrough()`) молча их отбрасывает. `listBookings` (`gazebos/service.ts:125-151`, `ps-park/service.ts:108-135`) всегда `take: 100`, без `skip`. `listBookingsPaginated` существует в обоих сервисах (`gazebos:1473-1516`, `ps-park:1826+`), но не вызывается ни из одного route-хендлера (только из тестов). | **Major (P0)** | Пагинация в истории броней полностью не работает: клик «Вперёд» повторно запрашивает те же первые ≤100 записей (сортировка `date: "asc"`, детерминированно один и тот же срез). При >100 записях в отфильтрованной выборке остальные данные не видны никаким способом через этот UI, `total` при этом показывает верное большое число — расхождение вводит менеджера в заблуждение. |
| 6 | **CONFIRMED** | `src/app/api/gazebos/bookings/[id]/route.ts:72,106-107` и `src/app/api/ps-park/bookings/[id]/route.ts:55,88-89`: `typeof cashAmount === "number" ? cashAmount : undefined` — без Zod, без `.min(0)`. Гейт: `gazebos/service.ts:840-851`, `ps-park/service.ts:519-537`; запись в леджер: `gazebos/service.ts:895-905`, `21.66 ps-park/service.ts:601-624`. | **Major (P0)** | `paidByOperator = (cashAmount ?? 0) + (cardAmount ?? 0)` не проверяет знак. Пример: `completedTotalBill=1000`, `cashAmount=2000`, `cardAmount=-1000` → `paidByOperator=1000` — проходит гейт, но `resolvedCash=2000`, `resolvedCard=-1000` пишутся в `FinancialTransaction` как есть. Итоговая сумма (`onSiteTotal`) верна, но разбивка касса/безнал искажена — искажает сверку смены (`getDayReport`/`closeShift` суммируют `cashAmount`/`cardAmount` по отдельности), что напрямую бьёт по кассовой дисциплине парка. |
| 7 | **CONFIRMED** | `src/app/api/webapp/bookings/route.ts:55-89`, конкретно `:79-82`: `prisma.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } })` — голый Prisma-вызов. | **Critical (P0)** | `DELETE /api/webapp/bookings` (отмена из Mini App) полностью в обход `cancelBooking()`: нет проверки/штрафа по `CancellationPolicy` (можно отменить бесплатно за 5 минут до начала брони, хотя тот же пользователь через основной сайт/бот получил бы `PENALTY_CONFIRMATION_REQUIRED`), нет возврата инвентаря (`returnBookingItems`), нет удаления Google Calendar события, нет `enqueueNotification`, нет записи в `AuditLog`. Прямое нарушение требования CLAUDE.md «All mutations logged to AuditLog». |
| 8 | **CONFIRMED** | `src/app/api/bot/cancel-booking/route.ts:48-62` вызывает `cancelBooking(bookingId, user.id, "Отменено через Telegram бот")` **без** `confirmPenalty`. Сервис (`gazebos/service.ts:1063-1069` / `ps-park/service.ts:790-796`) при штрафе возвращает `{ penaltyRequired: true, penaltyAmount, basePrice }` (не бросает исключение). Роут делает `return apiResponse(cancelled)` → `NextResponse.json({success:true, data:{penaltyRequired:true,...}}, {status:200})` (default `apiResponse` status = 200, `src/lib/api-response.ts:24-32`). Бот (`bot/handlers/my-bookings.ts:63-73`) проверяет только `data.success` — оно `true` — и показывает пользователю «✅ Бронирование отменено.». | **Critical (P0)** | Полная цепочка подтверждена: если отмена подпадает под штрафную политику (< порога до начала), бот **лжёт** пользователю об успешной отмене (200 OK, зелёная галочка), а бронь в БД остаётся активной. Пользователь не приходит («раз отменил») → система позже фиксирует его как `NO_SHOW`/штраф без предупреждения — прямое нарушение ожиданий и репутационный риск. |
| 9 | **CONFIRMED** | `src/app/api/ps-park/session-ending-alert/route.ts` — нет `auth()`/проверки роли (сравни с соседними route в той же папке, все используют `auth()` + `requireAdminSection`), нет Zod-схемы (`body as {...}` — просто каст типа), `resourceName`/`clientName` интерполируются напрямую в HTML-сообщение Telegram (`parse_mode: "HTML"`, строки 34-35) без экранирования. | **Critical / Security (P0)** | Эндпоинт публично доступен без авторизации → (а) любой может засыпать Telegram-чат админов спамом произвольных «алертов» (rate-limit на этом публичном POST также отсутствует — риск флуда чата уведомлений, вопреки CLAUDE.md «Rate limiting on all public endpoints»); (б) `resourceName`/`clientName` — управляемые клиентом строки (в реальном потоке — из данных брони, но эндпоинт принимает их из тела запроса без всякой сверки с БД), при `parse_mode: HTML` можно внедрить `<a href="...">`/произвольную HTML-разметку в сообщение админ-чата (фишинг/social engineering против администратора парка). По правилам `agents/qa.md` § Security — этого одного пункта достаточно, чтобы форсировать общий вердикт FAIL. |
| 10 | **CONFIRMED** | `prisma/schema.prisma:190-220` (`model Booking`) — только обычные индексы (`@@index([moduleSlug, date])` и т.д.), никакого `EXCLUDE`/уникального ограничения на `(resourceId, date, startTime, endTime)` с фильтром по статусу. Конфликт-чек и `create` — раздельные запросы вне `$transaction`: `gazebos/service.ts` конфликт :234-244 → `create` :268-293 (без транзакции); `createAdminBooking` конфликт :416-428 вне `$transaction` :463 (транзакция открывается только для `create`+инвентаря, а не для чтения конфликта). Аналогично ps-park :168-231. | **Critical (P0)** | Классический TOCTOU race: два конкурентных запроса на один и тот же слот оба проходят `findFirst`-проверку конфликта (обе видят «слот свободен», Postgres READ COMMITTED не блокирует несуществующие строки), затем оба выполняют `create` → двойное бронирование одного стола/беседки на одно время. Ничего на уровне БД это не предотвращает. |

**Итог по P0:** 10 из 10 — CONFIRMED. Ни один P0-кандидат не опровергнут.

---

## Таблица верификации P1-кандидатов

| № | Вердикт | Файл:строки | Severity | Кратко |
|---|---------|--------------|----------|--------|
| 11 | **CONFIRMED** | `src/lib/google-calendar.ts:122` экспортирует `updateCalendarEvent`, но `gazebos/service.ts` импортирует только `createCalendarEvent, deleteCalendarEvent` (строки 4-7) — `updateCalendarEvent` нигде не используется во всём файле (подтверждено grep). `rescheduleBooking` (520-686) не содержит ни одного вызова `enqueueNotification` (все 4 вызова в файле — строки 295, 498, 998, 1130, ни один не внутри `rescheduleBooking`). | **Major (P1)** | При переносе времени/даты/ресурса брони менеджером: (а) Google Calendar событие остаётся со старым временем (гость/менеджер, смотрящий в GCal, увидит неверные данные — `googleEventId` не трогается вообще в `rescheduleBooking`); (б) клиент не получает уведомление о переносе (ни push, ни Telegram) — узнаёт о новом времени, только если менеджер позвонит сам. Отдельно: у ps-park функции `rescheduleBooking` вовсе нет (только `extendBooking` на +1 час) — асимметрия фичи между модулями, вне явного скоупа этого пункта, но стоит зафиксировать для PO. |
| 12 | **CONFIRMED** | `OPEN_HOUR`/`CLOSE_HOUR` захардкожены как `8`/`23` в 4 местах: `src/modules/gazebos/service.ts:45-46`, `src/modules/ps-park/service.ts:55-56`, `src/components/admin/gazebos/timeline-grid.tsx:27-28`, `src/components/admin/ps-park/timeline-grid.tsx:23-24`. `moduleSettingsSchema` (`gazebos/validation.ts:91-107`, `ps-park/validation.ts:95-109`) объявляет `openHour`, `closeHour`, `maxBookingHours` (gazebos), `slotRoundingMinutes`, `sessionAlertMinutes` (ps-park) — все они **читаемы в админ-форме настроек** (`src/app/admin/gazebos/settings/page.tsx:7-12`, `src/app/admin/ps-park/settings/page.tsx:6-12`, дефолты — `src/app/api/gazebos/settings/route.ts:27`, `src/app/api/ps-park/settings/route.ts:27-28`) — но нигде **не читаются** сервисным слоем (grep по `maxBookingHours`/`slotRoundingMinutes`/`sessionAlertMinutes` вне validation/UI/тестов даёт 0 совпадений). Единственная реально применяемая настройка — `minBookingHours` через `getMinBookingHours()`. | **Major (P1)** | Форма настроек в админке лжёт: администратор может открыть `/admin/gazebos/settings`, изменить «Час открытия» на 9 и «Час закрытия» на 22, сохранить (значение реально попадёт в `Module.config`) — но ни бронирование, ни таймлайн, ни доступность слотов не изменятся, потому что весь код продолжает использовать константы `8`/`23`. Аналогично `maxBookingHours` (gazebos) никогда не ограничивает длительность брони сверху, `slotRoundingMinutes`/`sessionAlertMinutes` (ps-park) не используются вообще нигде в коде. |
| 13 | **CONFIRMED** | `prisma/schema.prisma:1950-1955` — `enum SubscriptionTransactionType { CHARGE REFUND MANUAL_TOPUP MANUAL_DEDUCT }`. Grep `SubscriptionTransactionType.REFUND` / `type: "REFUND"` по `src/modules/subscriptions/**` и по всему `src/` — 0 совпадений (единственные совпадения `"REFUND"` — в `src/modules/payments/service.ts:505` и его тесте, это другой, не-subscription REFUND-тип). | **Minor/Major (P1)** | Значение enum `REFUND` определено в схеме (F7, judging by комментарий `// F7 reverse on cancellation`), но никогда не записывается приложением. Если сессия, оплаченная абонементом (`debitFromSession` списывает часы при `COMPLETED`), впоследствии отменяется/возвращается — списанные часы **не возвращаются** на баланс абонемента ни при каком сценарии в коде. Гость теряет часы абонемента без компенсации. |
| 14 | **CONFIRMED** | Порог `30` (минут) захардкожен в 6 вызовах `assertValidTransition({..., noShowThresholdMinutes: 30})`: `gazebos/service.ts:713,1171,1218`, `ps-park/service.ts:260,1020,1068`; плюс `findAutoNoShowCandidates(moduleSlug, 30)` в `src/app/api/cron/no-show/route.ts:28`. Ранее найденная (`2026-04-12` QA-отчёт, BUG-2) константа `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` в `src/modules/booking/types.ts` по-прежнему не используется ни в одном из этих мест — регрессия/незакрытый техдолг с прошлого отчёта. | **Minor (P1)** | Изменить бизнес-правило «через сколько минут после начала брони считать неявку» сейчас можно только правкой кода в 7 местах одновременно (высокий риск рассинхронизации между модулями/cron). Функционально работает одинаково в обоих модулях сейчас, поэтому не блокер для релиза, но фиксируется как долг. |
| 15 | **CONFIRMED** | Кнопок/действий, вызывающих `/api/{module}/bookings/:id/checkin` или `/no-show`, не найдено ни в `booking-actions.tsx`, ни в `booking-detail-card.tsx` (оба модуля) — только текстовые лейблы статусов в таблицах истории (`src/components/admin/ps-park/ps-park-booking-history-table.tsx:18,21,27,30,136` показывает бейджи `CHECKED_IN`/`NO_SHOW`, но не создаёт эти статусы). Роуты `src/app/api/{gazebos,ps-park}/bookings/[id]/checkin/route.ts` и `.../no-show/route.ts` существуют и (судя по сервисным тестам) работают, но недостижимы из UI. | **Major (P1)** | `NO_SHOW` сейчас проставляется только автоматически кроном (`/api/cron/no-show`), а `CHECKED_IN` не проставляется **никак** — ни вручную, ни автоматически. Вся логика check-in (включая позднюю явку `NO_SHOW → CHECKED_IN`, метаданные `checkedInBy`/`lateCheckedInAt`) на данный момент функционально мертва в проде: менеджер физически не может отметить гостя как заехавшего через админку. Это также объясняет, почему баг №2 (CHECKED_IN не учитывается в конфликт-чеках) пока не проявлялся в реальном использовании — статус просто никогда не устанавливается вручную. |

**Итог по P1:** 5 из 5 — CONFIRMED.

---

## Новые находки (не входили в исходный список)

### NEW-1 (Critical, связано с P0-2): CHECKED_IN-брони полностью исчезают из таймлайна/сетки расписания

**Файлы:** `src/components/admin/gazebos/timeline-grid.tsx`, `src/components/admin/ps-park/timeline-grid.tsx` (идентичный паттерн в обоих).

`data.bookings` в обоих гридах приходит из `getTimeline()`, который (см. P0-2) фильтрует `status: { in: ["PENDING", "CONFIRMED"] }`. Функции рендера сетки — `getBookingsForResource` (:102-104 gazebos / :93-95 ps-park), `isSlotFree` (:117-126 / :108-117) — итерируют **тот же** `data.bookings`. Следствие: как только бронь переходит в `CHECKED_IN` (в теории, через API — сейчас недостижимо вручную из-за P1-15, но точно происходит при ручном вызове API/будущем включении кнопки), она **пропадает** с визуальной сетки полностью — слот перестаёт быть выделен занятым, рендерится зелёным/кликабельным как свободный (`isSlotFree` возвращает `true`). Менеджер, глядя на расписание, видит пустой слот там, где физически сидит гость, и кликом создаёт новую бронь поверх него через `GazeboQuickBookingPopover`/`QuickBookingPopover`.

Это не просто повторение P0-2 на уровне API — это конкретный, воспроизводимый UI-баг: **визуально свободный слот, который на самом деле занят активным гостем**, прямо провоцирующий менеджера на двойное бронирование одним кликом.

### NEW-2 (Minor): рассинхронизация клиентского и серверного минимума длительности брони (gazebos)

**Файл:** `src/components/admin/gazebos/quick-booking-popover.tsx:42` — `const MIN_BOOKING_HOURS = 4;` захардкожен в клиентском компоненте, используется для валидации формы (`isValid`, `minEnd`, `defaultEnd`).

Сервер же читает актуальное значение из `Module.config.minBookingHours` через `getMinBookingHours()` (`src/modules/gazebos/service.ts:58-63`), с дефолтом `DEFAULT_MIN_BOOKING_HOURS = 4`. Если администратор поменяет `minBookingHours` в настройках модуля (поле реально работает, в отличие от P1-12) на, например, `2`, попап быстрого бронирования в таймлайне продолжит требовать минимум 4 часа на клиенте (кнопка `disabled`, пока `durationHours < 4`) — то есть корректное значение никогда не долетит до сервера через этот конкретный UI-путь, хотя серверная валидация уже готова его принять. Не блокер (просто более строгий UI, чем нужно), но вводит в заблуждение при попытке администратора использовать свежедобавленную настройку.

### NEW-3 (Major): `booking-history-table` (gazebos) статус-фильтр не предлагает `CHECKED_IN`

**Файл:** `src/components/admin/gazebos/booking-history-table.tsx:144-149` — `<select>` фильтра статуса содержит только `PENDING/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW`, `CHECKED_IN` отсутствует в списке `<option>`, хотя `statusLabel`/`statusVariant` (строки 34-50) знают про `CHECKED_IN` и Zod-схема (`bookingFilterSchema`) его разрешает (в отличие от устаревшего замечания BUG-3 из отчёта `2026-04-12`, которое, похоже, было исправлено на уровне схемы, но не на уровне UI). Менеджер не может отфильтровать историю по «Заехал», даже если бы статус когда-либо проставлялся (см. P1-15). Минорное, но легко фиксируемое несоответствие — 1 строка добавления `<option>`.

---

## Регрессия / покрытие тестами найденных багов

Ни один из 15 P0/P1 багов и 3 новых находок не имеет отдельного failing-теста в текущей тестовой базе (`npm test` зелёный именно потому, что тесты не проверяют эти сценарии: soft-delete фильтрацию, CHECKED_IN в конфликт-чеках, `!res.ok`-обработку в UI, авторизацию `session-ending-alert`, штраф-путь бота). Рекомендуется, чтобы Developer добавил регрессионный тест на каждый P0-пункт в том же PR, где будет фикс (по правилу CLAUDE.md «Tests mandatory, same commit as code»).

---

## Рекомендации по волнам исправления

### Волна P0 (блокирует релиз/перезапуск)
1. Добавить `deletedAt: null` во все чтения `Booking` в `gazebos/service.ts` (пункт 1).
2. Добавить `CHECKED_IN` в статус-списки конфликт-чеков, `getTimeline`, `getAvailability` в обоих модулях (пункт 2) — координировать с волной, включающей пункт 15 (иначе фикс не protected UI-тестами, пока кнопки check-in не подключены).
3. Починить `booking-detail-card.tsx` (оба модуля): добавить обработку `!res.ok`/`data.success===false` с показом ошибки пользователю; либо переиспользовать `GazeboBillModal`-паттерн из `booking-actions.tsx` для завершения платных броней из карточки таймлайна (пункт 3).
4. `createAdminBooking` (gazebos): привести к паттерну ps-park — `upsertClientByPhone` + `managerId: adminId`, `userId: clientUserId` (пункт 4).
5. Подключить `page`/`perPage` в `bookingFilterSchema`/`psBookingFilterSchema` и маршрутизировать `GET /api/{module}/bookings` на `listBookingsPaginated` (пункт 5).
6. Ввести Zod-схему для тела `PATCH /api/{module}/bookings/:id` с `cashAmount`/`cardAmount` `z.number().min(0)` (пункт 6).
7. `DELETE /api/webapp/bookings` — заменить на вызов `cancelBooking()` сервисного слоя (пункт 7).
8. `POST /api/bot/cancel-booking` — обрабатывать `penaltyRequired: true` явно: либо возвращать отдельный код/статус (не «success»), либо запросить подтверждение штрафа в боте перед вызовом (пункт 8).
9. `session-ending-alert` — добавить `auth()`+`requireAdminSection`, Zod-схему, экранирование HTML в интерполируемых полях, rate limit (пункт 9).
10. Обернуть конфликт-чек + `create` в `$transaction` с блокировкой (`SELECT ... FOR UPDATE` либо сериализуемая транзакция), и/или добавить уникальный индекс/exclusion constraint на уровне БД (пункт 10).

### Волна P1 (до релиза желательно, не блокер)
11. `rescheduleBooking` — добавить `updateCalendarEvent` + `enqueueNotification`.
12. Либо реализовать применение `openHour/closeHour/maxBookingHours/slotRoundingMinutes/sessionAlertMinutes`, либо убрать эти поля из формы настроек, пока не реализованы (чтобы UI не лгал администратору).
13. Реализовать `SubscriptionTransactionType.REFUND` в пути отмены/возврата оплаченной абонементом сессии.
14. Вынести `30` в `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` (константа уже существует, использовать её в 7 местах).
15. Добавить кнопки «Заехал»/«Не пришёл» в `booking-actions.tsx`/`booking-detail-card.tsx` обоих модулей, подключить к существующим роутам `checkin`/`no-show`.

### Дополнительно (найдено при аудите)
- NEW-1: чинится автоматически вместе с пунктом 2 (как только `getTimeline` начнёт включать `CHECKED_IN`).
- NEW-2: убрать хардкод `MIN_BOOKING_HOURS = 4` в `quick-booking-popover.tsx`, передавать `minBookingHours` пропом с сервера (уже есть в `getAvailability`/`getTimeline` ответе — `minBookingHours` поле в `AvailabilityResponse`).
- NEW-3: добавить `<option value="CHECKED_IN">Заехал</option>` в фильтр `booking-history-table.tsx`.
- Отдельно (вне бронирования): починить `package-lock.json`, чтобы `npm ci` проходил на чистом окружении/CI.

---

## Итоговая таблица приоритетов

| Приоритет | Кол-во багов | Комментарий |
|-----------|--------------|-------------|
| Critical (P0) | 10/10 CONFIRMED | Блокируют перезапуск: двойное бронирование (2 независимых механизма — CHECKED_IN + race condition), сломанная отмена из Mini App и бота, неавторизованный эндпоинт с HTML-инъекцией, неработающая кнопка завершения платной брони. |
| Major/Minor (P1) | 5/5 CONFIRMED | Функциональный долг: перенос брони не синхронизирует календарь/уведомления, «мёртвые» настройки модуля, отсутствующий UI для check-in/no-show, невозвращаемые часы абонемента. |
| Новые находки | 3 (1 Critical, 1 Major, 1 Minor) | Прямые UI-следствия P0-2 и P1-12/15. |

**Общий вердикт: FAIL.** Модуль требует минимум волну P0 (10 пунктов) до перезапуска в прод; волна P1 — до конца текущего спринта.
