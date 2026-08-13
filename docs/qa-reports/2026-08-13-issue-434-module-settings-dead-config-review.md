# Review: Issue #434 — openHour/closeHour/maxBookingHours/slotRoundingMinutes/sessionAlertMinutes читаются сервисом

## Вердикт: NEEDS_CHANGES

Branch: `claude/issue-434-module-settings-dead-config` (single commit `6e45c6a`,
`fix(booking): openHour/closeHour/maxBookingHours/slotRoundingMinutes/sessionAlertMinutes читаются сервисом`),
diff vs `main`. Источник правды — полный текст issue #434 (нет отдельного PRD/ADR
для этой задачи — это фикс из автоочереди бэклога).

Выбранный путь — "применить настройки везде" (не "убрать поля из формы"),
это осмысленный и последовательно реализованный выбор для 4 из 5 полей.
Но **одно из пяти полей (`slotRoundingMinutes` в ps-park) осталось с двумя
противоречащими друг другу источниками истины** — именно тот класс бага,
который issue #434 просил устранить — и эта нестыковка при первом сохранении
формы настроек молча меняет биллинг активных сессий ps-park. См. `## Что исправить`.

---

## Acceptance Criteria (по прескрайбленному фиксу issue #434)

| AC | Статус | Комментарий |
|----|--------|-------------|
| gazebos: `openHour`/`closeHour` читаются из `Module.config` во всех местах, где раньше был хардкод `OPEN_HOUR=8/CLOSE_HOUR=23` | PASS | `getOpenCloseHours()` (`src/modules/gazebos/service.ts:83-92`), применена в `rescheduleBooking` (:642-644), `getAvailability` (:1447-1450, 1479), `getTimeline` (:1539), `getAnalytics` (:1616). `grep -n "OPEN_HOUR\|CLOSE_HOUR" src/modules/gazebos/service.ts` — совпадений нет, кроме `DEFAULT_OPEN_HOUR`/`DEFAULT_CLOSE_HOUR` и doc-комментария. |
| gazebos: `maxBookingHours` применяется симметрично `minBookingHours` во всех трёх местах создания/переноса | PASS | `getMaxBookingHours()` (:75-80), проверка `DURATION_ABOVE_MAX` добавлена рядом с `DURATION_BELOW_MIN` в `createBooking` (:263-269), `createAdminBooking` (:461-467), `rescheduleBooking` (:670-676) — все три места, где стоит `DURATION_BELOW_MIN`, покрыты. |
| ps-park: `openHour`/`closeHour` читаются из `Module.config` во всех местах хардкода | PASS | `getOpenCloseHours()` (`src/modules/ps-park/service.ts:60-73`), применена в `getAvailability` (:1326-1329), `getTimeline` (:1397), `extendBooking`/`BEYOND_CLOSING` (:1560, 1567-1571), `getAnalytics` (:1903). `grep` подтверждает отсутствие остаточных `OPEN_HOUR`/`CLOSE_HOUR`. |
| ps-park: округление счёта берётся из `slotRoundingMinutes`, а не хардкода 15 мин | ЧАСТИЧНО (см. `## Что исправить`, п.1) | `billedHours(startTime, endTime, roundingMinutes)` (:1676-1684) принимает параметр; 3 вызывающих места (`updateBookingStatus` COMPLETED :373, `getActiveSessions` :1444-1447, `getBookingBill` :1621) передают `await getSlotRoundingMinutes()`. Сама передача параметра — корректна и симметрична. Но дефолт сервиса (15 мин) расходится с дефолтом `GET /api/ps-park/settings` (30 мин, `src/app/api/ps-park/settings/route.ts:27`) — форма настроек показывает администратору неверное "текущее" значение, и любое сохранение формы (даже несвязанного поля) молча переключает биллинг на 30-минутное округление. |
| ps-park: `sessionAlertMinutes` заменяет хардкод `<= 10` в карточке активной сессии | PASS | `getSessionAlertMinutes()` (:75-80) → `getActiveSessions()` отдаёт `alertMinutes` в каждой сессии (:1440-1443, 1480), тип `ActiveSession` расширен (`types.ts:110-111`); `active-session-card.tsx:75` — `remainingMinutes <= session.alertMinutes` вместо `<= 10`. |
| Единственная работавшая настройка (`minBookingHours` gazebos) не сломана | PASS | `getMinBookingHours()` не тронут по логике, только соседствует с новым `getMaxBookingHours()`; тесты `createBooking`/`createAdminBooking`/`rescheduleBooking` на `DURATION_BELOW_MIN` проходят без изменений в их существующих ассертах. |
| UI-гриды (`timeline-grid.tsx` × 2) больше не хардкодят часы | PASS | Оба файла берут границы из `data.hours[0]`/`data.hours[last]` с fallback `FALLBACK_OPEN_HOUR/CLOSE_HOUR = 8/23` при пустом `hours` (`src/components/admin/gazebos/timeline-grid.tsx:65-70`, `src/components/admin/ps-park/timeline-grid.tsx:55-60`). |
| Runbook больше не документирует нерабочую настройку как обходной путь | PASS | Строка `"Часы работы в «Настройках» не влияют на сетку"` удалена из `docs/runbooks/booking-operator-guide.md`. |
| Тесты: getTimeline/availability уважают настройку | PASS | Новые describe-блоки в обоих `service.test.ts` реально ассертят вычисленные значения (не просто "не падает") — см. `## Тесты`. |

