# QA-отчёт: Issue #620 — cafe/health исключает soft-deleted MenuItem/Order

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-620-cafe-health-softdelete`, HEAD `fc25d56`, поверх `main` (main —
  предок HEAD, один коммит).
- Тот же баг, что уже исправлен в issue #489 (`gazebos/health`) и #557 (`ps-park/health`):
  health-роут читает `MenuItem`/`Order` напрямую через Prisma, в обход сервисного слоя, и
  до фикса не фильтровал `deletedAt: null`, из-за чего soft-deleted записи завышали
  `metrics.activeMenuItems`/`metrics.todayOrders`.
- PRD в `docs/requirements/` отсутствует — точечный баг-фикс с AC прямо из issue,
  консистентно с прецедентами #489/#557.
- Code review уже пройден с вердиктом PASS (согласно постановке задачи). Ниже —
  независимая проверка: собственный mutation-тест, самостоятельное чтение схемы и
  сервисного слоя, самостоятельный spot-check других health-роутов (не просто
  повторение выводов ревью).
- Diff: ровно 2 файла, `+63 −1`, совпадает с заявленным скоупом:
  - `src/app/api/cafe/health/route.ts` (+3 строки: `deletedAt: null` добавлен в оба
    `where` — `menuItem.count` и `order.count`)
  - `src/app/api/cafe/health/__tests__/route.test.ts` (новый файл, 4 теста)

## Регрессия (шаг 1)
```
npm test -- --run   → 282 test files passed (282), 3935 tests passed (3935)
npx tsc --noEmit     → чисто, пустой вывод
npm run lint         → 0 errors, 16 warnings
```
16 warnings — те же pre-existing предупреждения, что фигурируют во всех недавних
QA-отчётах этого репозитория (`session-bill-modal.tsx`, `sidebar.tsx`,
`vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `useChatList.ts`,
`messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts` и
т.д.) — ни один не относится к изменённым в этом PR файлам. Все три числа
(тесты/tsc/lint) совпадают точно с заявленными в постановке задачи.

## Целевой тест-файл (шаг 2)
```
npx vitest run src/app/api/cafe/health → 1 test file passed (1), 4 tests passed (4)
```
Все 4 теста (happy-path, menuItem soft-delete exclusion, order soft-delete
exclusion, 503 на ошибку БД) зелёные.

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `GET /api/cafe/health` не учитывает soft-deleted `MenuItem` в `metrics.activeMenuItems` | PASS | `src/app/api/cafe/health/route.ts:11` — `deletedAt: null` добавлен в `where` объекта `prisma.menuItem.count(...)`, тот же вызов формирует `metrics.activeMenuItems`. |
| 2 | `GET /api/cafe/health` не учитывает soft-deleted `Order` в `metrics.todayOrders` | PASS | `src/app/api/cafe/health/route.ts:17` — `deletedAt: null` добавлен в `where` объекта `prisma.order.count(...)`, тот же вызов формирует `metrics.todayOrders`. |
| 3 | Регрессионные тесты, которые падали бы до фикса и проходят после (не тавтологичны) | PASS | Подтверждено собственным mutation-тестом на обоих `where`-условиях независимо — см. ниже. |

## Собственный mutation-тест (шаг 3 задания) — обе ветки независимо

Не доверяя только выводам review, лично сломал каждую из двух строк фикса по
очереди и прогнал целевой тест-файл.

**Мутация 1 — убрал `deletedAt: null` из `order.count`:**
```
FAIL src/app/api/cafe/health/__tests__/route.test.ts > GET /api/cafe/health >
     исключает soft-deleted заказы из todayOrders (issue #620, тот же баг что #489/#557)
AssertionError: expected "vi.fn()" to be called with arguments: [...]
Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
```
Упал ровно тест про `Order`; happy-path, menuItem-тест и 503-тест остались зелёными.
Восстановил строку (`cp` из бэкапа), прогнал снова — 4/4 зелёные, `git status
--short` пусто.

**Мутация 2 — убрал `deletedAt: null` из `menuItem.count` (отдельно, после чистого
восстановления):**
```
FAIL src/app/api/cafe/health/__tests__/route.test.ts > GET /api/cafe/health >
     исключает soft-deleted позиции меню из activeMenuItems (issue #620, тот же баг что #489/#557)
Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
```
Упал ровно тест про `MenuItem`; остальные 3 остались зелёными.

Восстановил файл, `diff route.ts route.ts.bak` → идентичны, `git status --short`
пусто, `git diff main...HEAD --stat` снова `+63 −1` — без остаточных изменений.

**Вывод**: тесты не тавтологичны и не завязаны на общий мок — каждая из двух
`deletedAt: null` строк ловится независимым тестом. Частичный регресс в любой из
двух веток (что реально случалось бы при неполном/скопипащенном фиксе) был бы
пойман.

## Независимая проверка схемы и сервисного слоя (шаг 4 задания)

Прочитал `prisma/schema.prisma` лично, не доверяя только выводу review:
- `model Order` (строка 316) — поле `deletedAt DateTime?` на строке 329. Подтверждено.
- `model MenuItem` (строка 357) — поле `deletedAt DateTime?` на строке 370. Подтверждено.

