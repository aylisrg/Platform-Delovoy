# QA Report: Issue #439 — перенос брони на другую дату/беседку в форме «Изменить бронь»

**Модуль:** gazebos (админка)
**Ветка:** `claude/issue-439-reschedule-date-resource`
**Коммит:** `e6927e8`
**Приоритет:** P1

## Скоуп

Issue #439: сервер (`rescheduleBooking()`, `rescheduleBookingSchema`, PATCH
`/api/gazebos/bookings/[id]`) уже поддерживал смену `resourceId`/`date`, но
`booking-edit-form.tsx` эти поля не показывал — операторы не могли перенести
бронь на другой день/беседку из UI. Проверяемый PR — чисто UI-фикс: добавляет
выбор даты и беседки в форму.

## Предусловия

- Модуль gazebos активен, роль SUPERADMIN/MANAGER(gazebos) для доступа к
  админ-форме редактирования брони.
- Существующая активная бронь (PENDING/CONFIRMED/CHECKED_IN) для теста
  переноса.

---

## AC-1: `rescheduleBookingSchema`/PATCH-ветка принимают `resourceId`/`date` (pre-existing, не менялось в PR)

**Статус: PASS**

`git diff main...HEAD --stat -- 'src/app/api/**' 'src/modules/gazebos/service.ts' 'src/modules/gazebos/validation.ts'` —
**пусто**. Подтверждено: PR не трогает ни один серверный файл, только
`src/components/admin/gazebos/booking-edit-form.tsx` и новый тест-файл к нему
(`git diff main...HEAD --stat`: 2 files changed, 216 insertions(+), 6 deletions(-)).
Это соответствует тезису issue — бэкенд уже поддерживал перенос, не хватало
только UI.

## AC-2: Форма показывает выбор даты и беседки, PATCH-запрос отправляет `resourceId`+`date`

**Статус: PASS**

Прочитан `booking-edit-form.tsx` целиком. Добавлены:
- `dateInput` (state, инициализация `toISODate(booking.startTime)`) → новый
  `<input type="date" id="edit-booking-date">`.
- `resourceId` (state, инициализация `booking.resourceId`) → новый
  `<select id="edit-booking-resource">`, список опций из `GET /api/gazebos`
  (fetch в `useEffect` при монтировании).
- `handleSubmit` теперь всегда включает `resourceId` и `date` в тело PATCH.

Component-тест `отправляет PATCH с новой датой и новой беседкой при сохранении`
меняет оба поля через `fireEvent.change` и проверяет тело запроса
(`toMatchObject({ resourceId: "resource-2", date: "2026-09-05" })`) — PASS
изолированно (см. ниже).

## AC-3: Конфликт-проверка сервера отражается в UI (`BOOKING_CONFLICT`)

**Статус: PASS**

Тест `показывает BOOKING_CONFLICT при переносе на занятый слот другой беседки`
мокает ответ `{success:false, error:{code:"BOOKING_CONFLICT", ...}}` с HTTP
409, проверяет что текст ошибки появляется в UI (`findByText("Это время уже
занято")`) и что `onSaved` **не** вызывается. Реальный источник ошибки —
`rescheduleBooking()` → `BookingError("BOOKING_CONFLICT", ...)` внутри
транзакции с `lockSlot` (service.ts:759-781) — код не менялся, только путь
теперь достижим из UI.

---

## Независимая перепроверка «неизменённые resourceId/date — истинный no-op» (пункт 3 задания)

Прошёл `rescheduleBooking()` (service.ts:626-876) заново, с фокусом на
`timeOrResourceChanged` (строки 712-716):

```ts
const curDate = booking.date.toISOString().split("T")[0];   // UTC-строка даты (booking.date = new Date("YYYY-MM-DD"))
...
const effDate = input.date ?? curDate;
...
const timeOrResourceChanged =
  effResourceId !== booking.resourceId ||
  effDate !== curDate ||
  effStart !== curStart ||
  effEnd !== curEnd;
```

Ключевой вопрос: клиент теперь **всегда** шлёт `date`, вычисленный как
`toISODate(booking.startTime)` (Moscow-TZ парсинг через `Intl.DateTimeFormat`,
`src/lib/format.ts:187-192`). Совпадает ли это со строкой `curDate`, которую
сервер получает из `booking.date` (UTC-полночь)?