---

## Scope Check
- Scope creep: **Нет.** 10 файлов изменено, все в пределах gazebos + ps-park + их тестов + один runbook — ровно то, что заявлено в описании задачи.
- `src/app/admin/{gazebos,ps-park}/settings/page.tsx` и `src/app/api/{gazebos,ps-park}/settings/route.ts` **не изменены** — подтверждено пустым `git diff` по этим путям. Это соответствует заявлению "UI-форма уже работала правильно, баг был только в чтении" — но именно отсутствие правки `ps-park/settings/route.ts` и стало источником находки п.1 ниже: маршрут не был сверен с новым дефолтом сервиса, хотя фикс прямо требовал "свести к одному источнику истины".
- `package.json`/`package-lock.json` не тронуты — новых зависимостей нет.
- JSON-LD/seed-текст публичных страниц осознанно не в скоупе (follow-up issue #520, подтверждено отсутствием изменений в `src/app/(public)/gazebos/page.tsx` и `scripts/seeds/`) — корректное решение, соответствует явной формулировке задачи.
- ps-park `minBookingHours` осознанно не в скоупе — подтверждено: `grep -n "getMinBookingHours\|minBookingHours" src/modules/ps-park/service.ts` не находит его использования ни до, ни после PR (сервис его нигде не читает). Issue не упоминает это поле явно — корректно оставлено вне скоупа.

---

## Качество кода
- TypeScript strict: OK — `npx tsc --noEmit -p tsconfig.json` без ошибок.
- ESLint: OK — `npx eslint` по всем 9 изменённым `.ts`/`.tsx` файлам чист (0 warnings/errors в затронутых файлах).
- Zod валидация: не изменена (эндпоинты настроек не в диффе) — входные данные бронирования по-прежнему валидируются как раньше.
- API формат: OK — `apiResponse`/`apiError` не тронуты; новые поля (`maxBookingHours`, `openHour`, `closeHour` в `AvailabilityResponse`, `alertMinutes` в `ActiveSession`) — чисто аддитивные расширения типов, не ломают существующих потребителей.
- Мутации в `AuditLog`: не применимо — этот фикс не добавляет новых мутаций, только чтение конфига.
- Паттерн `getOpenCloseHours()`/`getMaxBookingHours()` корректно копирует уже принятый в кодовой базе паттерн `getMinBookingHours()` (Module.config → приведение типа → дефолт) — ноль архитектурных отклонений.
- **Несимметричный HTTP-статус для нового кода ошибки** (см. `## Что исправить`, п.2) — не блокер сам по себе, но указывает, что интеграция нового `BookingError`-кода в существующий route-level маппинг сделана не полностью.

---

## Безопасность

### RBAC
- OK. Ни один эндпоинт настроек (`/api/gazebos/settings`, `/api/ps-park/settings`) не изменён — фикс не про запись/доступ, только про чтение уже защищённого конфига существующими сервис-функциями, вызываемыми из уже RBAC-защищённых роутов (`getAvailability`/`getTimeline`/`createBooking`/`createAdminBooking`/`rescheduleBooking`/`extendBooking`/`getActiveSessions`/`getBookingBill` — ни один из вызывающих роутов не в диффе).
- `userId`/`managerId` не затронуты этим диффом.

### Secrets leakage
- `git diff main...HEAD | grep -niE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — пусто.
- Новые числовые поля (`openHour`, `closeHour`, `maxBookingHours`, `alertMinutes`) не являются PII/секретами, безопасны для публичного `AvailabilityResponse`.

### Injection
- Только Prisma (`prisma.module.findUnique({ where: { slug: MODULE_SLUG } })`), параметризовано, без raw SQL.
- Нет `dangerouslySetInnerHTML`, нет нового пользовательского HTML.

### Supply chain
- Новых зависимостей нет (`package.json`/`package-lock.json` не в диффе).

### Dangerous ops
- Нет `rm -rf`/force-push/деструктивных миграций — миграций в диффе нет вовсе.

**Прямых security-инцидентов (secrets/RBAC/injection) не найдено.** Находка п.1 ниже —
финансовый (billing correctness) риск, не security-инцидент в терминах чеклиста
`agents/SECURITY.md`, но по серьёзности (молчаливое искажение платных начислений)
приравнена к блокирующей.

---

## Тесты

`npm test -- --run` (полный прогон): **214 test files / 3220 tests passing**, включая оба изменённых файла.

### Покрытие по каждому заявленному сценарию
- **gazebos `getAvailability`**: `describe("getAvailability уважает openHour/closeHour/maxBookingHours из настроек (#434)")` (`service.test.ts:801-841`) — три теста: слоты по кастомным `openHour/closeHour` (не 8–23), `maxBookingHours` попадает в ответ, fallback на 8/23 при пустом config. Реальные ассерты на вычисленные значения (`slots).toHaveLength(8)`, `result.openHour).toBe(9)`), а не "не упало".
- **gazebos `getTimeline`**: `describe("getTimeline уважает openHour/closeHour из настроек (#434)")` (:1119-1136).
- **gazebos `rescheduleBooking`**: новый describe у строки 1341+ проверяет и часы работы, и `DURATION_ABOVE_MAX`.
- **gazebos `createBooking`/`createAdminBooking`**: явные тесты на `DURATION_ABOVE_MAX` (:241-253, :902+), симметрично существующим тестам на `DURATION_BELOW_MIN`.
- **ps-park `getActiveSessions`**: `"округляет счёт по настроенному slotRoundingMinutes, а не по хардкоду 15"` (:814-845) — **явно проверяет дефолт**: `withDefault[0].billedHours).toBe(0.75); // дефолт 15 мин: ceil(40/15)=3 → 0.75ч`, затем `withConfigured` с `slotRoundingMinutes: 30` → `1.0`. Формула подтверждена вручную: `Math.ceil(durationMin / roundingMinutes) * (roundingMinutes / 60)` при `roundingMinutes=15` даёт `Math.ceil(durationMin/15) * 0.25` — бит-в-бит то же самое, что было захардкожено (`git show main:src/modules/ps-park/service.ts` подтверждает старую формулу `Math.ceil(durationMin / 15) * 0.25`).
- **ps-park `alertMinutes`**: `"выставляет alertMinutes из настроек модуля в каждую активную сессию"` (:848-897) — дефолт 10 и кастомное 15 оба проверены.
- **ps-park `getAvailability`/`getTimeline`/`extendBooking`**: соответствующие #434-блоки у строк 735, 957, 1269.

