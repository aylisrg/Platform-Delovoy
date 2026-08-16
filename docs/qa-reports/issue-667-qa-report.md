# QA: UI + API создания ресурса (US-3, эпик #442) — issue #667, PR #676

Независимая верификация. Не доверяю трассировке `code-reviewer` (`docs/qa-reports/issue-667-review.md`,
вердикт PASS) — каждый пункт ниже перепроверен по коду/тестам/прогонам самостоятельно,
часть — мутационным тестированием (временная порча кода → прогон целевого теста → откат).

## Вердикт: PASS

## Диапазон верификации
`git diff origin/main...HEAD --stat` (база — `origin/main` = `e46c37c`, не локальный
возможно устаревший `main`): 13 файлов, +1081/-4, один функциональный коммит
(`3517267 feat(gazebos,ps-park): UI + API создания ресурса (US-3, эпик #442)`) +
один коммит с отчётом ревьюера (`64237ff docs(qa): ...`). Список файлов совпадает
1-в-1 с ожидаемым: 6 файлов кода, 6 тестовых файлов/блоков, `issue-667-review.md`.
Ничего постороннего не найдено (сравнил `git diff --stat` построчно со списком в задаче).

## Acceptance Criteria (US-3)

| AC | Статус | Как проверено |
|----|--------|----------------|
| AC-1 | PASS | `git diff` `resources/page.tsx` обоих модулей — `<ResourceCreator />`/`<TableCreator />` добавлены в `CardHeader` без клиентского гейта, ровно так же, как уже рендерится `ResourceEditor`/`TableEditor` ("Изменить"). Прочитан весь файл компонента — кнопка `+ Добавить беседку`/`+ Добавить стол` рендерится безусловно. |
| AC-2 | PASS | Построчно сверил `resource-creator.tsx` c `resource-editor.tsx` (беседки) и `table-creator.tsx` c `table-editor.tsx` (ps-park). Беседки: описание, вместимость, матрица прайса будни/выходные × час/день → `metadata.priceList`, `pricePerHour = weekdayHour` — идентичный набор полей (минус `isActive`-чекбокс, который в create-форме не нужен по построению). Ps-park: только `pricePerHour` — `table-editor.tsx` тоже не рендерит `capacity`/`description`, хотя тип `PSTable` их формально содержит: асимметрия унаследована от edit-формы, не новая. Обязательно только `name` — client-guard (`if (!name.trim())`) + Zod `min(1)`; остальные поля `.optional()` в обеих схемах (`src/modules/{gazebos,ps-park}/validation.ts`, эти схемы не менялись этим PR). |
| AC-3 | PASS, факт-чек прошёл | `prisma/schema.prisma`: `Resource.isActive Boolean @default(true)`. `createResource`/`createTable` не передают `isActive` в `data` — Prisma использует дефолт. `listResources(activeOnly=true)` (дефолтный параметр) и `getTimeline()` оба фильтруют `isActive: true` без доп. флагов — прочитал реализацию обеих функций в `service.ts`, не поверил на слово. Новый ресурс попадает в GET-список и в дневной таймлайн без деплоя. |
| AC-4 | PASS, включая попытку найти дыру | `canEditModule(user, moduleSlug)` (`src/lib/permissions.ts:223`) — SUPERADMIN всегда `true`; USER всегда `false`; ADMIN — `true` через `isAdminEditableModule` (`gazebos`/`ps-park` оба в списке); MANAGER — `hasAdminSectionAccess(userId, section)`, требует явную запись `AdminPermission` (без гранта — `false`). Это ТА ЖЕ функция, с теми же аргументами, что и `PATCH /api/gazebos/[id]`/`PATCH /api/ps-park/[id]` (сверил построчно — идентичный вызов `canEditModule(session.user, "gazebos"/"ps-park")`). Прочитал `auth.config.ts` целиком: `/api/gazebos`/`/api/ps-park` — точные пути (не префиксы, см. issue #527 комментарий в коде) в `isPublicApiRoute`, байпас условен `request.method === "GET"` (строка 180) — POST не подпадает. `isPublicPostRoute` (строка 158–171) `/api/gazebos`/`/api/ps-park` не содержит. POST падает в общий `isApiRoute` fallback (строка 246) — требует `auth?.user`, иначе `401` уже на уровне middleware, до вызова роута. Итого: анонимный POST не доходит до `createResource` вообще (блокируется в middleware); аутентифицированный USER доходит до роута, но `canEditModule` возвращает `false` → `403`; MANAGER без `AdminPermission` на `gazebos`/`ps-park` — аналогично `403`. Дыры не нашёл. |
| AC-5 | PASS | `logAudit(session.user.id, "gazebos.resource.create"/"ps-park.resource.create", "Resource", resource.id, {...})` — сверил сигнатуру `logAudit` в `src/lib/logger.ts` (userId, action, entity, entityId, metadata) — аргументы на своих местах. Naming convention `{module}.resource.{verb}` совпадает с уже существующим `gazebos.resource.update`/`ps-park.resource.update` в `PATCH`-роутах (`grep` подтвердил). |
| AC-6 | PASS | `git diff origin/main...HEAD -- src/modules/gazebos/service.ts src/modules/ps-park/service.ts src/modules/gazebos/validation.ts src/modules/ps-park/validation.ts` — **пустой диф**, эти 4 файла этим PR не тронуты вообще (только их `__tests__/` получили новые блоки). `createResource`/`createTable` вызываются из новых `POST`-хендлеров впервые. |
| AC-7 | PASS | Роуты структурно идентичны (auth → canEditModule → Zod → сервис → logAudit → `apiResponse(..., 201)` / `apiServerError()` в catch), разница только в наборе полей формы, что задокументировано и унаследовано от edit-форм (AC-2). |

## Мутационное тестирование (не просто чтение)

Правил код напрямую, гонял целевой тестовый файл, откатывал — рабочее дерево чистое
после каждого прогона (`git status --short` пусто).

1. **Убрал Zod-проверку** (`if (!parsed.success) {...}`) из `POST /api/gazebos` →
   тест `"отклоняет тело без названия — 422, сервис не вызван"` упал (`500` вместо
   `422`) — валидация реально что-то делает, не косметика.
2. **Убрал RBAC-проверку** (`canEditModule`) → тест `"без права редактирования
   модуля — 403"` упал (`201` вместо `403`) — RBAC реально гейтит вызов сервиса,
   не только присутствует в коде для вида.
3. Оба отката подтверждены, `git diff --stat` после отката — пусто.

## Дополнительные пробные security-тесты (написал сам, не из PR)

Временные тестовые файлы, удалены после прогона, в диффе PR их нет.

- **Mass assignment**: тело `{ name, isActive: false, moduleSlug: "ps-park", id: "attacker-controlled-id", createdAt: "2000-01-01" }` на `POST /api/gazebos` → в аргумент `createResource` дошло только `{ name }`, все посторонние поля (включая попытку подменить `moduleSlug` межмодульно и захватить `id`) молча отброшены Zod'ом (схема не `.passthrough()`). PASS.
- **RBAC под ролью USER**: `canEditModule` для роли `USER` возвращает `false` безусловно на первой строке, без похода в БД — детерминированно, дыры нет.

## Security-чеклист (обязательный, `agents/qa.md`)

| Кейс | Статус | Комментарий |
|------|--------|-------------|
| Анонимный запрос → 401 | PASS | Блокируется уже на уровне middleware (`isApiRoute` fallback, `auth?.user` отсутствует) — до роута не доходит. Тест `"требует авторизацию — 401"` подтверждает и роут-уровневый чек `!session?.user?.id`. |
| USER → 403 | PASS | `canEditModule` возвращает `false` для роли USER безусловно (без DB-запроса). |
| MANAGER без гранта на модуль → 403 | PASS | `hasAdminSectionAccess` требует `AdminPermission`-запись; тест `"без права редактирования модуля — 403"` мокает именно этот путь и явно проверяет, что `canEditModule` вызван с правильным `moduleSlug` (`"gazebos"`/`"ps-park"`), а не просто с любым аргументом. |
| Подмена `userId`/`moduleSlug` в body | PASS | `logAudit` берёт `userId` из `session.user.id`, не из тела. `moduleSlug` в `createResource`/`createTable` — захардкоженная константа в `service.ts` (не менялась этим PR), плюс Zod-схема не принимает `moduleSlug` от клиента вовсе (см. mass-assignment пробу выше). |
| Rate limiting | N/A, обоснованно | Admin-эндпоинт — по CLAUDE.md "Admin: no limit". `POST /api/gazebos`/`POST /api/ps-park` требуют сессию + `canEditModule`, это не публичный анонимный роут — соответствует конвенции остальных admin write-роутов модуля (`PATCH /api/gazebos/[id]` тоже без лимита). |
| Невалидный JSON → 400 VALIDATION_ERROR | **Найдено расхождение, см. ниже** | Фактически — `500 INTERNAL_ERROR`, не `400`/`422 VALIDATION_ERROR`. |
| Поля сверх Zod-схемы игнорируются | PASS | Подтверждено пробным тестом выше. |
| SQL-like строки безопасны | PASS (по построению) | Нет raw SQL ни в новом, ни в вызываемом коде — только `prisma.resource.create` с параметризацией. Отдельный проб не потребовался. |
| Data leakage (email/phone/inn чужих юзеров) | N/A | `Resource` не содержит PII пользователей — создание ресурса не отдаёт данные третьих лиц. |
| 500 без stack trace / путей | PASS | `apiServerError()` возвращает статический `{ code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" }`, без деталей. Подтверждено существующим тестом `"неожиданная ошибка сервиса — 500, без утечки деталей"`. |

### Про находку "невалидный JSON → 500, а не 400"

Проверил эмпирически (временный тестовый файл, удалён после): `POST /api/gazebos` с
телом `"{not valid json"` → `request.json()` кидает `SyntaxError`, перехватывается
общим `catch` роута → `apiServerError()` → **`500 INTERNAL_ERROR`**, а не
`400`/`422 VALIDATION_ERROR`, как требует чек-лист `agents/qa.md`.

Это реальное расхождение с чек-листом, но **не регрессия и не новая дыра этого PR** —
это дословно то же самое поведение, что уже сегодня у `PATCH /api/gazebos/[id]`
(тот же паттерн `await request.json()` внутри общего `try {} catch {}` без отдельного
перехвата `SyntaxError`), и такой же паттерн у подавляющего большинства POST/PATCH
роутов в кодовой базе (`rental/deals`, `rental/tenants`, `rental/contracts`,
`gazebos/settings` и т.д. — грепнул `await request.json()` + соседний `catch` по
всему `src/app/api/`, паттерн системный, не единичный). Задача AC-4 этого PR —
"эквивалентно PATCH, не слабее" — это буквально подтверждено: оба роута одинаково
(некорректно) отвечают 500 на битый JSON. Новый роут не деградирует существующую
защиту, а воспроизводит уже существующий, кодобазово-широкий пробел.

**Решение по вердикту**: не блокирую issue #667 этой находкой. Фикс требует либо
точечного `try { body = await request.json() } catch { return apiValidationError(...) }`
в десятках роутов, либо общего хелпера — в любом случае это отдельная, не связанная
с US-3 задача (нарушение Scope guard #2/#3, если чинить здесь). Завожу отдельный
паттерн в `qa-patterns.md` (см. ниже) вместо блокировки этого PR.

## Регрессия и типы

- `npm test -- --run`: **290 test files passed (290) / 4023 tests passed (4023)** — сам прогнал, не поверил цифре из отчёта ревьюера, совпадает.
- `npx tsc --noEmit`: чисто, 0 ошибок.
- `npm run lint`: **0 errors**, 16 warnings — все в файлах, не относящихся к этому PR (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`, `admin/*`), проверил, что 10 изменённых этим PR файлов дают 0 warnings/errors при точечном прогоне ESLint.

## Follow-up issues #675 / #674 — подтверждено не затронуты

- #675 (`deletedAt: null` отсутствует в `getResource`/`getTable`/`listResources(false)`/прямых `prisma.resource.findMany` в `resources/page.tsx`): прочитал `resources/page.tsx` целиком — `prisma.resource.findMany({ where: { moduleSlug: "gazebos" }, ... })` по-прежнему без `deletedAt: null`, этот PR трогает в файле только 2 строки (импорт + рендер кнопки), не сам запрос. Баг жив, не усугублён, не замаскирован.
- #674 (rate-limit на debounced-search роутах): `POST /api/gazebos`/`POST /api/ps-park` — не debounced-search эндпоинты, к ним неприменимо; в диффе нет ни одного изменения к search/autocomplete роутам.

## Что не потребовало отдельной проверки (обосновано)

- Rate limiting на самом новом роуте — см. security-чеклист выше, N/A по архитектуре (admin-роут).
- SQL injection — нет прямого SQL, только Prisma.

## Итог

Все 7 AC подтверждены прямой проверкой кода/схемы/тестов, часть — мутационным
тестированием и самостоятельно написанными пробными тестами (mass assignment,
malformed JSON), а не только чтением отчёта `code-reviewer`. Единственная новая
находка (JSON parse error → 500 вместо 400) — подтверждённый факт, но
до-PR-совместимый системный паттерн, не регрессия этого PR и не блокер для
issue #667; вынесен в `qa-patterns.md` как повторяющийся паттерн для будущих
PR, а не как баг-репорт против этого PR.

**Вердикт: PASS.**