Проследил цепочку создания/обновления:
- И при создании (`createBooking`, service.ts:246-248), и при переносе
  (`rescheduleBooking`, service.ts:775/788) `date`-поле в БД всегда
  устанавливается как `new Date(effDate)` — UTC-полночь **той же самой**
  строки `YYYY-MM-DD`, что использовалась для парсинга `startTime`/`endTime`
  через `parseMoscowDateTime(date, time)` (`src/lib/format.ts:141-155`,
  фиксированное смещение +3ч — Россия не переходит на летнее время с 2011).
- Рабочие часы жёстко ограничены 08:00–23:00 MSK (`OPEN_TIME`/`CLOSE_TIME` в
  форме, `getOpenCloseHours()` на сервере) — при +3-часовом фиксированном
  смещении Moscow-календарная дата `startTime` физически не может
  «перескочить» через границу UTC-суток относительно даты, с которой она была
  сконструирована.
- Следовательно `toISODate(booking.startTime)` детерминированно
  восстанавливает ту же строку `YYYY-MM-DD`, что лежит в `booking.date`, и
  `effDate === curDate` для нетронутой даты. Аналогично `resourceId` —
  `useState(booking.resourceId)` — прямая копия поля, без трансформаций.

Вывод: клейм ревьюера подтверждён независимо, прослеживанием кода, а не
только доверием к предыдущему ревью. Для брони, не пересекающей рабочие часы
(что гарантировано валидацией на создании/переносе), unchanged submit —
истинный no-op: `timeOrResourceChanged === false` → пропускаются
`lockSlot`/конфликт-чек (764-781), пересчёт цены (720-729, `pricing = null`),
GCal sync (816: `if (timeOrResourceChanged && ...)`) и
`enqueueNotification("booking.rescheduled")` (853: тот же guard). Аудит-лог
(`logAudit("booking.reschedule", ...)`, строка 799) пишется **всегда**, вне
зависимости от `timeOrResourceChanged` — это pre-existing поведение (не
затронуто PR), и он и раньше писался при правке только времени/контактов, так
что здесь нет новой регрессии, вносимой этим PR.

Component-тест `отправляет неизменённые resourceId/date, если оператор их не
трогал` покрывает это со стороны формы (submit без изменений → PATCH-тело
`{resourceId: "resource-1", date: "2026-09-01"}` — те же значения, что были в
исходном booking) — согласуется с независимым трейсом серверной логики выше.

**Блокирующего сценария по пункту 7 задания (спонтанный GCal-sync/notification
при правке только контактных полей) не найдено.**

---

## Тест-файл `booking-edit-form.test.tsx` — прочитан целиком, прогнан изолированно