### Тест-инфраструктура (`beforeEach`-сброс `prisma.module.findUnique`)
- Подтверждено чтением: в обоих файлах есть top-level `beforeEach(() => { vi.clearAllMocks(); vi.mocked(prisma.module.findUnique).mockResolvedValue({...}) })` (`gazebos/service.test.ts:142-151`, аналогично в `ps-park/service.test.ts:124-141`) — корректно объясняет, зачем нужен (комментарий прямо указывает на утечку `mockResolvedValue` через `clearAllMocks()`).
- Полный прогон (`npm test -- --run`) зелёный **целиком**, 214/214 файлов — если бы `beforeEach`-сброс сломал какой-то существующий тест, полагавшийся на "грязный" конфиг от предыдущего `it()`, это проявилось бы как красный тест в этом же прогоне. Такого не найдено.

---

## Что хорошо
- Паттерн `getMinBookingHours()` → `getMaxBookingHours()`/`getOpenCloseHours()` скопирован без отклонений, включая обработку `typeof val === "number"` guard против мусора в JSON-конфиге.
- `DURATION_ABOVE_MAX` симметрично добавлен во все три места, где применяется `DURATION_BELOW_MIN` (`createBooking`, `createAdminBooking`, `rescheduleBooking`) — ничего не пропущено.
- `billedHours()`-рефакторинг математически доказуемо сохраняет старое поведение при дефолте — не просто заявлено, а покрыто отдельным тестом с явным комментарием формулы.
- UI-гриды берут границы из уже посчитанных бэкендом `data.hours`, а не дублируют логику чтения конфига на клиенте — простое и правильное решение, отсутствие второго источника правды на фронте.
- gazebos-дефолты (`8/23/4/8`) сверены и совпадают байт-в-байт с дефолтами `GET /api/gazebos/settings` — именно так, как должна выглядеть работа над "единым источником истины" (в отличие от ps-park, см. ниже).
- Docs (`runbook`) синхронно обновлены в том же коммите — не оставлен противоречащий код документации.
- Тесты не generic-заглушки: явно проверяют вычисленные значения (часы, суммы, alertMinutes), различая дефолт vs кастомный конфиг — реально ловят регресс, если кто-то по ошибке вернёт хардкод.

