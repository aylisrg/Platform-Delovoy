# QA Report: Issue #438 — поиск по имени/телефону в истории броней (gazebos + ps-park) — Re-verification

## Вердикт: PASS

Branch: `claude/issue-438-booking-history-search`, HEAD `6c4d388` (rebased onto `origin/main` after #527/#528).
Предыдущий проход (`docs/qa-reports/2026-08-13-issue-438-booking-history-search-qa-report.md`, HEAD `e3f81c2`) дал **FAIL** — все 6 AC #438 были подтверждены PASS индивидуально, но общий вердикт заблокировала обнаруженная в рамках той проверки P0-уязвимость: `GET /api/gazebos/bookings` и `GET /api/ps-park/bookings` были анонимно доступны (широкий `startsWith` в `isPublicApiRoute`, `src/lib/auth.config.ts`), что PR #438 делало "материально хуже" (таргетированный поиск PII вместо простого листания). Уязвимость исправлена отдельным PR #528 (issue #527) и уже прошла независимое code-review и QA PASS на своей собственной ветке. Эта ветка перебазирована на `main`, включающий фикс. Цель этого прохода — подтвердить, что фикс действительно попал в ветку и ничего не сломалось при ребейзе; полный повторный аудит остальной функциональности #438 не требовался и не проводился заново с нуля (см. п.4 ниже — точечная сверка, не полный аудит).

## 1. Фикс #527 присутствует в базе ветки

```
git log --oneline -10
6c4d388 docs(qa-reports): qa-engineer FAIL для issue #438 — блокирует #527
5675389 feat(gazebos,ps-park): поиск по имени/телефону в истории броней
eaa85bf fix(security): закрыть анонимный GET-доступ к PII под /api/{gazebos,ps-park,rental} (#527) (#528)
1ecfe7d fix(gazebos,ps-park): публиковать телефонные/админ-брони в Telegram-канал смены (#437) (#526)
...
```

`eaa85bf` — прямой предок HEAD. `grep -c "GAZEBOS_RESERVED_SEGMENTS" src/lib/auth.config.ts` → `2` (объявление + использование), т.е. текущий файл на ветке — исправленная версия, не старая уязвимая.

Дополнительно: `git merge-base origin/main HEAD` = `eaa85bf` — т.е. merge-base ветки с актуальным `origin/main` *есть* сам коммит фикса, ветка не отстаёт и не забегает вперёд относительно него. (Локальный ref `main` в рабочей копии был устаревшим до `git fetch origin main` — использован `origin/main` как источник истины.)

## 2. Целевые роуты больше не анонимно доступны — подтверждено чтением кода и эмпирически

Прочитан текущий `src/lib/auth.config.ts` (250 строк): `isPublicApiRoute` теперь точный allowlist (`pathname === "/api/gazebos"`, `"/api/gazebos/availability"`, `"/api/gazebos/health"`, `isGazeboResourceRoute(pathname)` — и аналогично ps-park). Функции `isGazeboResourceRoute`/`isPsParkResourceRoute` матчат `/api/{module}/<id>` **кроме** зарезервированных литеральных сегментов — множества `GAZEBOS_RESERVED_SEGMENTS` / `PS_PARK_RESERVED_SEGMENTS` явно включают `"bookings"`. Т.е. `/api/gazebos/bookings` и `/api/ps-park/bookings` (роуты, в которые #438 добавляет `search`) не матчат ни один паттерн `isPublicApiRoute` → падают в generic-фоллбэк `isApiRoute` (строка 231) → `if (!auth?.user) return 401 Response.json(...)`.

Написан и прогнан временный vitest-файл (`src/lib/__tests__/__qa_reverify_438.test.ts`, удалён после прогона — не коммитился), вызывающий реальный `authConfig.callbacks.authorized` с `auth: null`:

```
GET /api/gazebos/bookings?search=Ivanov  → authorized() возвращает NOT true (2 теста, оба passed)
GET /api/ps-park/bookings?search=Petrov  → authorized() возвращает NOT true
```

Идентичный результат независимо подтверждён штатным регрессионным набором `src/lib/__tests__/auth.config.test.ts` (добавлен в #528), явно покрывающим оба этих пути в блоке "PII-роуты требуют сессию (#527)" — прошёл в общем прогоне `npm test`.

Вывод: конкретная угроза, из-за которой был дан FAIL в предыдущем проходе ("анонимный таргетированный поиск гостя по имени/телефону через `search` на `/api/{gazebos,ps-park}/bookings`"), устранена.

## 3. Regression / build gates

| Проверка | Результат |
|---|---|
| `npm test -- --run` | 233 test files / **3511 tests** — все зелёные (рост с 3480 в прошлом проходе — новые коммиты из #526/#527/#528 подтянули свои тесты при ребейзе) |
| `npx tsc --noEmit` | без ошибок |
| `npm run lint` | 0 errors, 16 warnings (все — pre-existing, не в диффе этой ветки: `react-hooks/set-state-in-effect` в messenger-компонентах, unused vars в `notifications`/`telephony`/`messenger/types.ts` — не затронуты #438) |

## 4. Точечная сверка 6 AC issue #438 после ребейза (не полный повторный аудит — эти AC уже были детально верифицированы в предыдущем проходе; здесь — подтверждение, что ребейз ничего не задел)

`git diff origin/main...HEAD --stat` (14 файлов, 363 insertions/2 deletions) и `git diff origin/main...HEAD -- 'src/app/api/**'` (пусто) подтверждают: собственный дифф #438 идентичен предыдущему проходу по содержанию — единственная разница с прошлым отчётом в том, что `src/lib/auth.config.ts` и его тест **больше не в диффе ветки относительно базы**, потому что теперь они — часть самой базы (`origin/main`), а не привнесены этим PR. Это ожидаемо и корректно.

| # | AC | Статус | Подтверждение |
|---|---|---|---|
| 1 | `search` на `listBookingsPaginated` (gazebos+ps-park), case-insensitive contains по `clientName`/`clientPhone` | PASS | `src/modules/gazebos/service.ts` / `src/modules/ps-park/service.ts` — идентичный блок `if (params.search) where.OR = [{clientName:{contains,mode:"insensitive"}}, {clientPhone:{contains,mode:"insensitive"}}]`, байт-в-байт как в прошлом проходе. |
| 2 | Комбинируется AND'ом с другими фильтрами (`status` и т.д.) | PASS | `where` — плоский объект, `OR` лишь один из его ключей (не обёртка) → неявный AND между `status`/`date`/`OR`. Не изменилось. |
| 3 | Пустой/отсутствующий `search` не добавляет OR-клаузу | PASS | `if (params.search)` — falsy не входит в блок, ключ `OR` не создаётся вовсе. Тесты `should not add OR clause when search is empty` (оба модуля) зелёные. |
| 4 | Zod-схема валидирует `search` с max length | PASS | `search: z.string().max(200).optional()` в обеих `validation.ts`. |
| 5 | Debounce + сброс страницы на 1 в обоих admin history-table компонентах | PASS | `booking-history-table.tsx` (gazebos) и `ps-park-booking-history-table.tsx` (`src/components/admin/ps-park/`): `useEffect` c `setTimeout(..., 300)` → `debouncedSearch`, `onChange={(e) => { setSearch(e.target.value); setPage(1); }}`. Оба файла прочитаны напрямую в этом проходе (диффы вручную сверены). |
| 6 | Route-handler файлы не тронуты диффом #438 | PASS | `git diff origin/main...HEAD -- 'src/app/api/**'` — пустой вывод (0 строк). Единственное изменение в auth-контуре (`src/lib/auth.config.ts`) пришло через ребейз на `origin/main` (коммит `eaa85bf`), а не через собственный дифф этой ветки — согласуется с ожиданием в задаче. |

## 5. Security-чеклист (функциональный) — повторная сверка

| Кейс | Статус | Комментарий |
|---|---|---|
| Input validation (Zod) | PASS | Без изменений с прошлого прохода — `search` валидируется `.max(200)`, Prisma `contains` параметризован. |
| RBAC — admin-only listing (`GET /api/{gazebos,ps-park}/bookings`) | **PASS** (было FAIL) | Анонимный запрос → `401 UNAUTHORIZED` через generic `isApiRoute`-фоллбэк, подтверждено эмпирически (п.2) и штатными тестами `auth.config.test.ts`. |
| Data leakage — публичные ответы | **PASS** (было FAIL) | Тот же root cause, что и RBAC-кейс выше — закрыт тем же фиксом; PII (`clientName`, `clientPhone`, `user.{name,phone,email}`) больше не отдаётся анонимно ни через `search`, ни без него. |
| Rate limiting | **PASS** (было FAIL, тот же root cause) | Роут больше не попадает в public-ветку `authorized()` → анонимный запрос вообще не проходит дальше 401, до rate-limit речь не доходит; авторизованные запросы — под общим authenticated rate-limit контуром (`RATE_LIMIT_AUTH_PER_MIN`), не требующим отдельного изменения ради этого PR. |

Ни один обязательный security-кейс не в статусе FAIL.

## Scope check

Дифф ограничен `gazebos`/`ps-park` (существующие модули из реестра CLAUDE.md), новый модуль не создан. Единственная строка вне модулей — `.claude/feedback/qa-patterns.md` (self-improving QA паттерны, генерируется скриптом, не бизнес-код) и qa-report сам по себе. В пределах "one PR = one feature".

## Итог

Блокирующая находка предыдущего прохода — анонимный доступ к `GET /api/{gazebos,ps-park}/bookings` — устранена мерджем #528 и подтверждена как присутствующая в базе этой ветки после ребейза: чтением кода, штатным регрессионным набором и независимым эмпирическим вызовом `authConfig.callbacks.authorized`. Все 6 AC issue #438 подтверждены точечной сверкой (без регрессий от ребейза). `npm test` (3511/3511), `tsc --noEmit`, `npm run lint` (0 errors) — все чисты. Security-чеклист — все кейсы PASS.

**Вердикт: PASS**
