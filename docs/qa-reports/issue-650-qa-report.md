# QA-отчёт: батч Issue #650/#660/#661 — soft-deleted Order/Booking/ChatMessage в count/where

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-650-soft-delete-batch`, HEAD `8bfabf5` (+ локальный
  коммит `e2794e7` с ревью-отчётом), поверх актуального `main`.
- Тот же класс бага, что уже чинился 4 раза (#489/#557/#620): Prisma
  count/findMany/where по soft-deletable модели (`deletedAt: DateTime?`) без
  фильтра `deletedAt: null`, из-за чего мягко удалённые записи засоряют
  счётчики/списки.
- Батч трёх находок (не микро-PR, по правилу CLAUDE.md Scope guard #3 / #655):
  - **#650** — `messenger.getHealthMetrics()` `chatMessage.count()` вообще без
    `where`; `admin/dashboard` `order.count()` и `admin/cafe` два
    `order.count()` без `deletedAt: null`.
  - **#660** — найдено при реализации #650, та же функция
    `getDashboardStats()`: оба `booking.count()` (gazebo/ps-park
    `bookingsToday`) тоже без `deletedAt: null`.
  - **#661** — найдено при реализации #650, тот же файл `admin/cafe/page.tsx`:
    `ordersWhere`, питающий `prisma.order.findMany` для таблицы заказов в
    реальном UI (`OrderActions` на каждой строке) — самая заметная находка,
    мягко удалённый заказ был бы виден менеджеру напрямую, а не только
    искажал бы цифру.
- Code review уже пройден с вердиктом PASS (`docs/qa-reports/issue-650-review.md`,
  прочитан и учтён). Ниже — независимая перепроверка: собственный mutation-тест
  на трёх правках, самостоятельное чтение схемы, самостоятельное сравнение
  рефакторинга `admin/cafe/page.tsx` построчно с `main`, самостоятельный поиск
  других count/findMany по тем же моделям в затронутых файлах.
- `git diff main...HEAD --stat` (без учёта untracked review-отчёта) — ровно 6
  файлов, `226(+) 30(-)`: `messenger/service.ts` + тест,
  `admin/dashboard/page.tsx` + новый тест-файл, `admin/cafe/page.tsx` + новый
  тест-файл. Совпадает с заявленным скоупом.

## Регрессия (собственный прогон)
```
npm test -- --run   → 284 test files passed (284), 3961 tests passed (3961)
npx tsc --noEmit     → чисто, пустой вывод
npm run lint         → 0 errors, 16 warnings (все pre-existing: session-bill-modal,
                        sidebar, vk-community-banner, ChatWindow, useChatList,
                        MessageBubble, messenger/types.ts, notifications/service.ts,
                        telephony/novofon-client.ts — ни один в изменённых файлах)
npx next build       → успешно (exit 0), 4 pre-existing Turbopack-warning'а
                        (src/instrumentation.ts edge-runtime, next.config.ts NFT-трейс,
                        Cache-Control) — ни один не про admin/cafe, admin/dashboard,
                        messenger