## Что исправить (блокирует PASS)

1. **`slotRoundingMinutes`: дефолт сервиса (15) расходится с дефолтом настроек (30) — билинг ps-park молча изменится при первом сохранении формы.**
   `src/modules/ps-park/service.ts:58` — `DEFAULT_SLOT_ROUNDING_MINUTES = 15` (сознательно выбран, чтобы не менять текущие счета — корректное решение само по себе).
   `src/app/api/ps-park/settings/route.ts:27` — `defaults.slotRoundingMinutes = 30` (не тронут этим PR).
   Механизм поломки: `GET /api/ps-park/settings` мёржит `{...defaults, ...config}` — если `Module.config.ps-park` не содержит ключ `slotRoundingMinutes` (подтверждено: ни один seed его не устанавливает, `grep -rn slotRoundingMinutes scripts/` — пусто), форма настроек (`src/app/admin/ps-park/settings/page.tsx` → `ModuleSettings`, `src/components/admin/shared/module-settings.tsx:35`) загружает и держит в state `30`. `handleSave()` (`module-settings.tsx:43-52`) отправляет **весь** объект `config` через `PATCH`, включая это невидимо-подставленное `30`. `PATCH`-хендлер (`route.ts:63`) делает `newConfig = {...currentConfig, ...parsed.data}` — `slotRoundingMinutes: 30` персистится в `Module.config` при **любом** сохранении формы, даже если админ менял только `openHour` или Telegram-канал. С этого момента `getSlotRoundingMinutes()` в сервисе перестаёт возвращать дефолт `15` и начинает возвращать сохранённые `30` — округление счёта активных PS Park-сессий скачком меняется с 15-минутных на 30-минутных интервалов, без единого явного действия админа, направленного именно на это поле.
   Это — тот самый класс бага, который просит устранить issue #434 ("противоречивых источника истины"), только для нового поля. Нужно **выбрать одно значение и синхронизировать оба места**: либо поднять `DEFAULT_SLOT_ROUNDING_MINUTES` в сервисе до `30` (но тогда это меняет текущие счета всех активных сессий сразу при мерже PR — нужно явное решение владельца/PO, соответствует ли это намерению исходного ADR `2026-04-14-admin-bbq-playpark-management-adr.md:333`, где `slotRoundingMinutes` документирован как "default 30"), либо поправить `defaults.slotRoundingMinutes` в `route.ts` на `15`, чтобы форма настроек не лгала о текущем поведении и не могла его случайно изменить чужим сохранением. Второй вариант безопаснее и совпадает с духом фикса (сохранить текущее поведение прод-инстансов).

## Что исправить (non-blocking, но стоит поправить в этом же PR)

