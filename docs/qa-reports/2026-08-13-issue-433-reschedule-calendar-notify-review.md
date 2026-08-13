# Review: Issue #433 — rescheduleBooking синхронизирует Google Calendar и уведомляет (gazebos)

## Вердикт: NEEDS_CHANGES

Branch: `claude/issue-433-reschedule-calendar-notify` (single commit `0231dd1`, `fix(gazebos): rescheduleBooking синхронизирует Google Calendar и уведомляет`, `Closes #433`), diff vs `main`.

---

## Acceptance Criteria (per issue #433's prescribed fix)

| AC | Статус | Комментарий |
|----|--------|-------------|
| При переносе времени/даты на том же ресурсе — `updateCalendarEvent` патчит существующее событие | PASS (happy path), **см. Blocking ниже для конфликтного пути** | `src/modules/gazebos/service.ts:694-701`. |
| При смене беседки — `deleteCalendarEvent` в календаре старого ресурса + `createCalendarEvent` в новом, `googleEventId` персистится через `tx.booking.update` | PASS (happy path), **см. Blocking ниже для конфликтного пути** | `src/modules/gazebos/service.ts:702-725`, `762`. Отдельный `prisma.resource.findFirst` за старым ресурсом — `703-705`, как и было предположено в брифе задачи. |
| `enqueueNotification({type: "booking.rescheduled", ...})` после успешной транзакции, только если `timeOrResourceChanged` | PASS | `src/modules/gazebos/service.ts:780-800`. Правки без смены времени/ресурса (имя/телефон) уведомление не шлют — подтверждено тестом. |
| `booking.rescheduled` в `EVENT_ROUTING` (`client: true, admin: false`) | PASS | `src/modules/notifications/events.ts:18-20`. |
| Шаблон клиента + шаблон выделенного Telegram-канала gazebos | PASS | `src/modules/notifications/templates.ts:34-35`, `src/modules/notifications/module-channel.ts:82-83`. |
| Тесты на оба вызова (calendar + notification) | PASS (happy path), но **не покрывает конфликтный путь** — см. ниже | `src/modules/gazebos/__tests__/service.test.ts:1243-1389`, 5 новых тестов. |
| Обходной путь в `docs/runbooks/booking-operator-guide.md` убран | PASS | Строка удалена, `git diff` подтверждает ровно одну убранную строку. |
| ps-park не тронут (асимметрия — на PO, отдельно) | PASS | `git diff main...HEAD -- src/modules/ps-park/` — пусто. |

---

## Blocking: порядок операций ломает конфликтный путь reschedule (данные реально теряются)

`src/modules/gazebos/service.ts:689-726` (Google Calendar sync) выполняется **до** авторитетной проверки конфликта внутри `prisma.$transaction` (`lockSlot` + `tx.booking.findFirst` на `733-751`, `throw new BookingError("BOOKING_CONFLICT", ...)` на `749`). Это значит: если перенос упирается в `BOOKING_CONFLICT` (менеджер выбрал занятый слот — рутинный сценарий), календарные side-effects уже успели произойти и не откатываются вместе с транзакцией:

- **Смена только времени на том же ресурсе (694-701):** `updateCalendarEvent` патчит существующее (реальное, валидное) событие на НОВОЕ (отклонённое) время ДО того, как известно, что перенос пройдёт. Транзакция откатывается — бронь остаётся на старом времени в БД, но в Google Calendar событие теперь показывает неверное (не подтверждённое) время. Это воспроизводит форму исходного бага #433 ("календарь не совпадает с реальным слотом"), просто на конфликтном пути вместо happy path.
- **Смена беседки (702-725) — хуже:** `deleteCalendarEvent` безусловно удаляет событие в календаре СТАРОГО ресурса (707) до какой-либо проверки, свободен ли новый слот. Если транзакция потом бросает `BOOKING_CONFLICT`: `tx.booking.update` не выполняется → в БД `booking.googleEventId` остаётся указывать на только что удалённый в GCal ID. Бронь, которая была и остаётся валидной (на старом ресурсе/времени), **полностью теряет представление в календаре** — не патчится на старое время обратно, просто исчезает. Если при этом успел создаться и новый ивент в календаре нового ресурса (`createCalendarEvent`, 717) — это ещё и осиротевший (никому не принадлежащий) ивент в чужом календаре.
  - Дальнейшее восстановление не гарантировано: `booking.googleEventId` в БД продолжает указывать на несуществующий (удалённый) ID. Следующая попытка переноса той же брони вызовет `updateCalendarEvent`/`deleteCalendarEvent` с этим мёртвым ID — Google API вернёт ошибку, `google-calendar.ts` её проглатывает (`catch` → `{success:false}`, не бросает), так что новый `googleEventId` может так и не появиться — состояние "бронь без календаря" может закрепиться надолго без вмешательства человека.