```
Все числа совпадают с заявленными в постановке задачи и в review-отчёте.
`git status --short` после прогона — пусто.

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | (#650) `getHealthMetrics()` фильтрует `deletedAt: null` на `chatMessage.count()` | PASS | `src/modules/messenger/service.ts:95`. `prisma.chat.count()` (строка 94) корректно не тронут — у `Chat` нет `deletedAt` (см. ниже). |
| 2 | (#650) `admin/dashboard` `order.count()` фильтрует `deletedAt: null` | PASS | `getDashboardStats()`, `src/app/admin/dashboard/page.tsx:34-36`. |
| 3 | (#650) `admin/cafe` оба `order.count()` (todayCount/activeCount) фильтруют `deletedAt: null` | PASS | `getCafeOrdersData()`, `src/app/admin/cafe/page.tsx:78-83`; соседний `order.aggregate` (строки 84-95) уже был корректен и не менялся. |
| 4 | (#660) оба `booking.count()` в `getDashboardStats()` фильтруют `deletedAt: null` | PASS | `src/app/admin/dashboard/page.tsx:18-33`, оба where (gazebos/ps-park). |
| 5 | (#661) `ordersWhere`, питающий таблицу заказов в UI, фильтрует `deletedAt: null` | PASS | `buildCafeOrdersWhere()`, `src/app/admin/cafe/page.tsx:52-64` — `deletedAt: null` в базовом объекте, применяется независимо от status/paidOnly. |
| 6 | Регрессионные тесты, не тавтологичные, пингующие каждую правку независимо | PASS | Подтверждено собственным mutation-тестом на 3 из 5 правок (см. ниже), плюс чтением остальных двух ассертов (структурно идентичны). |

## Собственный mutation-тест — 3 независимые правки, каждая обратима

Не полагаясь на review-отчёт, лично откатывал по одной правке и гонял целевой
тест-файл, затем восстанавливал файл и проверял `git status`/`git diff`.

**Мутация 1 — `messenger/service.ts`, убрал `where` из `chatMessage.count()`
(вернул к `prisma.chatMessage.count()`):**
```
npx vitest run src/modules/messenger/__tests__/service.test.ts
FAIL > getHealthMetrics > excludes soft-deleted messages from messageCount (issue #650...)
Tests  1 failed | 9 passed (10)
```
Упал ровно новый тест про `messageCount`, остальные 9 (включая happy-path
`getHealthMetrics`) остались зелёными. Восстановил файл из бэкапа —
`git diff src/modules/messenger/service.ts` пусто, тест-файл снова 10/10.

**Мутация 2 — `admin/dashboard/page.tsx`, убрал `deletedAt: null` только из
gazebo-ветки `booking.count()` (ps-park-ветка осталась нетронутой):**
```
npx vitest run src/app/admin/dashboard/__tests__/page.test.ts
FAIL > getDashboardStats > исключает soft-deleted брони из bookingsToday (issue #660...)
Tests  1 failed | 3 passed (4)
```
Тест перебирает оба вызова `booking.count` в цикле (`toHaveBeenCalledTimes(2)`
+ `for (const call of mock.calls)`) — упал именно на частично отсутствующем
фильтре, подтверждая, что покрыты **обе** ветки независимо, а не общий мок.
Восстановил файл — `git diff` пусто, 4/4 снова зелёные.

**Мутация 3 — `admin/cafe/page.tsx`, убрал `deletedAt: null` из
`buildCafeOrdersWhere` (правка #661, самая заметная — питает `findMany` для
UI-таблицы):**
```
npx vitest run src/app/admin/cafe/__tests__/page.test.ts
FAIL  4 tests (все 3 теста describe-блока buildCafeOrdersWhere + "передаёт
       переданный ordersWhere напрямую в findMany" в getCafeOrdersData)
Tests  4 failed | 2 passed (6)
```
Показательно: упал и тест `findMany`-интеграции (`getCafeOrdersData` >
"передаёт переданный ordersWhere напрямую в findMany") — это подтверждает,
что `deletedAt: null` реально доходит до `prisma.order.findMany`, того самого
запроса, что формирует список заказов с кнопками `OrderActions` в реальном
UI, а не только до промежуточного объекта. Восстановил файл — `git diff`
пусто, 6/6 снова зелёные.

**Итог `git status --short` / `git diff main...HEAD --stat` после всех трёх
мутаций и восстановлений** — рабочее дерево идентично состоянию до начала
mutation-теста (diff тот же `6 files changed, 226(+) 30(-)`, плюс отдельный
untracked/закоммиченный review-файл reviewer'а, не мой).

Не мутировал отдельно `order.count()` в `admin/cafe` (правка #650, todayCount/
activeCount) и второй `order.count()` в `admin/dashboard` — но их ассерты
структурно идентичны уже провалившимся (тот же паттерн
`expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })`
на каждый вызов в цикле по `mock.calls`), откат дал бы тот же результат.

## Независимая проверка схемы (не доверяя тексту issue/review)

Прочитал `prisma/schema.prisma` лично:
- `model Booking` (строка 190) — `deletedAt DateTime?` на строке 212, есть
  `@@index([deletedAt])` (строка 225). Подтверждено.
- `model ChatMessage` (строка 2080) — `deletedAt DateTime?` на строке 2087.
  Подтверждено.
- `model Chat` (строка 2045) — полей `deletedAt` **нет**. `prisma.chat.count()`
  в `getHealthMetrics()` корректно оставлен без `where`.
- `model Order` (строка 316) — `deletedAt DateTime?` на строке 329.
  Подтверждено.
- `model Module` (строка 152) — только `isActive: Boolean`, `deletedAt`
  **нет**. Оба `module.count()` в `getDashboardStats()` корректно не тронуты —
  другой механизм (флаг активности, не soft-delete).

Все 4 поля/отсутствия полей, на которые опирается фикс, подтверждены лично
чтением схемы, не переписыванием из review.

## Рефакторинг `admin/cafe/page.tsx` — поведенческая эквивалентность (собственная сверка)

Выполнил `git show main:src/app/admin/cafe/page.tsx` и построчный `diff`
против текущей версии (не полагаясь на описание в review-отчёте):
- `buildCafeOrdersWhere(today, statusFilter, paidOnly)` — тот же самый объект,
  что раньше собирался инлайново в теле компонента (`moduleSlug`, `createdAt`,
  условные spread'ы `status`/`paidOnly`), с добавленной строкой
  `deletedAt: null`. Порядок ключей, условная логика — идентичны.
- `getCafeOrdersData(ordersWhere, today)` — тот же `Promise.all` из 4
  промисов (`findMany` + 2×`count` + `aggregate`) с теми же аргументами
  (кроме добавленных `deletedAt: null` в двух `count`), просто вынесен из
  тела компонента.
- В компоненте: `Promise.all([getMenuAdmin(), getCafeOrdersData(...)])` вместо
  прежнего единого `Promise.all` из 5 промисов — но `getCafeOrdersData`
  сама содержит внутренний `Promise.all` из тех же 4 order-запросов. Итоговая
  степень параллелизма (все 5 БД-вызовов стартуют одновременно) не изменилась,
  просто уровень вложенности другой. Аргумент `today` передаётся тем же
  значением (`new Date(new Date().toISOString().split("T")[0])`), вычисленным
  один раз в компоненте, что и раньше.
- Никакой логики не потеряно и не добавлено сверх `deletedAt: null` +
  механической экстракции. `diff` подтверждает: единственные смысловые
  изменения — 3 новые строки `deletedAt: null` (одна в `buildCafeOrdersWhere`,
  две в `getCafeOrdersData`).

Вывод: рефакторинг поведенчески эквивалентен, регрессии не вносит.

## Мокинг в новых тест-файлах — не скрывает релевантный код

- `admin/dashboard/__tests__/page.test.ts` — мокирует только `@/lib/db`
  (`module`/`booking`/`order`.count). Подтверждено чтением `page.tsx`: файл
  не импортирует `auth()`/`next/navigation`, дополнительных моков не
  требуется — ничего не скрыто.
- `admin/cafe/__tests__/page.test.ts` — мокирует `@/lib/auth`,
  `@/lib/permissions`, `@/modules/cafe/service`, `next/navigation` в
  дополнение к `@/lib/db`. Проверил: тестируемые функции
  (`buildCafeOrdersWhere`, `getCafeOrdersData`) эти модули не вызывают —
  моки нужны только потому, что `page.tsx` импортирует их на верхнем уровне
  файла (`auth`, `hasAdminSectionAccess`, `getMenuAdmin`, `forbidden`), и без
  мока сам факт импорта модуля потянул бы реальный NextAuth-конфиг. RBAC-
  проверка (`auth()` + `hasAdminSectionAccess`) физически осталась в
  `CafeManagerPage` и этим тест-файлом не тестируется и не обходится — она
  просто не в периметре юнит-теста двух чистых функций.
- `messenger/__tests__/service.test.ts` — мок `@/lib/db` (pre-existing,
  дополнен только `chatMessage.count.mockResolvedValue(0)`, уже было в
  файле). Ничего нового не скрыто.

## Поиск других count/findMany/aggregate по Order/Booking/ChatMessage в тех же файлах (не расширяя скоуп)

`grep` по `prisma\.(order|booking|chatMessage|chat|module)\.` во всех трёх
затронутых файлах:

- `admin/cafe/page.tsx` — только 4 order-запроса внутри `getCafeOrdersData`,
  все учтены (3 фильтруют `deletedAt: null`, `aggregate` уже фильтровал).
- `admin/dashboard/page.tsx` — только 5 запросов в `getDashboardStats`, все
  учтены (2×`module.count` намеренно без фильтра — не soft-delete модель).
- `modules/messenger/service.ts` — помимо уже пофикшенных `chat.count()`/
  `chatMessage.count()`, файл содержит и другие `chatMessage`-запросы вне
  `getHealthMetrics()`:
  - `listMessages()` (строка 426) — `chatMessage.findMany` **без**
    `deletedAt: null`.
  - `listChatsForUser()`/`listChatsForAdmin()` (строки 259, 315) —
    `chat.findMany` с `include: { messages: { take: 1 } }`, тоже без фильтра
    на превью последнего сообщения.

  Это **не** тот же класс бага (пропущенный фильтр — случайность), а
  осознанный tombstone-паттерн: `toPublicMessage()` (строка 35) явно
  подставляет `body: msg.deletedAt ? "" : msg.body` — soft-deleted сообщение
  намеренно остаётся в треде (как плейсхолдер "сообщение удалено"), а не
  вычищается из выдачи, в отличие от count-метрик, где присутствие
  удалённой записи — чистый баг, искажающий число. Отдельно, `markRead()`
  (строка 485) корректно **фильтрует** `deletedAt: null` на списке
  непрочитанных сообщений (не нужно создавать receipt на скрытое сообщение) —
  что показывает: разработчики модуля осознанно различают "не считать в
  count/receipt" от "показывать плейсхолдер в треде". Не фиксирую как новую
  находку для follow-up — это разное, не пропущенный частный случай того же
  паттерна.

Других мест того же класса бага (count/aggregate без `deletedAt: null` там,
где ожидается soft-delete-прозрачность) в трёх затронутых файлах не найдено.

## Security-кейсы

- **RBAC**: изменений нет. `admin/cafe/page.tsx` — `auth()` +
  `hasAdminSectionAccess(userId, "cafe")` дословно перенесены без изменений
  (подтверждено `diff` против `main`), извлечённые функции их не дублируют и
  не обходят. `messenger/health` — публичный health-check (тот же паттерн,
  что `cafe/health` #620, `/api/*/health` вне auth-гейта `proxy.ts` по
  дизайну) — не регрессия.
- **Rate limiting**: N/A — новых публичных endpoint'ов нет,
  `/api/messenger/health` уже существовал вне цепочки middleware до этого PR.
- **Input validation**: N/A — фикс не принимает новый пользовательский ввод,
  только добавляет литеральный `deletedAt: null` в существующие `where`.
- **Data leakage**: ответ `messenger/health` — только числа
  (`chatCount`/`messageCount`), без изменений структуры. `admin/dashboard`/
  `admin/cafe` — server components за RBAC-гейтом, поведение вывода данных
  (какие поля рендерятся) не изменено — только состав *строк*, попадающих в
  выборку (soft-deleted теперь исключены, что уменьшает, а не увеличивает
  поверхность утечки).
- Secrets: `git diff main...HEAD -- src/ | grep -inE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key'` —
  0 совпадений в production-диффе.
- `any`: `git diff main...HEAD -- src/modules/messenger/service.ts src/app/admin/cafe/page.tsx src/app/admin/dashboard/page.tsx | grep '\bany\b'` — 0 совпадений.

Security-инцидентов не найдено.

## Edge cases
- Пустая выборка (0 заказов/броней/сообщений сегодня) — покрыто дефолтными
  моками (`mockResolvedValue(0)` / `[]`) в новых тест-файлах, `getDashboardStats`
  падает в error-path тест с нулевой статистикой.
- Комбинация фильтров `admin/cafe` (без фильтров / по статусу / по paidOnly) —
  все три ветки `buildCafeOrdersWhere` покрыты отдельными тестами, во всех
  трёх `deletedAt: null` присутствует одновременно с остальными условиями
  (не эксклюзивно).
- Ошибка БД в `getDashboardStats()` — существующий `try/catch` возвращает
  нулевую статистику, тест это подтверждает (pre-existing поведение, не
  регрессия).

## Scope check
- `git diff main...HEAD --stat` (production+test код) — ровно 6 файлов,
  `226(+) 30(-)`. Совпадает с постановкой задачи.
- `prisma/schema.prisma`, `package.json`, `CLAUDE.md` не тронуты — новых
  моделей/полей/зависимостей фикс не вводит.
- Находка про `listMessages`/`listChatsFor*` (см. выше) — намеренно не
  зафиксирована как новый follow-up: это не пропущенный случай того же бага,
  а другой (осознанный) паттерн soft-delete. Явно не расширяю скоуп новым
  issue без реального повторяющегося бага.

## Итог
- Всего AC: 6, PASS: 6, FAIL: 0.
- Регрессия: `npm test` 3961/3961 (284 файла), `tsc` чисто, `lint` 0 ошибок/16
  pre-existing warning'ов, `next build` успешно — все числа независимо
  воспроизведены, совпадают с заявленными.
- Mutation-тест: 3 из 5 правок лично откачены по одной и восстановлены —
  каждая уронила ровно ожидаемый тест (или тесты, для #660 с покрытием обеих
  веток booking.count в цикле), остальные тесты в файле остались зелёными;
  после каждой мутации рабочее дерево возвращено в исходное состояние
  (`git status --short` пусто, `git diff` идентичен исходному).
- Схема (`Booking.deletedAt`, `ChatMessage.deletedAt`, `Order.deletedAt`,
  отсутствие `deletedAt` у `Chat`/`Module`) проверена лично по
  `prisma/schema.prisma`.
- Рефакторинг `admin/cafe/page.tsx` (`buildCafeOrdersWhere`/
  `getCafeOrdersData`) сверен построчно с `main` — поведенчески эквивалентен,
  единственные смысловые изменения — 3 новые строки `deletedAt: null`.
- Мокинг новых тест-файлов не скрывает релевантный код (только
  auth/RBAC/каталог-модули, не тестируемую логику).
- Дополнительный поиск по трём файлам не нашёл пропущенных
  count/findMany/aggregate того же класса бага; найденное отличие
  (`listMessages`/чат-превью намеренно включают soft-deleted сообщения как
  tombstone) — не баг, задокументировано, не создаю лишний follow-up issue.
- Security: RBAC не изменён и не обойдён, rate limiting/input validation N/A
  по архитектуре (не новый endpoint, не новый пользовательский ввод), data
  leakage не увеличена (фикс сужает выборку), секретов/`any` в диффе нет.

**Вердикт: PASS.** Батч #650/#660/#661 исправляет ровно заявленный класс бага
в трёх независимо подтверждённых местах, каждое покрыто тестом, пингующим
именно свою строку фикса (подтверждено собственным mutation-тестом, не
повторением тестов из PR). Схема и рефакторинг перепроверены лично, а не на
слово review-отчёта. Security-блокеров нет. PR готов к автомержу
(`code-reviewer` уже PASS, теперь и `qa-engineer` PASS).