Прочитал `src/modules/cafe/service.ts` и подтвердил, что фикс приводит health-роут
в соответствие с уже установленным паттерном сервисного слоя, а не изобретает
новый:
- `getMenu()` (строка 71-81) — `where: { ..., deletedAt: null, ... }` на `menuItem.findMany`.
- `getMenuCategories()` (строка 83-93) — `where: { ..., deletedAt: null }` на `menuItem.findMany`.
- `getMenuAdmin()` (строка 96-102) — `where: { ..., deletedAt: null }` на `menuItem.findMany`.
- `getCafeStats()` (строка 460-476) — `where: { ..., deletedAt: null, ... }` на `order.findMany`.

Все четыре функции сервисного слоя уже фильтровали `deletedAt: null` до этого PR —
`cafe/health/route.ts` был единственным местом в модуле `cafe`, которое считало
эти модели в обход этого паттерна. Фикс закрывает именно этот разрыв.

## Spot-check других health-роутов на тот же класс бага (шаг 5 задания)

Reviewer (по описанию задачи) уже сверил `rental`/`nedelovoy`/`payments`/`feedback`.
Самостоятельно, не полагаясь на этот список, прочитал оставшиеся health-роуты и их
сервисные функции: `analytics`, `feedback`, `inventory`, `management`, `messenger`,
`notifications`, `parking`, `sauna`, `telephony`, плюс повторно `gazebos`/`ps-park`
(уже исправленные прецеденты #489/#557).

- `analytics`, `parking` — не обращаются к БД для метрик, N/A.
- `feedback` — `prisma.feedbackItem.count({ take: 1 })`, результат не используется
  как метрика (только connectivity-проба) — не тот же паттерн.
- `inventory` (`getHealth()`, `src/modules/inventory/service.ts:951-966`) —
  считает `InventorySku`; у модели **нет** поля `deletedAt` (используется
  `isActive`, не soft-delete) — бага нет, N/A подтверждено чтением схемы.
- `management` (`getHealth()`, `src/modules/management/service.ts:562-578`) —
  **уже корректно** фильтрует `deletedAt: null` на обоих `prisma.recurringExpense.count`
  и `prisma.expense.count`. Уже соответствует правильному паттерну, доработка не нужна.
- `notifications`, `sauna`, `telephony` — не считают soft-deletable бизнес-модели
  (конфиг/токен-проверки либо статичный stub) — N/A.
- `gazebos`/`ps-park` — оба уже содержат `deletedAt: null` в `booking.count`
  (прочитал файлы напрямую, не по памяти) — подтверждают, что `cafe/health` теперь
  на одном уровне с обоими прецедентами.

**Находка вне скоупа этого PR (не блокирует вердикт, требует отдельного issue)**:
`messenger/health` → `getHealthMetrics()` (`src/modules/messenger/service.ts:92-98`)
считает `prisma.chatMessage.count()` **без** `where`-фильтра вообще, хотя у
`ChatMessage` есть настоящее поле `deletedAt DateTime?` (`schema.prisma:2087`),
активно используемое как soft-delete сообщения (`service.ts:466` —
`data: { deletedAt: new Date() }`, при выдаче тело обнуляется:
`body: msg.deletedAt ? "" : msg.body`). `metrics.messageCount` в `/api/messenger/health`
поэтому включает удалённые пользователем сообщения — тот же класс бага, что #489/
#557/#620, в соседнем модуле. Отдельно нашёл такой же паттерн (без `deletedAt`
фильтра) в двух местах вне health-роутов — `src/app/admin/dashboard/page.tsx:24-26`
(`ordersToday` виджет) и `src/app/admin/cafe/page.tsx:89-94` (`todayCount`/
`activeCount` в админ-каталоге кафе, при этом соседний `order.aggregate` в том же
файле, строки 95-98, уже корректно содержит `deletedAt: null` — тот же
непоследовательный паттерн, что уже трижды чинился в health-роутах). Ни то, ни
другое не входит в диф текущего PR и не входит в текст issue #620 (issue явно
ограничен `src/app/api/cafe/health/route.ts`) — фиксирую как рекомендацию для
отдельного follow-up issue, консистентно с прецедентом (issue-557-qa-report.md
зафиксировал sanity-check по #620 тем же образом, не блокируя вердикт).

**Вывод по шагу 5**: скоуп issue #620 (ровно один файл, `cafe/health/route.ts`)
выполнен полностью и без пробелов внутри себя. Похожий баг в паре других мест
существует, но корректно остаётся вне скоупа этого PR.

## Security-кейсы (шаг 6 задания)

- **RBAC**: N/A по архитектуре, не молча пропущено. `GET /api/cafe/health` —
  публичный, неаутентифицированный health-check. Подтверждено чтением
  `src/proxy.ts:38-47` — matcher middleware явно исключает `/api/{module}/health`
  из auth-гейта (`"/api/((?!auth|health|[^/]+/health$).*)"`), с комментарием в коде
  о том, что это намеренно для внешних проб мониторинга (deploy smoke,
  site-watchdog, Hetzner-probe). Тот же паттерн у `gazebos/health`, `ps-park/health`,
  `parking/health` — не регрессия этого PR. `management`/`sauna`/`telephony`
  health-роуты — исключение из общего правила, у них есть собственная
  внутренняя auth-проверка в хендлере; `cafe/health` в эту группу не входит и не
  должен (консистентно с прецедентами #489/#557).
- **Response shape**: не изменён. `git diff` показывает только добавление
  `deletedAt: null` в `where`-условия; структура ответа (`module`, `status`,
  `timestamp`, `metrics: { activeMenuItems, todayOrders }`) — идентична коду
  до фикса, никаких новых полей не добавлено.
- **Data leakage**: ответ — только числа (агрегированные счётчики), никаких
  email/phone/inn/токенов/внутренних ID. Ветка 503 отдаёт `error.message`
  (`error instanceof Error ? error.message : "Unknown error"`) — то же
  поведение, что и до фикса, не новая утечка. Подтверждено тестом "возвращает
  503 при ошибке БД".
- **Rate limiting**: N/A — health-эндпоинты выведены из общей цепочки
  middleware (см. `proxy.ts` выше), это pre-existing архитектурное решение, не
  затронутое этим PR.
- **Input validation**: эндпоинт не принимает вход (нет query/body параметров) —
  N/A.
- Секретов/токенов в изменённых файлах не найдено (grep по
  `password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN` в обоих файлах диффа — 0
  совпадений; диф состоит из `deletedAt: null` и тестового файла с `vi.fn()`
  моками).

Security-блокеров нет.

## Scope check
- `git diff main...HEAD --stat` — ровно 2 файла, `+63 −1`. Production-код
  тронут только в `src/app/api/cafe/health/route.ts` (5 изменённых строк, чистое
  добавление двух `deletedAt: null`). Сервисный слой (`src/modules/cafe/`),
  другие health-роуты, `package.json` — не тронуты.
- Находки за пределами скоупа (`messenger/health`, `admin/dashboard`,
  `admin/cafe`) описаны выше как рекомендация follow-up, не как замечание к
  этому PR.

## Итог
- Всего AC: 3
- PASS: 3
- FAIL: 0
- Регрессия: `npm test` 3935/3935 (282 файла), `npx tsc --noEmit` чисто,
  `npm run lint` 0 errors/16 pre-existing warnings — все числа совпадают точно с
  заявленными в постановке задачи.
- Целевой тест-файл: `npx vitest run src/app/api/cafe/health` — 4/4 зелёные.
- Mutation-тест (обе ветки, независимо, каждая обратима): убранный
  `deletedAt: null` в `order.count` уронил ровно 1 из 4 тестов (todayOrders);
  убранный `deletedAt: null` в `menuItem.count` уронил ровно 1 из 4 (другой,
  activeMenuItems) — тесты не тавтологичны, каждая строка фикса покрыта
  независимо. После каждой мутации файл восстановлен, `git status --short`
  пусто, diff идентичен исходному.
- Схема (`prisma/schema.prisma`) и сервисный слой (`src/modules/cafe/service.ts`)
  прочитаны лично: `MenuItem.deletedAt`/`Order.deletedAt` существуют, и
  `getMenu`/`getMenuCategories`/`getMenuAdmin`/`getCafeStats` уже фильтровали
  `deletedAt: null` до этого PR — фикс приводит health-роут в соответствие с
  уже установленным паттерном, не изобретает новый.
- Spot-check 9 других health-роутов (не входивших в явно заявленный список
  reviewer'а) — bug class нигде больше не найден *внутри health-роутов*, кроме
  одной находки в соседнем модуле (`messenger/health`, `messageCount` не
  фильтрует `deletedAt: null` на `ChatMessage` — вне скоупа #620, рекомендую
  отдельный issue) и двух находок в admin-дашбордах (`admin/dashboard/page.tsx`,
  `admin/cafe/page.tsx` — та же несогласованность, тоже вне скоупа). Ни одна из
  находок не блокирует вердикт по #620.
- RBAC/security: N/A явно обосновано (публичный health-check, middleware
  сознательно исключает `/api/*/health` из auth-гейта), response shape и data
  leakage не изменились, rate limiting N/A по той же причине.

**Вердикт: PASS.** Фикс точечный, идентичен уже одобренным прецедентам #489/#557,
приводит `cafe/health` в соответствие с уже установленным в
`src/modules/cafe/service.ts` паттерном фильтрации `deletedAt: null`. Оба
изменённых `where`-условия независимо покрыты регрессионными тестами —
подтверждено собственным mutation-тестом (не повторением тестов PR), обе ветки
падают порознь при откате соответствующей строки. `npm test`/`tsc`/`lint`
совпадают с заявленным baseline. Security N/A обоснован, а не пропущен молча.
Скоуп ровно issue #620, находки по тому же классу бага в соседних местах
(`messenger/health`, два admin-дашборда) зафиксированы как рекомендация для
отдельного follow-up issue, не блокируют текущий PR.