**Комментарий в коде утверждает, что это "тот же паттерн, что в `createAdminBooking`" (`service.ts:689-691`) — это неточно.** В `createAdminBooking` (`394-552`) есть предварительный, намеренно неавторитетный конфликт-чек **перед** обращением к Google Calendar (`428-444`, с явным комментарием: "Нужен, чтобы при очевидном конфликте не ходить в Google Calendar и не плодить осиротевшее событие"), и даже в его собственном худшем случае (race между предварительным и авторитетным чеком) речь идёт только об осиротевшем **новом** событии для ещё не существующей брони — не об удалении события у уже существующей, валидной брони. `updateBookingStatus` (`805-…`), второй упомянутый в комментарии ориентир, вообще не делает конфликт-чеков (переход статуса не пересекается по времени с другими бронями), так что он тоже не подтверждает заявленный паттерн для этого конкретного риска.

**Не покрыто тестами.** Единственный существующий тест на конфликт при reschedule — `"rejects a reschedule that conflicts with another booking"` (`src/modules/gazebos/__tests__/service.test.ts:1219-1230`) — использует `mockBooking({ status: "CONFIRMED", metadata: {} })` **без** `googleEventId`, поэтому ветка `if (timeOrResourceChanged && booking.googleEventId)` в нём вообще не выполняется и баг не проявляется. Ни один из 5 новых тестов в `describe("перенос синхронизирует Google Calendar и уведомляет (#433)")` не комбинирует `googleEventId` с конфликтом.

**Что исправить:** перенести весь блок Google Calendar sync (`689-726`) на позицию **после** успешного коммита `prisma.$transaction` (после строки 766), используя уже вычисленные `start`/`end`/`resource`/`effResourceId` и записывая получившийся `googleEventId` отдельным `prisma.booking.update` (или включив его в тот же transaction только после того, как конфликт-чек внутри неё уже прошёл — т.е. переместить сами вызовы `updateCalendarEvent`/`deleteCalendarEvent`/`createCalendarEvent` внутрь `tx` callback, после `lockSlot`+conflict-check, но до `tx.booking.update`). Второй вариант точнее следует комментарию в `google-calendar.ts:1-7` ("DB is source of truth, Google Calendar is a sync target") и предотвращает саму возможность мутировать календарь для брони, которая не будет перенесена. Добавить тест-регрессию: конфликт при reschedule брони с `googleEventId` не должен вызывать ни `updateCalendarEvent`, ни `deleteCalendarEvent`, ни `createCalendarEvent`.

---

## Scope Check
- Scope creep: **Нет**.
- Файлов изменено: ровно 6 — `src/modules/gazebos/service.ts`, `src/modules/gazebos/__tests__/service.test.ts`, `src/modules/notifications/events.ts`, `src/modules/notifications/templates.ts`, `src/modules/notifications/module-channel.ts`, `docs/runbooks/booking-operator-guide.md`. Совпадает 1:1 с описанием в брифе.
- `src/modules/ps-park/` не тронут — подтверждено (`git diff` пуст). QA-примечание из issue (у ps-park нет функции переноса вообще) корректно не стало поводом расширять скоуп.
- Изменений `package.json`/`package-lock.json` нет.
- Один модуль (`gazebos`) + инфраструктура уведомлений (`notifications`, общий для всех модулей файл — только `gazebos`-секции внутри него тронуты) — далеко не 5+ модулей из правила #5 CLAUDE.md.
- Роут `src/app/api/gazebos/bookings/[id]/route.ts` не изменён — подтверждено чтением; RBAC-обвязка (`hasRole(..., "MANAGER")` + `requireAdminSection(session, "gazebos")`) уже была на месте до фикса.

---

