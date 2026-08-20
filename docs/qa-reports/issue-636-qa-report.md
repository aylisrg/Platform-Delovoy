# QA-отчёт: Issue #636 — `experimental.authInterrupts` для `forbidden()`

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-636-forbidden-auth-interrupts`, единственный коммит `5acfd9a` поверх `main`
  (`git log main..HEAD --oneline` → 1 коммит, `git diff main...HEAD --stat` → 1 файл, 6 insertions,
  0 deletions).
- Автообнаруженная prod-ERROR (fingerprint `4f1a0cae1b5d`, 1 occurrence, route `/admin/nedelovoy`):
  `forbidden()` is experimental and only allowed to be enabled when `experimental.authInterrupts`
  is enabled. Root cause: `next.config.ts` не включал `experimental.authInterrupts`, а `forbidden()`
  из `next/navigation` используется как RBAC-гейт в 15 файлах `src/app/admin/{cafe,rental,nedelovoy}/**`
  (issue насчитал 28 вызовов; собственный `grep -rn "forbidden()"` по тем же трём деревьям даёт 29
  вызовов в 16 файлах — расхождение на 1 файл/вызов, не влияет на вывод: фикс глобальный, конфиг-флаг
  не завязан на конкретное число сайтов, см. ниже).
- Code Reviewer уже вынес PASS (указано постановщиком задачи; артефакт `docs/qa-reports/issue-636-review.md`
  на диске отсутствует — очевидно, ревью оставлено как комментарий к PR, не файл). Ниже — независимая
  проверка: не просто чтение диффа, а фактическое поднятие собранного standalone-билда с реальными
  Postgres/Redis и живыми RBAC-сессиями, чтобы функционально прогнать сам баг, а не только конфиг.
- PRD не заводился — это точечный infra/config-фикс одного файла для уже зафиксированного прод-инцидента,
  не новая функциональность.

## Диф
```diff
+  experimental: {
+    // forbidden() (next/navigation) throws "is experimental and only
+    // allowed to be enabled when experimental.authInterrupts is enabled"
+    // without this — used across admin/{cafe,rental,nedelovoy}/**.
+    authInterrupts: true,
+  },
```
Ровно 1 файл (`next.config.ts`), 6 добавленных строк, 0 удалённых. Больше ничего в диффе нет —
подтверждено `git diff main...HEAD --stat` и полным `git diff main...HEAD` (единственный hunk).

## Регрессия
- `npm test -- --run`: **282 test files passed (282), 3946 tests passed (3946)**, 0 failed —
  прогнано дважды (до и после live-тестов ниже, между которыми временно откатывался конфиг для
  негативного контроля) — оба раза чисто.
- `npx tsc --noEmit`: чисто, пустой вывод.
- `npx next build` (Turbopack, `output: "standalone"`): **успешно, 237/237 статических страниц,
  0 build errors.** Единственные предупреждения — 4 pre-existing Turbopack warnings про
  `process.on(...)` в `src/instrumentation.ts` (Node API не поддержан в Edge Runtime) — не связаны
  с этим диффом, воспроизведены и в pre-fix билде (см. негативный контроль ниже), файл
  `instrumentation.ts` диффом не тронут.

## Build-log подтверждение флага (AC-адъект, п.3 задания)
Явная строка в выводе `npx next build`:
```
▲ Next.js 16.2.6 (Turbopack)
- Experiments (use with caution):
  ✓ authInterrupts
```
Флаг активен именно благодаря `next.config.ts` — при откате файла к состоянию `main` (см. негативный
контроль ниже) эта строка билд-лога исчезает, а `forbidden()` при вызове крашится в рантайме.

## Функциональная проверка в реальном окружении (не только build-log)
В задании явно разрешено ограничиться build-log + документацией, если живой прогон непрактичен —
но в этом окружении удалось поднять полноценный живой стек, поэтому проверено фактическое поведение
`forbidden()` под HTTP, а не только факт компиляции.

### Поднятое окружение
- `postgresql-16` (уже установлен в контейнере) — поднят `service postgresql start`, схема и сиды
  уже были применены в БД `delovoy_park` (5 существующих пользователей: `system`/SUPERADMIN,
  `admin@local`/SUPERADMIN, `manager@local`/MANAGER, `user@local`/USER + анонимный `system`).
- `redis-server --daemonize yes` — поднят локально.
- `npx next build` → `.next/standalone/server.js` запущен напрямую (`node server.js`,
  `NODE_ENV=production`, `AUTH_TRUST_HOST=true`, реальные `DATABASE_URL`/`REDIS_URL`/`AUTH_SECRET`)
  на `127.0.0.1:3999` — это тот же артефакт, который увидит прод (`output: "standalone"`, тот же
  Dockerfile-паттерн).
- Для двух RBAC edge-case сценариев (ниже) вручную заведены тестовые пользователи в БД и
  сгенерированы валидные NextAuth v5 JWT-сессии через `@auth/core/jwt` `encode()` с тем же секретом
  и той же солью (`salt: "authjs.session-token"`, cookie-имя по умолчанию для non-secure http),
  что и у `src/lib/auth.config.ts` — round-trip декодирования проверен отдельно перед тестами.
  Тестовые пользователи и их `ModuleAssignment` удалены из БД после тестов (`DELETE FROM ...` по
  их id), временные скрипты (`mint-session.mjs`, `roundtrip.mjs`, `getdebug.mjs`) удалены из
  рабочего дерева — `git status --short` после уборки пуст, `next.config.ts` восстановлен байт-в-байт
  к закоммиченному состоянию (нулевой diff).

### Почему нельзя было просто curl'ить анонимно
Первая попытка — анонимный `curl /admin/nedelovoy` — вернула `302 → /auth/signin`. Это **не** тест
самого `forbidden()`: middleware (`src/proxy.ts` + `authorized()` в `src/lib/auth.config.ts`,
код диффом не тронут) перехватывает полностью неаутентифицированные запросы к `/admin/:path*`
раньше, чем управление доходит до компонента страницы, где вызывается `forbidden()`. Чтобы реально
дойти до вызова `forbidden()`, нужен **аутентифицированный** пользователь, которому middleware
даёт пройти (валидная сессия, роль формально подходит), но page-level проверка (`hasAdminSectionAccess`
или дополнительная роль-проверка внутри страницы) отказывает — это ровно defense-in-depth сценарий,
из-за которого эти 16 файлов вообще вызывают `forbidden()` поверх уже отработавшего middleware.
Прочитан код `src/lib/auth.config.ts` и `src/lib/permissions.ts`, чтобы построить два реальных таких
сценария:

**Сценарий A** — MANAGER с middleware-грантом на секцию `rental` (JWT claim `adminSections: ["rental"]`,
проходит `authorized()`), но не SUPERADMIN → `/admin/rental/email-templates`, где
`page.tsx:13` — `if (!session?.user?.id || session.user.role !== "SUPERADMIN") forbidden();`
(этот доп. чек middleware не делает — там только проверка секции, не роли внутри секции).

**Сценарий B** — SUPERADMIN без явного `AdminPermission` на секцию `nedelovoy` → `/admin/nedelovoy`.
Это буквально прод-сценарий из issue: middleware пропускает любого SUPERADMIN блоком
`if (role === "SUPERADMIN") return true;`, но `nedelovoy` — единственный модуль в
`STRICT_ACCESS_MODULES` (`src/lib/permissions.ts:41`, задокументировано и в CLAUDE.md: «strict-access,
SUPERADMIN needs explicit grant»), поэтому page-level `hasAdminSectionAccess()` (`page.tsx:44`,
`if (!hasAccess) forbidden();`) требует отдельный `AdminPermission`-грант даже для SUPERADMIN.

### Результат — ПОСЛЕ фикса (текущий `next.config.ts` на ветке)
| Сценарий | HTTP status | Тело ответа | Server log |
|---|---|---|---|
| A: MANAGER → `/admin/rental/email-templates` | 200 (см. ниже про статус) | RSC-payload содержит `"title":"403: This page could not be accessed."`, `"digest":"NEXT_HTTP_ERROR_FALLBACK;403"`, `<meta name="robots" content="noindex"/>` — штатный билт-ин 403-бордер Next.js | пусто, ни одной строки ошибки |
| B: SUPERADMIN без гранта → `/admin/nedelovoy` | 200 | тот же штатный `NEXT_HTTP_ERROR_FALLBACK;403` boundary | пусто, ни одной строки ошибки |

**Про HTTP 200 вместо 403 в заголовке ответа**: это не баг и не результат этого PR. App Router
начинает стримить HTML-shell (layout) до завершения асинхронного рендера страницы (оба page-компонента
делают `await auth()` перед вызовом `forbidden()`), поэтому статус-код уже закоммичен в 200 к моменту
броска ошибки — сам Next.js передаёт результат клиенту через специальный digest в RSC-потоке
(`NEXT_HTTP_ERROR_FALLBACK;403`), а не через смену уже отправленного HTTP-статуса. Чтобы отделить
это от возможной регрессии, тем же способом проверен уже существующий, диффом не тронутый
`notFound()` (`src/app/admin/gazebos/bookings/[id]/page.tsx`, несуществующий id, SUPERADMIN-сессия):
тот же паттерн — `200` + `"digest":"NEXT_HTTP_ERROR_FALLBACK;404"`. Это подтверждает: 200-статус —
общее свойство всех App Router error-boundary функций (`notFound`/`forbidden`/`unauthorized`) в этой
кодовой базе, не специфика `authInterrupts`.

### Негативный контроль (доказательство причинности, не только корреляции)
Чтобы доказать, что именно этот флаг чинит именно эту ошибку (а не что-то ещё в окружении), файл
`next.config.ts` временно (только в рабочем дереве, не закоммичено) заменён на версию `main`
(`git show main:next.config.ts` — без блока `experimental`), пересобран (`npx next build`,
скомпилировался без ошибок — проверка флага чисто рантаймовая, не влияет на билд), сервер
перезапущен на том же порту с тем же тестовым пользователем (сценарий B):

```
HTTP/1.1 200 OK          ← тот же псевдо-200 по стриминговой причине выше
...тело ответа...
```
Но **в теле ответа уже нет `NEXT_HTTP_ERROR_FALLBACK;403`** — вместо штатного 403-бордера клиент
получает общий fallback `"404 / Страница не найдена / Такой страницы не существует..."` (глобальный
error-boundary приложения), а **в server log сервера** — ровно та ошибка из issue, дословно:
```
⨯ Error: `forbidden()` is experimental and only allowed to be enabled when `experimental.authInterrupts` is enabled.
    at v (.next/server/chunks/ssr/src_app_admin_nedelovoy_page_tsx_0kb8qlk._.js:1:613) {
  digest: '2093058042@E488'
}
```
Один в один воспроизведён прод-инцидент (fingerprint `4f1a0cae1b5d`). После этого `next.config.ts`
восстановлен из git (`cp` сохранённой версии с ветки, финальная проверка — нулевой `git diff` к
закоммиченному состоянию), сервер пересобран (`npx next build` снова показывает
`✓ authInterrupts` в логе), `npm test`/`tsc --noEmit` перепрогнаны начисто (см. «Регрессия» выше).

**Вывод по функциональной проверке**: причинность доказана в обе стороны — без флага `forbidden()`
детерминированно крашится с текстом из issue и деградирует до общего fallback вместо 403; с флагом —
детерминированно рендерит штатный Next.js 403-бордер (`NEXT_HTTP_ERROR_FALLBACK;403`, заголовок
"403: This page could not be accessed.", `robots: noindex`) без единой строки в server log.

## Проверка «флаг ничего больше не меняет» (п.4 задания)
Прочитаны бандлированные доки Next.js в `node_modules/next/dist/docs/`:
- `01-app/03-api-reference/05-config/01-next-config-js/authInterrupts.md` — «The `authInterrupts`
  configuration option allows you to use `forbidden` and `unauthorized` APIs in your application.»
  — единственное описанное назначение.
- `01-app/03-api-reference/04-functions/forbidden.md` — подтверждает то же самое: без флага —
  экспериментальная ошибка, с флагом — штатный 403-boundary. Никаких других побочных эффектов не
  задокументировано.
- В коде: `node_modules/next/dist/server/config-schema.js:393` — `authInterrupts: z.boolean().optional()`,
  простое булево поле схемы конфига, без побочных зависимостей от других опций. В
  `node_modules/next/dist/server/base-server.js:396` — `authInterrupts: !!this.nextConfig.experimental.authInterrupts`
  прокидывается ровно в один плейсхолдер рендер-опций (тот, что читают `forbidden()`/`unauthorized()`).
  Больше нигде в дереве `next/dist` этот флаг не используется как условие для чего-либо ещё
  (`grep -rl authInterrupts node_modules/next` — все совпадения это либо d.ts-типы, либо .map-файлы,
  либо тот самый единственный runtime-путь).

Вывод: флаг чисто аддитивный, включает ровно `forbidden()`/`unauthorized()`, никакого другого
поведения сборки/рантайма не меняет.

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `forbidden()` больше не бросает ошибку "is experimental..." — рендерит штатную 403-страницу Next.js | PASS | Подтверждено вживую на собранном standalone-билде в двух реальных RBAC edge-case сценариях (MANAGER без прав на SUPERADMIN-only подстраницу; SUPERADMIN без явного гранта на strict-access модуль `nedelovoy` — буквально прод-сценарий инцидента): тело ответа содержит штатный `NEXT_HTTP_ERROR_FALLBACK;403` boundary, server log чист. Негативный контроль (временный откат конфига к `main`) на том же стенде воспроизвёл исходную ошибку дословно и деградацию до общего fallback вместо 403 — доказана причинность, не только корреляция. |
| 2 | RBAC-логика (кто именно получает отказ) не изменена — это чисто рендеринг/инфраструктурный фикс | PASS | Диф — исключительно `next.config.ts`. Спот-чек 3 файлов (`nedelovoy/page.tsx`, `cafe/stats/page.tsx`, `rental/email-templates/page.tsx`, см. ниже) — `git diff main...HEAD -- <файл>` даёт 0 строк на всех троих: код RBAC-проверок байт-в-байт идентичен `main`. Более того, живой прогон подтвердил: условия `if (!session?.user?.id) forbidden()`, `if (!hasAccess) forbidden()`, `if (role !== "SUPERADMIN") forbidden()` в этом PR продолжают отказывать ровно тем же пользователям, что и раньше — просто без краша. |
| 3 | Нет регрессий в другом месте (тесты, типы, сборка — всё зелёное) | PASS | `npm test -- --run`: 282/282 файлов, 3946/3946 тестов — прогнано дважды, оба раза чисто. `npx tsc --noEmit`: чисто. `npx next build`: 237/237 страниц, 0 ошибок, лог явно показывает `✓ authInterrupts`. |

## Спот-чек RBAC-логики в 3 файлах (не тронуто диффом)
- `src/app/admin/nedelovoy/page.tsx:42-44` — `if (!session?.user?.id) forbidden(); const hasAccess = await hasAdminSectionAccess(session.user.id, "nedelovoy"); if (!hasAccess) forbidden();`
- `src/app/admin/cafe/stats/page.tsx:66-68` — `if (!session?.user?.id) forbidden(); const ok = await hasAdminSectionAccess(session.user.id, "cafe"); if (!ok) forbidden();`
- `src/app/admin/rental/email-templates/page.tsx:13` — `if (!session?.user?.id || session.user.role !== "SUPERADMIN") forbidden();`

Все три условия используют уже существующие, ранее одобренные хелперы (`hasAdminSectionAccess` из
`@/lib/permissions`, прямая проверка `role`) — ни одна строка условия не добавлена/убрана этим PR.
`git diff main...HEAD -- <каждый файл>` подтверждает нулевой diff на всех троих напрямую (не со
слов Reviewer'а).

## Security-чеклист (функциональный, из agents/qa.md / SECURITY.md)
- [x] **RBAC под разными ролями** — прогнано вживую, не только по коду: анонимный запрос → 302 на
  `/auth/signin` (middleware, не тронут); авторизованный MANAGER без нужной секции/роли на
  подстранице → 403-бордер (`forbidden()`, этот фикс); авторизованный SUPERADMIN без explicit-гранта
  на strict-access модуль `nedelovoy` → 403-бордер. Ни один из этих сценариев не даёт доступ к
  контенту страницы — деградация только в сторону 500→403 (более информативно и корректно с точки
  зрения HTTP-семантики), не в сторону ослабления прав.
- [x] **Data leakage** — прогнанные 403-ответы не содержат ни контента защищённых страниц, ни stack
  trace, ни путей файлов (production-режим, `NODE_ENV=production` при сборке и запуске standalone).
  Pre-fix (негативный контроль) ответ клиенту тоже не содержал stack trace/путей — Next скрывает их
  в production даже для необработанных ошибок; но UX хуже (общий fallback вместо точного 403) и в
  server log 500-класса ошибка логируется без структурированного контекста, что и стало причиной
  автообнаружения этого issue как ERROR в `SystemEvent`.
- [x] **Секретов/токенов в диффе нет** — `grep -rniE '(password|token|secret|nextauth|telegram_.*token|api[_-]key)' next.config.ts` находит 0 совпадений; сам дифф — 6 строк булевого конфиг-флага и комментария.
- [x] Rate limiting / input validation — неприменимо к этому диффу (не API-роут, не форма ввода).

Security-блокеров нет.

## Edge cases
- Полностью анонимный запрос к `/admin/nedelovoy` — не доходит до `forbidden()` вообще (перехватывается
  middleware раньше), проверено отдельно (302 → `/auth/signin`), поведение не изменилось этим PR.
- USER-роль на `/admin/*` — по коду `authorized()` (`src/lib/auth.config.ts:223-225`) редиректит на
  `/admin/forbidden` (отдельная statically-known страница, не `forbidden()` из `next/navigation`) —
  этот путь тоже не тронут диффом и не завязан на `authInterrupts`.
- Build-time поведение флага (не влияет на компиляцию) — подтверждено: и pre-fix, и post-fix конфиг
  дают `✓ Compiled successfully`, различие проявляется только в рантайме при фактическом вызове
  `forbidden()`.
- Повторный `npm test`/`tsc` после уборки временных тестовых артефактов (пользователей в БД, скриптов
  в рабочем дереве, восстановления `next.config.ts`) — оба раза чисто, репозиторий оставлен в исходном
  состоянии (`git status --short` пуст, единственный коммит на ветке не изменён).

## Scope check
- Изменён ровно один файл (`next.config.ts`), ровно один аддитивный блок конфига.
- Ни один из 16 файлов, использующих `forbidden()`, не тронут — фикс глобальный через конфиг, как и
  заявлено в issue («Single global config flag — fixes all 28 call sites at once, no per-file changes
  needed»; фактическое число (29/16) отличается от заявленного (28/15) на единицу, но не меняет сути:
  фикс не зависит от точного количества сайтов вызова).
- Ветка содержит ровно 1 коммит поверх `main`.

## Итог
- Всего AC: 3
- PASS: 3
- FAIL: 0
- Security-кейсы: RBAC под всеми проверенными ролями (аноним / MANAGER без прав / SUPERADMIN без
  explicit-гранта strict-access модуля) — поведение корректно и не ослаблено, нарушений не найдено
- `npm test` (282/282 файлов, 3946/3946 тестов, дважды подряд), `tsc --noEmit`, `next build`
  (237/237 страниц, `✓ authInterrupts` в логе) — всё чисто
- Функционально прогнан сам баг на собранном standalone-билде с реальными Postgres/Redis и живыми
  NextAuth-сессиями (не только build-log): 2 реальных RBAC edge-case сценария, включая точный
  прод-сценарий инцидента (SUPERADMIN без гранта на strict-access `nedelovoy`) — оба корректно
  рендерят штатный Next.js 403-бордер вместо краша
- Негативный контроль (временный откат `next.config.ts` к состоянию `main`, без коммита) на том же
  стенде дословно воспроизвёл исходную prod-ошибку — причинность фикса доказана, не только заявлена
- Документация Next.js (`node_modules/next/dist/docs/`) и код `config-schema.js`/`base-server.js`
  подтверждают: флаг чисто аддитивный, включает только `forbidden()`/`unauthorized()`, ничего другого
  не меняет
- RBAC-логика (условия отказа) во всех спот-проверенных файлах — байт-в-байт идентична `main`
- Рабочее дерево и БД возвращены в исходное состояние после live-тестов; финальный `git diff main...HEAD --stat` — `next.config.ts | 6 ++++++`, ничего больше

**Вердикт: PASS.** Диф хирургический и в точности соответствует описанию issue #636. Фикс не просто
скомпилирован — функционально прогнан на живом стеке в двух реальных RBAC-сценариях, включая точный
сценарий прод-инцидента, с негативным контролем, доказывающим причинность. RBAC-логика не изменена
ни в одном из проверенных файлов. Регрессий нет. Security-кейсы пройдены под всеми применимыми ролями.
Замечаний нет.