```
npx vitest run src/components/admin/gazebos/__tests__/booking-edit-form.test.tsx
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

5 тестов, все запрошенные сценарии покрыты:

| # | Тест | Проверяет |
|---|------|-----------|
| 1 | «подставляет текущую дату и беседку в новые поля формы» | pre-fill: `dateInput.value === "2026-09-01"` (из `startTime` `2026-09-01T10:00:00.000Z`), `select.value === "resource-1"` после загрузки списка |
| 2 | «до загрузки списка беседок селект не пустой — показывает текущую беседку по имени» | loading-state fallback: `fetch` никогда не резолвится, select не пуст (`value === "resource-1"`, опция с именем `resourceName`) |
| 3 | «отправляет PATCH с новой датой и новой беседкой при сохранении» | успешный перенос: смена даты+беседки через `fireEvent.change`, PATCH-тело содержит новые значения, `onSaved` вызван |
| 4 | «показывает BOOKING_CONFLICT при переносе на занятый слот другой беседки» | ошибка конфликта всплывает в UI, `onSaved` НЕ вызван |
| 5 | «отправляет неизменённые resourceId/date, если оператор их не трогал» | no-op submit: PATCH-тело содержит те же resourceId/date, что в исходной брони |

Все 5 сценариев из задания присутствуют и корректны.

---

## Fallback для деактивированного ресурса (пункт 6 задания)

`GET /api/gazebos` (без `?all=true`) вызывает `listResources(true)`
(service.ts:109-117), которая фильтрует `isActive: true` — деактивированная
беседка **не попадёт** в список `resources`.

Логика в компоненте (строки 144-153):
```tsx
{!resources.some((r) => r.id === resourceId) && (
  <option value={resourceId}>{resourceName}</option>
)}
{resources.map((r) => (
  <option key={r.id} value={r.id}>{r.name}</option>
))}
```
Если текущий `resourceId` брони отсутствует в загруженном (активном) списке —
рендерится синтетическая опция с именем `resourceName` (проп, переданный из
родителя — то же имя, что уже показывается в шапке модалки). Select никогда
не остаётся пустым/невалидным, оператор может сохранить без изменений
(fallback-опция выбрана по умолчанию, `resourceId` state не менялся). Это
покрыто тестом #2 (см. таблицу выше) — правда, тест #2 эмулирует
«список ещё не загрузился» (never-resolving fetch), а не «список загрузился,
но текущий ресурс неактивен и отсутствует в нём»; оба случая проходят через
одну и ту же ветку `!resources.some(...)`, так что тест #2 фактически
покрывает и деактивированный-ресурс кейс (тот же код-путь, разные причины
отсутствия в массиве). Не блокирующее замечание — логика верна и покрыта
транзитивно, но отдельный тест с явно deactivated-ресурсом в
`resourcesList`-моке был бы точнее по названию/намерению. Не требую фикса.

---

## Security-кейсы

### RBAC
- Форма используется только внутри `(admin)` UI, защищённого действующим
  middleware/RBAC — не менялось этим PR.

### Data leakage
- `GET /api/gazebos` возвращает только `GazeboResource`
  (`id, name, description, capacity, pricePerHour, isActive, metadata`) —
  проверено типом (`types.ts:6-9`) и хендлером (`route.ts`) — PII отсутствует.
- Роут `/api/gazebos` (root, GET) явно в allowlist `isPublicApiRoute`
  (`src/lib/auth.config.ts:131`) — подтверждено чтением файла напрямую, не
  только со слов прежнего ревью. Согласуется с #527 (позавчерашний security
  фикс тем же QA), где полный список allowlist-путей уже был предметно
  проверен и заблокировал похожую проблему для других роутов gazebos/ps-park.

### Input validation / RBAC на серверной стороне
- Не изменялось PR — вне скоупа этой проверки (уже покрыто ранее для
  `rescheduleBookingSchema`/PATCH-роута).

---

## Регрессия

```
npm test -- --run
 Test Files  234 passed (234)
      Tests  3516 passed (3516)

npx tsc --noEmit
(без вывода — 0 ошибок)

npm run lint
✖ 16 problems (0 errors, 16 warnings)
```

16 warnings — все pre-existing, не в файлах этого PR (`session-bill-modal.tsx`,
`sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`,
`useChatList.ts`, `notifications/service.ts`, `messenger/types.ts`,
`telephony/novofon-client.ts` — ни один не относится к gazebos/booking-edit-form).

---

## Итог по пунктам задания

| # | Пункт | Результат |
|---|-------|-----------|
| 1 | `npm test -- --run` зелёный | PASS — 3516/3516 |
| 2 | `tsc --noEmit` + `lint` без новых ошибок | PASS — 0 ошибок, 16 pre-existing warnings |
| 3 | Независимая проверка no-op через `timeOrResourceChanged` | PASS — прослежено самостоятельно, вывод подтверждён |
| 4 | Тест-файл прочитан + прогнан изолированно, 5 сценариев | PASS — 5/5, все требуемые сценарии присутствуют |
| 5 | `git diff --stat` для API/service/validation пуст | PASS — подтверждено, 0 файлов |
| 6 | Fallback для деактивированного ресурса | PASS (с незначительным замечанием о точности названия теста, не блокирует) |
| 7 | Спонтанный GCal-sync/notification при unchanged edit | PASS — не найдено, `timeOrResourceChanged` гейтит все три side-effect'а идентично |

## Вердикт: PASS