## Качество кода
- TypeScript strict: OK — `npx tsc --noEmit` чист, `any` в диффе не встречается.
- ESLint: OK — `npm run lint` → 0 errors, 15 warnings, все в файлах, не тронутых этим диффом (`ps-park/session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts` — неиспользуемый `getRecipientUserIds`, `novofon-client.ts`). Ни один warning не в изменённых файлах.
- Мутации в `AuditLog`: не изменены — `logAudit(managerId, "booking.reschedule", ...)` вызывается как и раньше, до нового блока уведомлений.
- API-формат ответа не менялся — `rescheduleBooking` по-прежнему возвращает `Booking`, роут оборачивает в `apiResponse`.
- Малозначительное наблюдение (не блокер): `enqueueNotification`'s `data.clientName` (`service.ts:797`) берёт `booking.clientName` — значение ДО обновления. Если менеджер одновременно меняет и время, и имя клиента (`input.clientName`) в одном запросе, уведомление о переносе покажет старое имя. Косметическая мелочь для admin-канала, не влияет на корректность самого переноса.

---

## Безопасность

### RBAC
- OK / без изменений. `PATCH /api/gazebos/bookings/[id]` (без `status` в теле → ветка reschedule) не входит в диф. Проверка `hasRole(session.user, "MANAGER")` → `apiError("FORBIDDEN", ..., 403)` → `requireAdminSection(session, "gazebos")` → только затем `rescheduleBooking(id, parsed.data, session.user.id)` (`src/app/api/gazebos/bookings/[id]/route.ts:61-73`). `managerId` берётся из `session.user.id`, не из body.
- Новый код внутри `rescheduleBooking` не открывает никакого нового пути вызова — функция вызывается из того же единственного, уже защищённого места.

