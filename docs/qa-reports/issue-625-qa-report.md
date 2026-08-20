# QA-отчёт: Issue #625 — pay-online route ищет бронь через getBooking(), не напрямую через Prisma

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-625-pay-online-deleted-at`, HEAD `a73052d`, поверх `main`
  (`git diff main...HEAD --stat` — ровно 2 файла, `+14 −10`, main — предок HEAD,
  один коммит).
- Тот же класс бага, что уже чинился в issues #512/#564: `POST
  /api/ps-park/bookings/:id/pay-online` читал `Booking` напрямую через
  `prisma.booking.findFirst({ where: { id, moduleSlug: "ps-park" } })`, в обход
  сервисного слоя, **без** `deletedAt: null` — менеджер мог сгенерировать
  ссылку на онлайн-оплату (ЮKassa) для мягко удалённой брони.
- Само issue #625 — находка `code-reviewer` при разборе #564/#574 (см.
  `.claude/feedback/qa-patterns.md`, секция Scope Creep), заведено отдельно,
  консистентно с правилом «не чинить второй баг того же класса в том же PR».
- PRD в `docs/requirements/` отсутствует — точечный баг-фикс с AC прямо из
  issue, тот же формат, что у #512/#564/#620.
- Code review уже пройден с вердиктом PASS (согласно постановке задачи). Ниже
  — независимая проверка: собственный mutation-тест на обеих затронутых
  функциях (route.ts и getBooking), самостоятельное чтение сервисного слоя,
  самостоятельный spot-check других вызовов `createOnlinePayment` и похожих
  route-хендлеров на тот же класс бага.
- Diff: ровно 2 файла:
  - `src/app/api/ps-park/bookings/[id]/pay-online/route.ts` — `getBooking(id)`
    вместо инлайн `prisma.booking.findFirst(...)`, импорт `getBooking` из
    `@/modules/ps-park/service`.
  - `src/app/api/ps-park/bookings/[id]/pay-online/__tests__/route.test.ts` —
    моки переведены с `prisma.booking.findFirst` на сервисный `getBooking`,
    добавлен отдельный тест `issue #625: ищет бронь через сервисный getBooking
    (фильтрует deletedAt: null), а не напрямую через Prisma`.

## Регрессия (полный прогон)
```
npm test -- --run   → 282 test files passed (282), 3936 tests passed (3936)
npx tsc --noEmit     → чисто, пустой вывод
npm run lint         → 0 errors, 16 warnings
```
16 warnings — те же pre-existing предупреждения, что фигурируют во всех
недавних QA-отчётах этого репозитория (`session-bill-modal.tsx`, `sidebar.tsx`,
`vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`,
`useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`,
`telephony/novofon-client.ts` и т.д.) — ни один не относится к изменённым в
этом PR файлам.

## Целевые тест-файлы
```
npx vitest run src/app/api/ps-park/bookings/[id]/pay-online → 1 file, 10/10 passed
npx vitest run -t "getBooking filters by deletedAt" src/modules/ps-park/__tests__/service.test.ts → 1/1 passed
```
Route-тест покрывает все заявленные в задании коды ответа: 200 (happy path),
401 (без сессии), 403 (роль USER), 403 (#622: `requireAdminSection` отклоняет
менеджера без доступа к модулю), 404 (бронь не найдена), 409 (`NOTHING_TO_PAY`),
400 (`PaymentError` прокинута как есть), 400 (`PSBookingError` прокинута как
есть), 500 (неожиданная ошибка, без утечки деталей) — плюс отдельный тест на
сам факт вызова `getBooking("bk-1")`.

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | Роут не может создать платёжную ссылку для мягко удалённой (`deletedAt` заполнен) ps-park брони — должен вернуть 404 `BOOKING_NOT_FOUND` | PASS | `getBooking(id)` (см. ниже) фильтрует `deletedAt: null` в `where` — для мягко удалённой брони `findFirst` вернёт `null`, роут (`route.ts:32`) на `null` отвечает `apiError("BOOKING_NOT_FOUND", ..., 404)`. Подтверждено чтением кода и mutation-тестом (см. ниже). |
| 2 | Фикс идёт через существующий `getBooking(id)` из `src/modules/ps-park/service.ts`, а не через инлайн `deletedAt: null` в дублирующем Prisma-запросе | PASS | `route.ts:7` импортирует `getBooking` из `@/modules/ps-park/service`, `route.ts:31` — `const booking = await getBooking(id);`. Прямого обращения к `prisma.booking` в файле роута больше нет (`grep -n "prisma\." route.ts` — только `prisma.resource.findUnique`/`prisma.user.findUnique`, оба не тронуты фиксом и не относятся к брони). Одновременно закрывает архитектурное нарушение «route handler трогает Prisma напрямую вместо сервисного слоя» из CLAUDE.md. |
| 3 | Нет регрессии happy path (менеджер создаёт ссылку на нормальную CONFIRMED/CHECKED_IN бронь) и существующих error-путей (401/403/404/409/400/500) | PASS | Все 10 тестов целевого файла зелёные (см. выше), полный набор `npm test` зелёный (3936/3936). Нисходящая логика (расчёт остатка счёта, создание платежа, аудит-лог) не тронута диффом — см. ниже. |

## Функциональная трассировка фикса (шаг 4 задания) — не со слов, а чтением кода

Прочитал `getBooking` напрямую в `src/modules/ps-park/service.ts:215-219`:
```ts
export async function getBooking(id: string) {
  return prisma.booking.findFirst({
    where: { id, moduleSlug: MODULE_SLUG, deletedAt: null },
  });
}
```
`deletedAt: null` присутствует в `where` — подтверждено чтением исходника, не
только доверием к тесту. `MODULE_SLUG` резолвится в `"ps-park"` (константа
модуля), то есть поведение по фильтрации модуля идентично старому инлайн-коду
(`moduleSlug: "ps-park"`), только с добавленным `deletedAt: null`.

Этот же `getBooking` уже используется в `GET /api/ps-park/bookings/:id`
(`src/app/api/ps-park/bookings/[id]/route.ts:34`) и в `PATCH` того же роута
(строка 81, для `previousStatus`) — фикс #625 не изобретает новый паттерн, а
приводит `pay-online` в соответствие с уже принятым в модуле способом читать
бронь через сервисный слой.

## Собственный mutation-тест (не доверяя только выводам review) — обе точки независимо

**Мутация 1 — откатил `route.ts` к до-фиксовой версии** (`git show
main:.../route.ts` — инлайн `prisma.booking.findFirst({ where: { id,
moduleSlug: "ps-park" } })`, без прохода через `getBooking`), прогнал текущий
(пост-фикс) тест-файл:
```
Test Files  1 failed (1)
     Tests  6 failed | 4 passed (10)
