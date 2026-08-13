# QA Report: Issue #438 — поиск по имени/телефону в истории броней (gazebos + ps-park)

## Вердикт: FAIL

Branch: `claude/issue-438-booking-history-search`, HEAD `e3f81c2`.
Сравнение с `main` через `git diff main...HEAD`.

Причина FAIL — не сами изменения PR (все 6 AC подтверждены, код корректен, тесты
качественные), а mandatory security-кейс **Data leakage / RBAC**, обязательный по
`agents/qa.md`: "Публичные endpoint'ы не возвращают email, phone, inn других
пользователей" и "Security-кейс FAIL → вердикт FAIL, независимо от остального".
PR добавляет параметр `search` ровно в тот endpoint (`GET /api/gazebos/bookings`,
`GET /api/ps-park/bookings`), который на деле доступен анонимно и без rate-limit —
т.е. превращает уже существующую утечку PII в удобный неавторизованный оракул
поиска гостя по имени/телефону. См. раздел «Критическая находка» ниже.

## Regression / build gates

| Проверка | Результат |
|---|---|
| `npm test -- --run` | 232 test files / 3480 tests — все зелёные (включая 8 новых: 4 service, 4 validation, 2 UI-debounce) |
| `npx tsc --noEmit` | без ошибок |
| `npm run lint` | 0 errors, 16 warnings; ни один warning не в диффе PR — единственный warning в затронутом файле (`booking-history-table.tsx` тест, `'init' is defined but never used`, строка 76) подтверждён через `git blame` как унаследованный от коммита `35cedab` (#436), не создан этим PR |

## Diff scope

```
src/components/admin/gazebos/__tests__/booking-history-table.test.tsx        | +36
src/components/admin/gazebos/booking-history-table.tsx                       | +17/-1
src/components/admin/ps-park/__tests__/ps-park-booking-history-table.test.tsx| +67 (новый файл)
src/components/admin/ps-park/ps-park-booking-history-table.tsx               | +17/-1
src/modules/gazebos/__tests__/service.test.ts                                | +29
src/modules/gazebos/__tests__/validation.test.ts                             | +14
src/modules/gazebos/service.ts                                               | +8
src/modules/gazebos/validation.ts                                            | +2
src/modules/ps-park/__tests__/service.test.ts                                | +31
src/modules/ps-park/__tests__/validation.test.ts                             | +14
src/modules/ps-park/service.ts                                               | +8
src/modules/ps-park/validation.ts                                            | +2
12 files changed, 245 insertions(+), 2 deletions(-)
```

`git diff main...HEAD -- 'src/app/api/**'` — пусто, подтверждает AC6 (маршруты
не тронуты, зависимость от #431/PR#510 подтверждена).

## Acceptance Criteria

| # | AC | Статус | Доказательство |
|---|---|---|---|
| 1 | `listBookingsPaginated` в обоих модулях принимает `search` и фильтрует по `clientName`/`clientPhone`, case-insensitive | PASS | `src/modules/gazebos/service.ts:1736-1742`, `src/modules/ps-park/service.ts:2008-2014` — идентичный блок: `if (params.search) where.OR = [{clientName:{contains,mode:"insensitive"}}, {clientPhone:{contains,mode:"insensitive"}}]`. Тип параметра добавлен в сигнатуру (`search?: string`, строка 1721/1993). |
| 2 | Фильтр комбинируется с другими AND'ом, не глобальным OR | PASS | `where` — плоский объект: `{moduleSlug, deletedAt, status?, resourceId?, date?, OR?}` (строки 1727-1742 / 1999-2014). В Prisma верхнеуровневые ключи одного `where` объединяются неявным AND; `OR` — лишь один из ключей, а не обёртка вокруг всего объекта. Т.е. `status="COMPLETED" & search="Иванов"` → `moduleSlug=X AND deletedAt=null AND status="COMPLETED" AND (clientName~search OR clientPhone~search)`. Подтверждено и тестом `should apply status filter` (не в диффе, регрессия не задета) плюс новым `should apply search filter...` — оба используют независимые `expect.objectContaining`, не конфликтуют. |
| 3 | Пустой/отсутствующий `search` не добавляет OR-клаузу | PASS | `if (params.search)` — falsy-строка (`""`/`undefined`) не входит в блок, `where.OR` не создаётся вообще (не `OR: []` и не `OR: undefined` внутри объекта — ключа нет вовсе). Явно проверено тестами `should not add OR clause when search is empty` (gazebos) и `does not add OR clause when search is empty` (ps-park): `expect(call?.where).not.toHaveProperty("OR")`. |
| 4 | Zod-схемы валидируют `search` с разумным max length | PASS | `src/modules/gazebos/validation.ts:45`, `src/modules/ps-park/validation.ts:53` — `search: z.string().max(200).optional()`. Тесты: accepts a search string / rejects a search string over 200 characters (обе схемы). |
| 5 | Оба admin history-table компонента: рабочий поиск, дебаунс перед запросом, сброс страницы на 1 при смене поиска | PASS | Идентичная реализация в `booking-history-table.tsx` (gazebos) и `ps-park-booking-history-table.tsx`: `search`/`debouncedSearch` state, `useEffect` с `setTimeout(..., 300)` (строки ~94-97 / ~66-69), `debouncedSearch` в зависимостях основного fetch-эффекта, `onChange={(e) => { setSearch(e.target.value); setPage(1); }}` на инпуте (строки ~189-192 / ~146-149). UI-тесты подтверждают точный тайминг дебаунса (`vi.advanceTimersByTime(300)`, ассерт `toHaveBeenCalledTimes(1)` до и `(2)` после) и то, что пустой `search` не попадает в query string. |
| 6 | Route-handler файлы не тронуты | PASS | `git diff main...HEAD -- 'src/app/api/**'` — пустой вывод. `src/app/api/gazebos/bookings/route.ts` и `src/app/api/ps-park/bookings/route.ts` спредят `parsed.data` из `bookingFilterSchema`/`psBookingFilterSchema` напрямую в `listBookingsPaginated(parsed.data)` (не деструктурируют поля вручную) — новое поле `search` протекает автоматически, что и утверждает issue про зависимость от #431/PR#510. |

## Оценка качества новых тестов

Не тавтологичны:
- `src/modules/gazebos/__tests__/service.test.ts` / `ps-park/__tests__/service.test.ts`: ассертят точную форму `OR: [{clientName:{contains:"Иванов", mode:"insensitive"}}, {clientPhone:{contains:"Иванов", mode:"insensitive"}}]`, а не просто факт вызова `findMany`. Negative-тест использует `not.toHaveProperty("OR")`, а не `OR: undefined` (что было бы слабее — `toHaveProperty` различает отсутствие ключа и `undefined`-значение).
- `src/modules/*/__tests__/validation.test.ts`: граничное значение ровно 201 символ (`"a".repeat(201)`) для проверки `max(200)`, а не произвольно большая строка.
- `src/components/admin/ps-park/__tests__/ps-park-booking-history-table.test.tsx` (новый файл — у компонента раньше не было тестов вовсе, что закрывает реальный пробел): реалистичный сценарий через `vi.useFakeTimers` + `fireEvent.change` + `vi.advanceTimersByTime(300)`, с явной проверкой "сразу после ввода запроса ещё нет" (`toHaveBeenCalledTimes(1)`) и "после 300мс — есть" (`toHaveBeenCalledTimes(2)`), плюс отдельный тест, что пустое поле не шлёт `search=` вовсе.

## Проверка scoping-решения (два ps-park компонента)

Подтверждено самостоятельным чтением `src/components/admin/ps-park/booking-history-table.tsx` (281 строка): экспортирует `BookingHistoryTable({bookings, resourceMap})` — чистый props-driven компонент, без единого `useEffect`/`fetch`/пагинации; единственный собственный side-effect — модалка чека по клику на завершённую бронь (`GET .../bill`), к фильтрации/поиску истории отношения не имеет. Использование подтверждено через grep: этот компонент рендерится только в `src/app/admin/ps-park/page.tsx` (дашборд, виджет "недавно завершённые", данные приходят как server-side проп `recentCompleted`), тогда как `PSParkBookingHistoryTable` (получивший поиск) рендерится в `src/app/admin/ps-park/bookings/page.tsx` — отдельной full-страницы истории с собственной пагинацией/фильтрами, куда и адресован issue ("история броней... только листать дни"). Скоуп корректен, ре-проверка предыдущего code-reviewer подтверждена независимо.

## Security-чеклист (функциональный)

| Кейс | Статус | Комментарий |
|---|---|---|
| Input validation (Zod) | PASS | `search` валидируется `.max(200)` до попадания в `where`; Prisma `contains` параметризован ORM'ом — SQL-инъекция через `search` невозможна (стандартный Prisma-паттерн, идентичный существующим полям). |
| RBAC — admin-only listing | **FAIL** | См. «Критическая находка» ниже. |
| Data leakage — публичные ответы | **FAIL** | См. «Критическая находка» ниже. |
| Rate limiting | **FAIL** | См. «Критическая находка» ниже (тот же root cause — endpoint не имеет ни auth-, ни rate-limit-гейта). |

## Критическая находка (блокирует вердикт)

**`GET /api/gazebos/bookings` и `GET /api/ps-park/bookings` — доступны анонимно, без сессии и без rate limit, и отдают PII (`clientName`, `clientPhone`, а также `user: {name, phone, email}`) по всей истории броней. Этот PR добавляет к этому же endpoint параметр `search`, превращая существующую утечку в удобный неавторизованный оракул поиска гостя по имени/телефону.**

Не introduced этим PR (баг существует и на `main`), но:
1. напрямую усиливается им — до PR анонимный запрос мог только листать страницы (`page`/`perPage`/`status`/даты), после PR можно мгновенно проверить "бронировал ли человек с таким именем/номером" одним запросом без перебора;
2. это ровно тот endpoint, который PR модифицирует и который проверяется в рамках этой задачи;
3. `agents/qa.md` требует проверки data leakage независимо от происхождения бага и предписывает FAIL вердикта при обнаружении.

Воспроизведение (проверено эмпирически, не только чтением кода):

1. `src/app/api/gazebos/bookings/route.ts` (не в диффе, но это ровно тот файл, который #431/PR#510 подключил к Zod-схеме и в который #438 добавляет `search`) не делает `auth()`/session-проверку вообще — только `bookingFilterSchema.safeParse` → `listBookingsPaginated` → `apiResponse`.
2. Гейт авторизации — только `src/lib/auth.config.ts`, `authorized()` callback. Там `isPublicApiRoute` матчится префиксом `pathname.startsWith("/api/gazebos")` / `startsWith("/api/ps-park")` (строки 78-79), и `if (isPublicApiRoute && request.method === "GET") return true;` (строка 120) — выполняется **до** любых ролевых проверок (блок `/api/admin/*` и общий `isApiRoute` fallback идут ниже, строки 154-179, и до них просто не доходит).
3. Эмпирическая проверка (временный vitest-файл, вызывающий реальный `authConfig.callbacks.authorized` с `auth: null` и `request.method: "GET"`, `pathname: "/api/gazebos/bookings?search=Ivanov"` / `"/api/ps-park/bookings?search=Petrov"`):
   ```
   gazebos/bookings result: true
   ps-park/bookings result: true
   ```
   т.е. анонимный запрос авторизуется как публичный — идентичное поведение подтверждено и на `main` (`git show main:src/lib/auth.config.ts` содержит тот же код), баг не нов, но не исправлен.
4. Ни `route.ts`, ни `service.ts` не делают собственной ролевой/сессионной проверки как fallback — `src/app/api/gazebos/bookings/__tests__/route.test.ts` не содержит ни одного auth-теста, что подтверждает: весь контур авторизации для этого маршрута — целиком на `proxy.ts`/`auth.config.ts`, а тот его пропускает.
5. Ответ содержит непосредственно PII: `listBookingsPaginated` включает `user: {select: {name, phone, email}}` (`service.ts:1748` / `2020`) и не стрипает `clientName`/`clientPhone` из `Booking` перед возвратом; `route.ts` дальше только добавляет `paymentStatus`, ничего не убирает.
6. Rate limiting: `grep` по `from "@/lib/rate-limit"` не находит ни одного файла в `src/app/api/gazebos/**` или `src/app/api/ps-park/**` — эндпоинт не ограничен даже по IP, в отличие от гостевых `POST`-эндпоинтов того же модуля (например, `/api/cafe/checkout` явно rate-limited).

Итог: любой неаутентифицированный клиент может выполнить `GET /api/gazebos/bookings?search=<любое+имя+или+телефон>&perPage=100` (и аналогично для ps-park) и мгновенно получить имя, телефон, email — включая клиентов, которые никогда не давали явного согласия на публичное раскрытие этих данных, — без ограничения скорости. Это прямое нарушение чеклиста `agents/qa.md` ("Публичные endpoint'ы не возвращают email, phone, inn других пользователей") и `agents/SECURITY.md` (раздел 2, Data Leakage).

### Рекомендация Developer'у (не чиню сам, per правило QA)

Минимально необходимо (может быть тем же PR или срочным fast-follow, но не должно уйти в прод как есть):
- Сузить `isPublicApiRoute` в `src/lib/auth.config.ts` так, чтобы префиксы `/api/gazebos`/`/api/ps-park` не покрывали `/bookings` (список истории) — либо явно исключить `pathname === "/api/gazebos/bookings" || pathname.startsWith("/api/gazebos/bookings/")` (и аналогично ps-park) из public-веток, оставив публичными только каталожные/availability GET'ы, ради которых правило вводилось.
- Добавить в сам `route.ts` (`gazebos/bookings`, `ps-park/bookings`) явную проверку `auth()` + роль (SUPERADMIN или MANAGER с `hasModuleAccess`) как defense-in-depth — по аналогии с чеклистом `agents/SECURITY.md` §3, а не полагаться только на middleware.
- Добавить rate limit на этот GET (или он автоматически появится, если роут перестанет матчиться под `isPublicApiRoute` и упадёт в общий authenticated-rate-limit контур).

## Scope check

Дифф ограничен `gazebos`/`ps-park` (существующие модули из реестра CLAUDE.md), новый модуль не создан, 12 файлов — в пределах "one PR = one feature". Найденная уязвимость находится вне непосредственного диффа PR (в `auth.config.ts`), поэтому формально не "фича вне скоупа", а блокирующий регресс безопасности, который эта фича делает более опасным — соответствует мандату QA проверять data leakage вне зависимости от того, где физически лежит корневая причина.

## Итог

Функционально все 6 AC issue #438 подтверждены чтением кода и прогоном тестов, реализация и тесты — качественные, без тавтологий, регрессий нет (`npm test`/`tsc`/`lint` чисты). Но общий вердикт — **FAIL**, потому что PR усиливает уже существующую, но здесь эмпирически подтверждённую critical-уязвимость: анонимный, нелимитированный по скорости доступ к PII (имя, телефон, email) всех гостей через тот самый endpoint, который PR оснащает точным поиском. Per `agents/qa.md`: "Security-кейс FAIL → вердикт FAIL, независимо от остального".

**Вердикт: FAIL**