2. **`DURATION_ABOVE_MAX` не зарегистрирован в `unprocessableCodes` набора HTTP-статусов `PATCH /api/gazebos/bookings/[id]`.**
   `src/app/api/gazebos/bookings/[id]/route.ts:170-177` — `unprocessableCodes` содержит `"DURATION_BELOW_MIN"`, но не `"DURATION_ABOVE_MAX"`, хотя оба кода теперь бросаются из одного и того же `rescheduleBooking()` по симметричным причинам и оба долетают до этого catch-блока (вызов на строке 72). В результате `DURATION_BELOW_MIN` при переносе брони отдаётся с `422`, а новый `DURATION_ABOVE_MAX` — с дефолтным `400`. Функционально не ломает (frontend читает `json.error.message`, не статус-код — проверено `booking-detail-card.test.tsx`), но нарушает уже установленную в этом же файле конвенцию для пары "длительность вне диапазона". Добавить `"DURATION_ABOVE_MAX"` в `unprocessableCodes` (строка 175, рядом с `DURATION_BELOW_MIN`).

3. (Информационно, не для этого PR) Предсуществующий пробел вне диффа: `moduleSettingsSchema` для обоих модулей (`src/modules/gazebos/validation.ts:93-97`, `src/modules/ps-park/validation.ts:98-99`) не имеет cross-field `.refine()` на `openHour < closeHour` / `minBookingHours <= maxBookingHours` — при некорректном ручном вводе (`openHour=20, closeHour=10`) `getTimeline`/`getAvailability` тихо деградируют до пустой сетки (`Array.from({length: -N})` клампится к `[]`, не крашится), а не возвращают понятную ошибку. Не введено этим PR, не блокирует, но логичный follow-up в духе того же issue.

---

## Итог

Основной риск — п.1: он материален (реальные деньги, реальный админ-флоу — «сохранить настройки» не требует специально трогать это поле), напрямую противоречит собственной цели фикса ("свести к одному источнику истины") и собственному явному критерию проверки разработчика (item 4 из брифа: "бит-в-бит те же числа"), которое разработчик проверил на уровне сервиса, но не сверил с соседним, не тронутым им файлом. Нужно исправить п.1 (и желательно п.2) и повторно прогнать `npm test` перед мержем.

---

## Второй круг (коммит 26858b5)

## Вердикт: PASS

Diff `6e45c6a..26858b5`: 2 кодовых файла (`src/app/api/ps-park/settings/route.ts`,
`src/app/api/gazebos/bookings/[id]/route.ts`) + добавление отчёта первого круга
в этот же коммит. Проверено заново, не доверяя формулировкам коммит-месседжа.

### 1. Блокирующая находка — устранена полностью

`src/app/api/ps-park/settings/route.ts:31` — `defaults.slotRoundingMinutes` теперь
`15`, с комментарием, явно требующим совпадать с `DEFAULT_SLOT_ROUNDING_MINUTES` в
`src/modules/ps-park/service.ts:60`. Сверил оба значения построчно — совпадают.

Выбран именно тот вариант, который первый круг рекомендовал как более безопасный
("поправить `route.ts`", а не поднимать дефолт сервиса до 30) — не меняет текущее
биллинговое поведение прод-инстансов, только приводит "витрину" дефолта в форме
настроек в соответствие с реальным поведением биллинга.

Сверка остальных полей объекта `defaults` в `ps-park/settings/route.ts` с
`DEFAULT_*`-константами в `ps-park/service.ts` (строки 57–61):

| Поле в route.ts `defaults` | Значение | `DEFAULT_*` в service.ts | Совпадает |
|---|---|---|---|
| `openHour` | 8 | `DEFAULT_OPEN_HOUR = 8` | Да |
| `closeHour` | 23 | `DEFAULT_CLOSE_HOUR = 23` | Да |
| `slotRoundingMinutes` | 15 | `DEFAULT_SLOT_ROUNDING_MINUTES = 15` | Да (пофикшено) |
| `sessionAlertMinutes` | 10 | `DEFAULT_SESSION_ALERT_MINUTES = 10` | Да |
| `minBookingHours` | 1 | — (не существует в service.ts) | Н/П — сервис это поле нигде не читает (`grep -n "minBookingHours" src/modules/ps-park/service.ts` не находит использований), подтверждено ещё в первом круге; поле "мёртвое" в том же смысле, что и было до #434, но вне заявленного скоупа issue — не новая находка. |

Расхождений того же класса больше не найдено.

### 2. gazebos/settings/route.ts — сверка (не трогалось в этом коммите)