```
Упал ровно целевой тест `issue #625: ищет бронь через сервисный getBooking...`
(`expected mockGetBooking to be called with ['bk-1'], Number of calls: 0`) плюс
5 других тестов, зависящих от того же мока (happy path, 404, 409, оба 400) —
ожидаемо, поскольку тест-файл после фикса больше не мокает `prisma.booking`
вообще, а до-фиксовый код обращается к нему напрямую (`prisma.booking` в моке
`@/lib/db` отсутствует → `TypeError` → 500 на каждом из этих путей). RBAC-тесты
(401/403/403-module), не доходящие до вызова брони, остались зелёными — тоже
ожидаемо. Восстановил `route.ts` из бэкапа, `diff` с рабочей копией — пусто,
`git status --short` пусто.

**Мутация 2 — независимо, на чистой копии, убрал `deletedAt: null` из самого
`getBooking` в `service.ts`** (оставил `moduleSlug: MODULE_SLUG` в `where`),
прогнал pre-existing тест `getBooking filters by deletedAt: null` в
`src/modules/ps-park/__tests__/service.test.ts:1391-1399`:
```
FAIL ... getBooking filters by deletedAt: null
- ObjectContaining { where: ObjectContaining { deletedAt: null } }
+ { where: { id: "some-id", moduleSlug: "ps-park" } }
Tests  1 failed | 117 skipped (118)
```
Упал ровно этот тест. Этот тест не входит в диф текущего PR (существовал в
`service.test.ts` до #625 — сама функция `getBooking` уже была фильтрующей и
уже была протестирована; баг #625 был только в роуте, который её не вызывал).
Восстановил `service.ts` из бэкапа, `git status --short` пусто,
`git diff main...HEAD --stat` снова `+14 −10` без остаточных изменений.

**Вывод**: обе половины фикса (роут → `getBooking`, и сам `getBooking` →
`deletedAt: null`) покрыты независимыми тестами, ни один не тавтологичен.
Откат любой из двух точек детектируется тестами, специфичными именно для неё.

## Нисходящая логика (шаг 5 задания)

`route.ts` после `getBooking(id)` не меняет форму записи: `booking.status`,
`booking.metadata`, `booking.resourceId`, `booking.userId`, `booking.id`,
`booking.clientPhone` используются точно так же, как раньше (тот же Prisma
`Booking`-тип, `getBooking` — обычный `findFirst` без `select`, без сужения
полей). Расчёт остатка (`getBookingBill`), создание платежа
(`createOnlinePayment`) и аудит-лог (`logAudit(..., "payment.link_created",
...)`) не тронуты диффом ни строкой — `git diff` показывает изменение только
двух строк (импорт + замена запроса на вызов сервиса). Подтверждено тестами:
happy-path тест проверяет `mockCreateOnlinePayment` вызван с
`{ subjectId: "bk-1", moduleSlug: "ps-park", amount: 1000 }` и что
`body.data.paymentId === "pay-1"` — идентично поведению до фикса.

## Spot-check других вызывающих на тот же класс бага (шаг 6 задания, вне скоупа)

Не расширяя скоуп этого PR, проверил другие места, которые могли бы страдать
тем же классом бага (прямой Prisma-запрос по id без `deletedAt: null`, минуя
сервисный слой, перед мутацией/выдачей платёжной ссылки):

- **`src/modules/gazebos/service.ts:381`** и **`src/modules/cafe/service.ts:257`**
  — оба вызывают `createOnlinePayment` для **только что созданной** в этой же
  функции брони/заказа (`booking`/`order` — локальная переменная из
  `tx.booking.create(...)`/`createOrder(...)` несколькими строками выше), а не
  для записи, найденной по внешнему id. Мягко удалить сущность, которую сам же
  код только что создал, невозможно — не тот же паттерн, бага нет.
- **`src/app/api/bot/cancel-booking/route.ts:35-46`** — использует
  `prisma.booking.findUnique({ where: { id: bookingId } })` **без**
  `deletedAt: null` для определения `moduleSlug`/`userId` (роутинг между
  `cancelBooking`/`cancelPSBooking` и предварительная проверка владения).
  Формально та же находка (прямой Prisma-запрос без `deletedAt: null`, минуя
  сервисный слой), но **не является живой уязвимостью**: терминальная мутация
  идёт через `cancelBooking(bookingId, ...)`/`cancelPSBooking(...)`, а обе эти
  сервисные функции сами делают `prisma.booking.findFirst({ where: { id,
  moduleSlug: MODULE_SLUG, deletedAt: null } })` (проверено чтением
  `src/modules/ps-park/service.ts:875-877`) и корректно бросают
  `BOOKING_NOT_FOUND` для мягко удалённой брони — раздвоение записи в
  `bot/cancel-booking` используется только для роутинга/предварительного
  403-чека, не как источник истины для мутации. Тем не менее это тот же
  архитектурный паттерн («роут трогает Prisma напрямую вместо сервисного
  слоя»), что и #625 — фиксирую как кандидата на **отдельный** follow-up issue
  (рефакторинг на использование сервисного `getBooking`/аналога для
  консистентности и на случай будущих изменений, не потому что сейчас
  эксплуатируется), не блокирует вердикт по #625 и не входит в его скоуп.
- Остальные вызовы `prisma.booking.findFirst`/`findUnique` в
  `src/modules/ps-park/service.ts` (полный список получен грепом) — все внутри
  самого сервисного слоя, не дублируются в роутах; отдельно эта область уже
  прометена issues #423/#512/#557/#564/#622.
- `src/app/api/webapp/bookings/route.ts` — `findMany` по `userId`, без выборки
  по единичному `id`, к платежам/мутациям отношения не имеет — не тот же
  паттерн.

**Вывод по шагу 6**: новых живых экземпляров того же класса бага, что #625, не
найдено. Одна находка (`bot/cancel-booking`) — тот же архитектурный паттерн,
но не эксплуатируемая (терминальная операция уже гейтится сервисным слоем) —
рекомендую отдельный issue на рефакторинг, не блокирует текущий PR.

## Security-кейсы (обязательный чеклист QA)

- **RBAC**: покрыто тестами роута — анонимный/без сессии → 401 (`mockAuth`
  возвращает `null`); `USER` → 403 `FORBIDDEN` (`hasRole` до похода за
  бронью); менеджер без `ModuleAssignment` на `ps-park` → 403 через
  `requireAdminSection` (тест #622, `mockGetBooking` не вызван вообще — фикс
  этого PR не меняет порядок проверок, RBAC остаётся строго до бизнес-логики).
  Ни один из этих путей не тронут диффом.
- **Rate limiting**: эндпоинт аутентифицированный, административный (`MANAGER`
  + `requireAdminSection`) — под middleware-цепочкой `Rate Limit → Auth → Role
  → Module Access → Handler`, тариф не туже (`Authenticated: 240 req/min` per
  CLAUDE.md); диф не меняет `proxy.ts` и не затрагивает rate-limit слой — N/A
  для этого PR, не регрессия.
- **Input validation**: эндпоинт не принимает body — единственный вход — `id`
  из URL params, теперь дополнительно фильтруется через `getBooking`
  (`deletedAt: null`, `moduleSlug`) — строже, чем было, не слабее.
- **Data leakage**: response (`paymentId`, `confirmationUrl`, `amount`) не
  изменился диффом; `grep -iE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN'`
  по обоим изменённым файлам — 0 совпадений. 500-ветка (`apiServerError()`) не
  меняется, деталей не раскрывает — подтверждено тестом «неожиданная ошибка —
  500, без утечки деталей».
- Основная суть security-фикса — это сам AC-1 (закрытие возможности оплатить
  мягко удалённую бронь) — покрыт mutation-тестом выше, PASS.

Security-блокеров нет.

## Scope check
- `git diff main...HEAD --stat` — ровно 2 файла, `+14 −10`. Production-код
  тронут только в `src/app/api/ps-park/bookings/[id]/pay-online/route.ts` (4
  изменённых строки: импорт + замена запроса). Сервисный слой
  (`src/modules/ps-park/service.ts`), другие роуты, `package.json` — не тронуты.
- Находка вне скоупа (`bot/cancel-booking/route.ts`) описана выше как
  рекомендация follow-up, не как замечание к этому PR — консистентно с
  прецедентом issue-620 (там же зафиксированы находки в соседних местах, не
  блокируя вердикт).

## Итог
- Всего AC: 3
- PASS: 3
- FAIL: 0
- Регрессия: `npm test` 3936/3936 (282 файла), `npx tsc --noEmit` чисто,
  `npm run lint` 0 errors/16 pre-existing warnings.
- Целевой тест-файл: `pay-online/__tests__/route.test.ts` — 10/10 зелёные,
  покрывает 200/401/403×2/404/409/400×2/500 + отдельный тест на вызов
  `getBooking`.
- Mutation-тест (обе точки фикса, независимо, каждая обратима): откат
  `route.ts` к прямому Prisma-запросу уронил ровно целевой тест + 5 зависимых
  от мока (6/10 упали); откат `deletedAt: null` в самом `getBooking` уронил
  ровно pre-existing тест `getBooking filters by deletedAt: null`
  (`service.test.ts`). Оба файла восстановлены, `git status --short` пусто,
  `git diff main...HEAD --stat` снова `+14 −10`.
- `getBooking` (`src/modules/ps-park/service.ts:215-219`) прочитан лично:
  `deletedAt: null` в `where` подтверждён построчно, не только доверием к
  тестам.
- Нисходящая логика (расчёт остатка, создание платежа, аудит-лог) не тронута
  диффом ни строкой — те же типы данных, тот же контракт.
- Spot-check других вызывающих `createOnlinePayment` и похожих route-хендлеров
  — новых живых экземпляров того же бага не найдено; одна архитектурно
  похожая, но не эксплуатируемая находка (`bot/cancel-booking/route.ts`)
  зафиксирована как рекомендация для отдельного follow-up issue.
- RBAC/rate limiting/input validation/data leakage — проверены, без находок.

**Вердикт: PASS.** Фикс точечный, идентичен уже одобренному прецеденту паттерна
(#512/#564), устраняет реальную возможность создать платёжную ссылку ЮKassa на
мягко удалённую ps-park бронь и попутно устраняет архитектурное нарушение
«route handler трогает Prisma напрямую вместо сервисного слоя» (CLAUDE.md).
Обе половины фикса — маршрутизация через `getBooking` и сам фильтр
`deletedAt: null` внутри `getBooking` — независимо покрыты тестами, подтверждено
собственным mutation-тестом (не повторением тестов PR). `npm test`/`tsc`/`lint`
зелёные. Security-кейсы (RBAC, rate limiting, input validation, data leakage)
проверены без находок. Скоуп ровно issue #625 — диф 2 файла; находка того же
архитектурного паттерна вне скоупа (`bot/cancel-booking/route.ts`) не
эксплуатируема сегодня и зафиксирована как рекомендация для отдельного issue,
не блокирует текущий PR.
