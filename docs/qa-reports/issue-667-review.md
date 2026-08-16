# Review: UI + API создания ресурса (US-3, эпик #442) — issue #667, PR #676

## Вердикт: PASS

## Acceptance Criteria
| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | Кнопка «+ Добавить беседку» / «+ Добавить стол» добавлена в `resources/page.tsx` обоих модулей, рендерит модалку с формой. |
| AC-2 | PASS | `resource-creator.tsx` буквально повторяет поля `resource-editor.tsx` (описание, вместимость, матрица прайса будни/выходные × час/день → `metadata.priceList`, `pricePerHour = weekdayHour`); `table-creator.tsx` повторяет поля `table-editor.tsx` (только `pricePerHour`, других полей у ps-park edit-формы нет). Обязательно только `name` — проверено клиентским guard'ом и Zod-схемой (`min(1)`), остальные поля `.optional()`. Асимметрия полей между беседками и Плей Парком — заранее задокументированное, унаследованное от EDIT-форм расхождение, не новое и не scope creep. |
| AC-3 | PASS | `createResource`/`createTable` пишут `isActive` по умолчанию `true` (схема Prisma, `@default(true)`), `listResources`/`getTimeline` фильтруют по `isActive: true` без доп. флагов — новый ресурс сразу в сетке/доступен для брони без деплоя. |
| AC-4 | PASS | POST-роуты используют `auth()` + `canEditModule(session.user, "gazebos"/"ps-park")` — идентично PATCH `/api/gazebos/:id` и `/api/ps-park/:id`. Кнопка/форма создания не гейтится на клиенте — так же, как сегодня `ResourceEditor`'s «Изменить»: это буквальный паритет, а не regression. Проверено, что `authorized()` в `auth.config.ts` не покрывает POST на `/api/gazebos`/`/api/ps-park` в public-bypass (только `GET`), поэтому RBAC полностью на роуте — так же, как у существующего PATCH. |
| AC-5 | PASS | `logAudit(session.user.id, "gazebos.resource.create"/"ps-park.resource.create", "Resource", resource.id, {...})` — тот же формат action-name (`{module}.resource.{verb}`), что и `gazebos.resource.update`/`ps-park.resource.update`. |
| AC-6 | PASS | Роуты вызывают ранее неиспользуемые `createResource`/`createTable` из `service.ts` напрямую, без изменения их поведения (подтверждено диффом service.ts — только добавлены тесты, сама реализация функций не менялась). |
| AC-7 | PASS | Поведение POST-роутов, RBAC-проверки, audit-логирование, Zod-валидация идентичны между беседками и Плей Парком (различается только набор полей формы — оговорено в AC-2, унаследовано от edit-форм). |

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — диф ровно 12 файлов из списка задачи, один коммит. `page.tsx` обоих модулей меняются только на добавление импорта и рендера кнопки создания; существующий `prisma.resource.findMany` без `deletedAt: null` (issue #675) не тронут — PR не усугубляет и не чинит этот баг вскользь, всё оставлено на #675, как и требовалось.
- Follow-up issues #675 (soft-delete filter) и #674 (rate-limit на debounced-search) корректно не затронуты этим PR: #675 живёт в тех же read-путях (`getResource`/`getTable`/`listResources(false)`/`page.tsx` прямые `prisma.resource.findMany`), которые PR не редактирует; #674 не имеет отношения к POST create endpoint'ам.

## Качество кода
- TypeScript strict: OK (`npx tsc --noEmit` — чисто, `any` не встречается в новом коде)
- ESLint: OK (`npx eslint` по всем 12 изменённым файлам — без замечаний)
- Zod валидация: OK — `createResourceSchema`/`createTableSchema` (существовавшие, но не использовавшиеся до этого PR) теперь реально применяются через `.safeParse()`, ошибка → `apiValidationError()` → 422, тестами покрыто (`"отклоняет тело без названия — 422, сервис не вызван"` в обоих `route.test.ts`).
- API формат: OK — `apiResponse(resource, undefined, 201)` / `apiError` через `apiUnauthorized()`/`apiForbidden()`/`apiValidationError()`/`apiServerError()`, тот же паттерн, что у соседних `POST` create-роутов (`rental/*`, `gazebos/book`) и у PATCH-хендлеров тех же модулей.
- Архитектура: route handler делает ровно auth → RBAC → parse+validate → вызов сервиса → `logAudit` → ответ; бизнес-логика (`moduleSlug` — модульная константа, не из тела запроса; сериализация `metadata`) остаётся в `service.ts`, роут её не дублирует.
- Тесты: OK, `npm test -- --run` — 290 test files / 4023 tests, все зелёные. Новые тесты не тавтологичны: проверяют реальное поведение (401 без сессии, 403 без `canEditModule`, 422 при невалидном теле, 201 + вызов `createResource`/`createTable` с ожидаемыми полями, `logAudit` с корректным action-name, отсутствие утечки деталей 500-ошибки, minimal-payload с одним `name`). Компонентные тесты проверяют реальный собранный `fetch`-body (полную матрицу цен в `metadata.priceList`, отсутствие необязательных полей при их незаполнении). Сервисные тесты подтверждают, что `moduleSlug` жёстко `"gazebos"`/`"ps-park"` независимо от входа.

## Безопасность
- RBAC: OK — `canEditModule` даёt `true` для SUPERADMIN всегда (не strict-access модуль), для ADMIN — `true` через `isAdminEditableModule` (`gazebos`/`ps-park` оба в списке), для MANAGER — через `hasAdminSectionAccess` (нужен явный `AdminPermission`), для USER — всегда `false`. Это ровно та же функция, что и у PATCH — паритет с «редактированием сегодня» подтверждён кодом, не только по описанию.
- Проверил `auth.config.ts`: `isPublicApiRoute` покрывает `/api/gazebos`/`/api/ps-park` только для `GET` (`if (isPublicApiRoute && request.method === "GET") return true`), POST в `isPublicPostRoute` не входит → падает в общий `isApiRoute` fallback (только «есть валидная сессия», без проверки роли) → RBAC полностью на самом роуте, что и реализовано. Соответствует тому, как уже работает PATCH `/api/gazebos/:id` (тоже нет в public-route allowlist).
- `userId` для `logAudit` берётся из `session.user.id`, не из тела запроса.
- `moduleSlug` в `createResource`/`createTable` — захардкоженная модульная константа в `service.ts`, не принимается от клиента — исключает межмодульную путаницу ресурсов.
- Утечки данных: OK — 500-ветка не отдаёт детали ошибки (`apiServerError()` без stack trace), подтверждено тестом.
- Secrets leakage: `grep -riE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по фактическому 12-файловому диффу — 0 совпадений.
- Injection/XSS: нет raw SQL, нет `dangerouslySetInnerHTML`, всё через Prisma + React-рендеринг с автоэкранированием.
- Supply chain: новых зависимостей в `package.json` нет.

## Что хорошо
- Комментарии в `route.ts` explicit объясняют, почему POST не покрыт middleware-байпасом и почему нужен свой auth+RBAC — полезно для будущих ревьюеров/разработчиков.
- Тесты по обоим модулям построены зеркально (одинаковая структура describe/it), что облегчает поддержку симметрии между `gazebos` и `ps-park`.
- Сервисные тесты `createResource`/`createTable` явно проверяют, что `moduleSlug` не берётся из входных данных — закрывает потенциальный вектор межмодульной путаницы ресурсов до того, как он стал бы проблемой.
- PR не поддался соблазну «заодно» починить #675 (отсутствие `deletedAt: null` в read-путях) — корректно оставлено отдельной задачей, как и требует конвенция проекта.