### Secrets leakage
- `git diff main...HEAD | grep -niE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — пусто.
- Новый код не логирует и не возвращает токены/пароли/ID сессий. `googleEventId` — публичный ID события GCal, не секрет (уже хранился в БД и раньше, в других ветках service.ts).

### Injection / XSS
- Только Prisma (`findFirst`, `findUnique`, `update`), параметризовано, raw SQL не добавлено.
- Новый шаблон `booking.rescheduled` в `module-channel.ts:82-83` — `d.resourceName`/`d.clientName` пропущены через `escapeHtml()` (parse_mode=HTML в Telegram), как и остальные шаблоны того же файла. `d.oldDate`/`d.oldStartTime`/`d.oldEndTime`/`d.date`/`d.startTime`/`d.endTime` — серверные форматированные строки (даты/время), не пользовательский ввод, не экранируются — тот же паттерн, что во всех соседних шаблонах этого файла (не новая дыра).
- `templates.ts:34-35` (клиентский шаблон) — plain text, без HTML, экранирование не требуется, соответствует остальным шаблонам того же файла.

### Supply chain
- Новых зависимостей нет.

### Dangerous ops
- `rm -rf`/force-push/деструктивных миграций нет — миграций в диффе нет вовсе.

**Классических security-инцидентов (secrets/RBAC/injection/supply chain) не найдено.** Найденная проблема (Blocking выше) — баг целостности данных (рассинхрон Google Calendar ↔ БД при отклонённом переносе), не security-инцидент в смысле чеклиста `SECURITY.md`, но по правилу reviewer.md "Сомневаешься → NEEDS_CHANGES" и по серьёзности последствий (реальная бронь навсегда теряет календарное представление) — блокирующий для мержа.

---

## Тесты

`npm test -- --run`: **209 test files / 3146 tests passing** (весь прогон, включая изменённые файлы).

### Покрытие по каждому заявленному сценарию
- **Patch того же события** — `"патчит то же событие в календаре при переносе времени на том же ресурсе"`. Явный `+03:00`-офсет в `mockBooking()` учтён корректно: без него `"10:00"` сохранился бы как UTC (Moscow 13:00), и `input.endTime: "15:00"` дал бы 2ч длительности вместо нужных 5ч, упав на `DURATION_BELOW_MIN` (минимум по умолчанию 4ч, `DEFAULT_MIN_BOOKING_HOURS = 4`, `service.ts:51`) — комментарий в тесте объясняет это верно, и тест реально проходит на +03:00-варианте.
- **Перенос между календарями** — `"переносит событие между календарями при смене беседки"`, длительность 5ч (`T10:00:00`→`T15:00:00`, без офсета, но время не переносится в этом тесте — только `resourceId`, поэтому TZ-сдвиг здесь не искажает длительность: `effStart`/`effEnd` вычисляются из `formatTime(booking.startTime/endTime)`, оба на одном и том же base-инстанте, разница сохраняется). `prisma.resource.findFirst` замокан по `id` — покрывает и поиск нового ресурса (594), и `oldResource`-поиск (703).
- **Нет `googleEventId` → календарь не трогается** — корректно проверяет `updateCalendarEvent`/`createCalendarEvent`/`deleteCalendarEvent` не вызваны.
- **`booking.rescheduled` уходит клиенту** — явный `+03:00`, `oldStartTime`/`oldEndTime` совпадают с ожидаемым Moscow-временем (10:00/11:00), `startTime`/`endTime` — новые (10:00/15:00). Корректно проверяет именно то, что заявлено.
- **Правки без смены времени/ресурса не шлют уведомление** — `{ clientName: "Новое имя" }`, `enqueueNotification` не вызван. Длительность брони 5ч (T10:00→T15:00 без офсета) — заведомо выше минимума, не влияет на этот тест, т.к. время не меняется (используется `curStart`/`curEnd`, вычисленные из уже сохранённого booking, не участвуют в проверке `DURATION_BELOW_MIN` относительно нового ввода — но и не могут его нарушить, раз equal).
- **Мокинг корректен**: `prisma.booking.findFirst` — `mockResolvedValueOnce` дважды (load брони → conflict-чек внутри транзакции), `prisma.$transaction`-мок в этом файле (см. `beforeEach`/global setup) резолвит `tx` на тот же `prisma`-мок — паттерн, используемый во всём файле с #429, подтверждён на других тестах того же `describe`.
- **Пробел в покрытии**: как указано в Blocking-разделе выше, ни один тест не комбинирует `googleEventId` (реальный, ранее синхронизированный ивент) с конфликтным путём (`BOOKING_CONFLICT`) — единственный тест на конфликт (`rejects a reschedule that conflicts...`, строка 1219) использует бронь без `googleEventId`, так что новая ветка календарь-синка в нём не выполняется и баг остаётся незамеченным существующим сьютом.

---

## Что хорошо
- Заполняет реальный, ранее полностью пустой пробел: `updateCalendarEvent` действительно был экспортирован, но нигде не вызывался (проверено — единственное использование до этого диффа отсутствовало), и `rescheduleBooking` действительно не делал ни одного `enqueueNotification` до фикса.
- Кросс-ресурсный перенос между разными `googleCalendarId` (delete в старом + create в новом) — правильно распознанная и решённая архитектурная особенность модели (`Resource.googleCalendarId` — per-беседка), не тривиальный patch.
- Notification payload корректно разделяет "новое" (`resource.name`, `effDate/effStart/effEnd`) и "старое" (`curDate/curStart/curEnd`) состояние для шаблона "Было / Стало".
- `admin: false` в `EVENT_ROUTING` для `booking.rescheduled` осмысленно обосновано инлайн-комментарием ("перенос делает сам менеджер") и не противоречит issue (там речь шла только о клиенте/канале, без явного требования на admin-группу).
- Обходной путь из runbook убран той же коммитой, синхронно с фиксом — не оставлен противоречащим коду.
- Явное осознание TZ-ловушки (`formatTime` = Moscow, `mockBooking()` по умолчанию без офсета = UTC) в тестовых комментариях — не случайное совпадение, а осознанная работа с этим нюансом.

## Что исправить (блокирует мерж)
1. **`src/modules/gazebos/service.ts:689-726`** — Google Calendar sync (`updateCalendarEvent`/`deleteCalendarEvent`/`createCalendarEvent`) выполняется до авторитетной проверки конфликта в `prisma.$transaction` (`733-751`). При `BOOKING_CONFLICT` эти операции не откатываются: для смены времени на том же ресурсе — событие пропатчено на неверное (отклонённое) время; для смены беседки — старое (валидное) событие безвозвратно удалено, а `booking.googleEventId` в БД продолжает указывать на удалённый ID (транзакция откатилась, новое значение не записано). Перенести вызовы Google Calendar API внутрь `tx`-callback, после `lockSlot`+conflict-check (строки 734-750), до `tx.booking.update` (753) — либо после успешного коммита транзакции отдельным шагом с последующим `prisma.booking.update({ googleEventId })`.
2. Добавить тест-регрессию: reschedule брони с существующим `googleEventId` на слот, который конфликтует с другой бронью → `BOOKING_CONFLICT`, и ни `updateCalendarEvent`, ни `deleteCalendarEvent`, ни `createCalendarEvent` не вызваны (сейчас единственный конфликтный тест использует бронь без `googleEventId` и не ловит эту ветку).

## Что можно улучшить (non-blocking, не обязательно для этого PR)
1. `enqueueNotification`'s `data.clientName` (`service.ts:797`) берёт значение клиента ДО обновления — при одновременном переносе времени и смене имени в одном запросе уведомление покажет старое имя. Косметика для admin-канала, не блокер.