`src/app/api/gazebos/settings/route.ts:24-27` `defaults`: `openHour: 8, closeHour: 23,
minBookingHours: 4, maxBookingHours: 8`. `src/modules/gazebos/service.ts:49-53`:
`DEFAULT_OPEN_HOUR = 8`, `DEFAULT_CLOSE_HOUR = 23`, `DEFAULT_MIN_BOOKING_HOURS = 4`,
`DEFAULT_MAX_BOOKING_HOURS = 8`. Все четыре значения совпадают байт-в-байт — расхождения
нет, вторая копия того же бага в gazebos отсутствует.

### 3. DURATION_ABOVE_MAX фикс

`src/app/api/gazebos/bookings/[id]/route.ts:170-178` — `unprocessableCodes` теперь
`Set(["DISCOUNT_EXCEEDS_LIMIT", "PAYMENT_REQUIRED", "OUTSIDE_WORKING_HOURS",
"INVALID_TIME_RANGE", "DURATION_BELOW_MIN", "DURATION_ABOVE_MAX", "CAPACITY_EXCEEDED"])` —
синтаксически корректно, без дублей, `DURATION_ABOVE_MAX` стоит рядом с симметричным
`DURATION_BELOW_MIN` как и предлагалось.

Перепроверено самостоятельно утверждение о `createBooking`/`createAdminBooking`
(`src/app/api/gazebos/book/route.ts:80-88`, `src/app/api/gazebos/admin-book/route.ts:37-42`):
оба catch-блока делают `if (error instanceof BookingError) return apiError(error.code,
error.message);` — без третьего аргумента `status`. `apiError()` (`src/lib/api-response.ts:34-39`)
имеет `status = 400` по умолчанию для *любого* `BookingError.code*, включая
`DURATION_BELOW_MIN` и `DURATION_ABOVE_MAX` симметрично. Там нет `unprocessableCodes`-маппинга
вообще ни для одного кода — значит, нет и ассиметрии, которую нужно было бы чинить.
Объяснение из первого круга подтверждено чтением кода, не просто принято на веру.

### 4. Прогон проверок (самостоятельно, второй раз)

- `npm test -- --run` — **214 test files / 3220 tests passing**, 0 failed.
- `npx tsc --noEmit -p tsconfig.json` — чисто, без ошибок.
- `npx eslint src/app/api/ps-park/settings/route.ts "src/app/api/gazebos/bookings/[id]/route.ts"` — 0 warnings/errors.
- `npm run lint` (весь репозиторий) — 0 errors, 15 warnings, все в файлах, не относящихся к диффу (`messenger/useChatList.ts`, `modules/messenger/types.ts`, `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts`) — предсуществующие, не внесены этим коммитом.

### 5. Scope Check

`git diff 6e45c6a..26858b5 --stat` — ровно 3 файла: `src/app/api/ps-park/settings/route.ts`
(+5/-1), `src/app/api/gazebos/bookings/[id]/route.ts` (+1), и
`docs/qa-reports/2026-08-13-issue-434-module-settings-dead-config-review.md` (новый,
129 строк — отчёт первого круга). Никакого лишнего кода, рефакторинга или
несвязанных изменений. Оба кодовых файла — минимальные точечные правки, ровно
соответствующие находкам первого круга review, без побочных "улучшений".

### Security (второй круг)

- **Secrets leakage**: `git diff 6e45c6a..26858b5 | grep -niE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — единственные совпадения — `telegramChannelName`/`telegramChannelId`/`telegramChannelEvents`, которые не тронуты этим диффом (не в контексте изменённых строк) и не являются секретами (публично видимые в админке названия/ID Telegram-каналов, а не bot-токены). Ничего нового не утекает.
- **RBAC**: не изменён. Оба роута (`ps-park/settings`, `gazebos/bookings/[id]`) как и раньше защищены `requireAdminSection`/существующей проверкой роли выше по файлу — эта часть кода не в диффе.
- **Injection**: нет raw SQL, нет нового пользовательского ввода — правки только числовых констант-дефолтов и записи в `Set` статус-кодов.
- **Supply chain**: без изменений в `package.json`/`package-lock.json`.
- **Dangerous ops**: нет.

Инцидентов не найдено.

### Итог второго круга

Блокирующая находка первого круга устранена полностью и без побочных эффектов;
дополнительная проверка того же класса бага в gazebos/settings и по остальным
полям ps-park/settings расхождений не выявила. Non-blocking находка (`DURATION_ABOVE_MAX`)
тоже исправлена корректно. Тесты, typecheck и lint зелёные. Scope чистый — только
2 точечных изменения кода. **PASS.**
