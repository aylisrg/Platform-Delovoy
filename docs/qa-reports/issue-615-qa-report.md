# QA-отчёт: Issue #615 — dev-seed `manager@local` не получал `AdminPermission`, редиректило на `/admin/forbidden`

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-615-dev-seed-admin-permission`, коммит `ac9dd54`, поверх `main`.
- `git diff main...claude/issue-615-dev-seed-admin-permission --stat`: **3 файла**, `+93/-4`:
  `scripts/seeds/dev-overlay.ts`, `scripts/seeds/__tests__/dev-overlay.test.ts` (новый),
  `scripts/seeds/__tests__/fake-prisma.ts`. Ни одного файла в `src/app/api/**`, `prisma/schema.prisma`,
  роутов или auth-конфига — чистый dev-tooling seed-скрипт, RBAC-поверхность продакшена не затронута.
- Формальной PRD в `docs/requirements/` нет (баг-фикс dev-инструмента, не фича) — эталон: текст issue
  #615, как задано в постановке задачи. `docs/qa-reports/issue-615-review.md` не найден — учитывать
  нечего, использована собственная независимая проверка (как и просила постановка задачи).

## Регрессия
```
npm test -- --run                 → 270 test files, 3825/3825 passed, 0 failed  (= заявленная база)
npx tsc --noEmit                  → чисто, пустой вывод
npm run lint                      → 0 errors, 16 warnings — все pre-existing, идентичный список файлам
                                     из отчёта issue-614 (session-bill-modal.tsx, sidebar.tsx,
                                     vk-community-banner.tsx, ChatWindow.tsx, useChatList.ts,
                                     messenger/types.ts, notifications/service.ts,
                                     telephony/novofon-client.ts) — ни один не в изменённых файлах PR
npx vitest run scripts/seeds      → 3 test files, 14/14 passed (core.test.ts 5, tasks.test.ts 6,
                                     dev-overlay.test.ts 3 — все 3 новых теста зелёные)
```
Числа полностью совпадают с заявленной базовой линией (~3825/0/16).

**`scripts/` вне `tsconfig.json`** — независимо проверено: `tsconfig.json` содержит
`"exclude": ["node_modules", "scripts", "bot", "landing-delovoy-park.ru"]`, файл не тронут этим диффом
(`git diff main...claude/issue-615-dev-seed-admin-permission -- tsconfig.json` пуст, последний коммит,
трогавший файл — `a61c30a`, не относится к #615). Отдельного `scripts/tsconfig.json` или CI-шага
`tsc` для `scripts/` нет (`grep` по `.github/workflows/*.yml` и `package.json` — пусто). Это
подтверждённый pre-existing гэп, не внесённый этим PR.

## Acceptance Criteria (из текста issue #615)

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `dev-overlay.ts` создаёт идемпотентные `AdminPermission` для `manager@local` рядом с уже существующим `ModuleAssignment` | PASS | `dev-overlay.ts:97-104` — цикл `prisma.adminPermission.upsert({ where: { userId_section: {...} }, create, update: {} })` по `["dashboard","gazebos","ps-park"]`. `upsert` с пустым `update: {}` — идемпотентен по конструкции (create при отсутствии, no-op при наличии). Независимо подтверждено тестом `idempotency: double invocation does not duplicate AdminPermission rows` (зелёный) и собственным adversarial-тестом (раздел ниже). |
| 2 | Разобраться, нужна ли секция `dashboard` для попадания на `/admin/ps-park`/`/admin/gazebos` | PASS | Независимо, без доверия к выводам ревью, прошёл всю цепочку сам (см. отдельный раздел ниже). Вывод: для **практического** пути входа (`manager@local`/`manager` через `/auth/signin` → credentials-провайдер) секция `dashboard` **действительно обязательна**, а не просто «хорошая практика» — `redirectAfterLogin()` в `src/app/auth/signin/page.tsx:37` безусловно шлёт на `/admin/dashboard` при role∈{SUPERADMIN,ADMIN,MANAGER}, без учёта `callbackUrl`. Без гранта на `dashboard` первый же редирект после логина упирается в `/admin/forbidden`, что и было исходным багом. |
| 3 (implicit) | Документированные dev-креды `manager@local`/`manager` больше не редиректят на `/admin/forbidden` ни на одной `/admin/*` странице | PASS | До фикса секция `AdminPermission` для manager@local не создавалась вовсе (0 записей) → **любая** `/admin/*` страница (включая `/admin/dashboard`, куда ведёт вход) редиректила на `/admin/forbidden` — воспроизводит текст issue "on any /admin/* page". После фикса — 3 секции гранта (`dashboard`, `gazebos`, `ps-park`) точно соответствуют тем модулям, к которым manager@local имеет `ModuleAssignment`. |
| 4 (CLAUDE.md Dev rules) | Тесты обязательны в том же коммите — новая логика сидера покрыта | PASS | `dev-overlay.test.ts` — первое тестовое покрытие этого сидера вообще (0 тестов до PR). 3 теста: грант 3 секций + соответствие `ModuleAssignment`, идемпотентность двойного вызова, no-op при `DEV_OVERLAY !== "1"`. Все зелёные, включая мой независимый прогон. |

## Независимая трассировка auth-flow (не поверил выводам ревью — перечитал сам)

Прочитал: `src/app/admin/page.tsx`, `src/lib/auth.config.ts` (`getAdminSection()`, `authorized()`),
`src/lib/auth.ts` (заполнение `adminSections` в JWT), `src/lib/permissions.ts`
(`hasAdminSectionAccess`, `getUserAdminSections`) — и добавил от себя `src/app/auth/signin/page.tsx`
(`redirectAfterLogin`) и `src/app/auth/redirect/page.tsx`, поскольку именно это определяет, куда
реально попадает пользователь сразу после логина.

1. `src/app/admin/page.tsx` — `export default function AdminPage() { redirect("/admin/dashboard"); }`.
   `/admin` без сегмента всегда редиректит на `/admin/dashboard`.
2. `auth.config.ts:210-211` — `getAdminSection("/admin")` возвращает `null` (regex требует `/` после
   `admin`), поэтому middleware пропускает голый `/admin` (`if (!section) return true; // /admin root
   — redirect will handle`) — сам гейт на `dashboard` срабатывает на **следующем** запросе, когда
   браузер после `redirect()` реально идёт на `/admin/dashboard`.
3. `auth.config.ts:209-220` — для role `MANAGER`/`ADMIN`: `section = getAdminSection(pathname)`,
   `if (!adminSections.includes(section)) return Response.redirect(".../admin/forbidden")`. Для
   `pathname = "/admin/dashboard"` секция — `"dashboard"`.
4. `auth.ts:79-115` (`jwt` callback) — при логине (`user` truthy) для `role === MANAGER`:
   `result.adminSections = permissions.map(p => p.section)`, где `permissions =
   prisma.adminPermission.findMany({ where: { userId } })` — **напрямую** из таблицы
   `AdminPermission`, ничего кроме неё. `permissions.ts::hasAdminSectionAccess`/`getUserAdminSections`
   подтверждают то же: для `MANAGER` explicit `AdminPermission`-запись обязательна, `ModuleAssignment`
   в этой проверке вообще не участвует.
5. **Ключевое звено, которое я добавил сам** — как реально попадает `manager@local` на
   `/admin/dashboard`: `src/app/auth/signin/page.tsx:32-41`, функция `redirectAfterLogin()`
   (используется `handlePasswordLogin` — это и есть путь входа по email+паролю, ровно тот, которым
   логинится `manager@local`/`manager`): `if (role === "SUPERADMIN" || role === "ADMIN" || role ===
   "MANAGER") window.location.href = "/admin/dashboard";` — **безусловно**, без учёta `callbackUrl` (в
   отличие от соседнего `/auth/redirect/page.tsx`, который используется только для magic-link/OAuth
   и **там** `callbackUrl` учитывается). Т.е. credentials-логин **гарантированно** проходит через
   `/admin/dashboard` первым делом — обойти это бухгалтерским способом (сразу открыть
   `/admin/ps-park` в закладке) в принципе возможно, но это не тот путь, которым по документации
   пользуются dev-креды (`manager@local` / `manager` через форму входа).

**Вывод по AC-2**: если бы кто-то зашёл в систему заранее (сессия уже есть) и открыл закладку сразу
на `/admin/ps-park`, `dashboard` в `adminSections` для этого конкретного запроса не требуется —
`getAdminSection("/admin/ps-park") === "ps-park"`, и этой секции достаточно. Но для **самого**
процесса логина (единственный практический сценарий использования этих dev-credentials) секция
`dashboard` обязательна, не опциональна — без неё первый экран после входа тут же формирует
`/admin/forbidden`, воспроизводя ровно то, что описано в issue. Включение `dashboard` в грант —
правильное, обоснованное решение, а не избыточная предосторожность.

## Adversarial / mutation-тестирование (собственное, независимое от ревью)

Ревью уже делало mutation-test (убрал цикл AdminPermission → тест падает). Я сделал три **своих**
адверсариальных сценария поверх `fake-prisma.ts`-харнесса (временный файл
`scripts/seeds/__tests__/dev-overlay.qa-adversarial.test.ts`, прогнан, удалён после — `git status`
чистый):

1. **Модули ещё не существуют в БД** (`prisma.module` пуст перед вызовом seedDevOverlay) →
   `ModuleAssignment` корректно **не создаётся** (0 записей, цикл идёт по реально найденным `modules`),
   но `AdminPermission` **всё равно** гранутся все 3 секции (`dashboard/gazebos/ps-park`) — цикл
   AdminPermission идёт по статическому массиву `targetAdminSections = ["dashboard",
   ...targetModuleSlugs]`, а не по фактически найденным в БД `modules`. **Находка** (см. ниже) —
   не блокирует вердикт, см. обоснование.
2. **Частичное состояние**: только `gazebos`-модуль существует, `ps-park` — нет → `ModuleAssignment`
   создаётся только для `gazebos` (1 запись), но `AdminPermission` всё равно грантит обе секции
   (`gazebos` и `ps-park`) — то же расхождение, тот же паттерн.
3. **Предсуществующий ручной грант не должен стираться**: создал вручную
   `AdminPermission{userId: manager.id, section: "cafe"}` **между** двумя вызовами `seedDevOverlay`
   (симулирует разработчика, вручную выдавшего себе доступ к ещё одной секции для локальной отладки) →
   после повторного запуска сидера секции = `["cafe", "dashboard", "gazebos", "ps-park"]` — секция
   `cafe` **не стёрлась**. Цикл использует `upsert` по целевым секциям, никогда не вызывает
   `deleteMany`/`setUserAdminSections` (это отдельная функция в `permissions.ts`, которую сидер не
   использует) — чисто аддитивен. Правильное поведение, никакого риска потери ручного доступа
   разработчика.

**Находка (не блокирует PASS, minor):** грант `AdminPermission` на `gazebos`/`ps-park` не проверяет,
существуют ли соответствующие `Module`-записи в БД (в отличие от `ModuleAssignment`, который корректно
это проверяет через `modules` — результат `findMany`). На практике это не создаёт проблему: в
единственном реальном пути вызова (`scripts/seed.ts`) `seedCore(prisma)`, регистрирующий модули
`gazebos`/`ps-park` (оба ✅-статус в CLAUDE.md), **всегда** выполняется раньше `seedDevOverlay(prisma)`
(порядок: `seedParks → seedCore → seedTasks → seedNedelovoyGrants → [DEV_OVERLAY] seedDevOverlay`) —
поэтому на момент реального запуска модули уже существуют. Риск чисто теоретический (проявился бы,
только если кто-то вызовет `seedDevOverlay()` изолированно, в обход оркестратора) и не связан с
сутью issue #615 (баг был про отсутствие `AdminPermission` вообще, этот фикс его решает полностью).
Не завожу как отдельный баг-репорт — не паттерн, а узкая архитектурная деталь без наблюдаемых
последствий при текущем единственном способе вызова.

## Проверка wiring (не мёртвый код)
`scripts/seed.ts:25,35-36` — `import { seedDevOverlay } from "./seeds/dev-overlay"` и
`if (process.env.DEV_OVERLAY === "1") { await seedDevOverlay(prisma); }` — этот код **не входит** в
диф PR (уже существовал на `main`), подтверждает, что фикс не создаёт новую точку вызова, а чинит уже
подключённый путь. `grep -rn "DEV_OVERLAY"` по `.github/workflows/*.yml`, `docker-compose*.yml`,
`.env.example` → единственное совпадение — `.github/workflows/ci.yml:147` (`DEV_OVERLAY: "1"` в
e2e-job с одноразовым `postgres:16-alpine` service-контейнером, живущим только на время прогона). Не
в `deploy.yml`, не в docker-compose — сидер не запускается автоматически ни на staging, ни на проде.

## RBAC / Security
- **DEV_OVERLAY-гейт не тронут диффом**: `if (process.env.DEV_OVERLAY !== "1") return;` и
  `if (env === "production") { console.warn(...); return; }` — оба guard'а в `dev-overlay.ts:24-33`
  вне диффа (проверено `git diff` — правки только строки 9-10 докстринга и 92-105 добавления цикла).
- **Проверил риск «широкие admin-секции MANAGER-сидовому аккаунту в общем staging БД»
  (`CLAUDE.md`-упомянутый `src/lib/staging-guard.ts`/`proxy.ts`)**:
  - `src/proxy.ts:16-31` подключает `enforceStagingRoleCheck` для ЛЮБОГО запроса под матчером
    `/admin/:path*` и большинства `/api/*` (кроме `auth`/`health`).
  - `staging-guard.ts::enforceStagingRoleCheck` — на staging (`isStaging()===true`) **любой**
    mutating-метод (`POST/PATCH/PUT/DELETE`) от не-`SUPERADMIN` получает `403 STAGING_READ_ONLY`,
    независимо от `AdminPermission`/`ModuleAssignment`. Значит, даже с новым, более широким набором
    admin-секций `manager@local` **не может** ничего мутировать на staging — этот PR расширяет только
    READ-доступ к UI-разделам, а не реальные права на изменение данных на staging.
  - Сам сидер (`dev-overlay.ts`) по докстрингу и так предназначен именно для запуска "after
    db:pull-prod... in dev/staging" — т.е. появление `manager@local` на staging-БД — намеренное,
    задокументированное поведение самого инструмента, не новый риск, введённый этим PR. Этот PR лишь
    делает уже заложенный уровень доступа (`ModuleAssignment` на `gazebos`/`ps-park`, существовавший
    до фикса) реально функциональным в UI, не расширяя его за пределы исходного намерения.
- **Проверил, не течёт ли что-то чувствительное через новую секцию `dashboard`**: прочитал
  `src/app/admin/dashboard/page.tsx` — код страницы не тронут этим PR, отдаёт только агрегированные
  счётчики (`activeModules`, `totalModules`, `bookingsToday` по gazebos+ps-park, `ordersToday` по
  кафе) — ни PII, ни детализированных записей. Плитки "Быстрый доступ" ведут на `/admin/architect`,
  `/admin/modules`, `/admin/monitoring`, `/admin/users` — это просто ссылки; переход по ним для
  `manager@local` упрётся в тот же `authorized()`-гейт и `/admin/forbidden`, поскольку этот PR **не**
  грантит эти секции. Эскалации прав нет.
- Нет ни одного нового API route, ни изменений в `auth.ts`/`auth.config.ts`/`proxy.ts`/
  `prisma/schema.prisma` — обязательные функциональные security-кейсы из `agents/qa.md`
  (RBAC/rate-limiting/input-validation/data-leakage) к продовой поверхности неприменимы, диффом
  подтверждено (3 файла, все в `scripts/seeds/`, чисто dev-tooling).

## Что не проверено (честно)
Живого запуска `npx tsx scripts/seed.ts` с `DEV_OVERLAY=1` против настоящей Postgres и последующего
браузерного логина `manager@local`/`manager` не делал — только через `fake-prisma`-харнесс (юнит-тест
уровень) и статическое чтение кода auth-flow. Это ограничение симметрично отчёту issue-614 (там тоже
не было живого браузера) — компенсировано полной трассировкой реального пути данных
(`AdminPermission` → `jwt callback` → `session.user.adminSections` → `authorized()`) от таблицы БД до
middleware-решения, плюс собственными adversarial-тестами поверх той же бизнес-функции, что вызывает
реальный `PrismaClient` в проде (сигнатура `seedDevOverlay(prisma: PrismaClient)` идентична и в тесте,
и в `scripts/seed.ts`).

## Итог
- AC (из текста issue #615 + implicit): 4
- PASS: 4
- FAIL: 0
- Регрессия: `npm test` 3825/3825, `npx tsc --noEmit` чисто, `npm run lint` 0 ошибок / 16 pre-existing
  предупреждений (совпадает с базовой линией issue-614), `npx vitest run scripts/seeds` 14/14
  (включая 3 новых теста).
- `scripts/` вне `tsconfig.json` — независимо подтверждено как pre-existing, не внесено этим PR.
- Независимая трассировка auth-flow подтверждает: секция `dashboard` **обязательна** для практического
  сценария входа `manager@local`/`manager` (credentials-логин безусловно ведёт на `/admin/dashboard`
  первым делом) — включение её в грант обоснованно, не избыточно.
- Собственное adversarial-тестирование (не переиспользование тестов ревью): пре-грант не стирается при
  повторном запуске, `ModuleAssignment` корректно пропускает отсутствующие модули. Найдена одна minor
  архитектурная асимметрия (AdminPermission на gazebos/ps-park не проверяет существование Module-строки
  в БД, в отличие от ModuleAssignment) — не блокирует вердикт: не наблюдаема при единственном реальном
  пути вызова (`seedCore` всегда раньше `seedDevOverlay` в `scripts/seed.ts`), не патtern для
  qa-patterns.md (узкая деталь одного сидера, не воспроизводимая логика).
- Wiring подтверждён живым: `scripts/seed.ts` уже (до этого PR) вызывает `seedDevOverlay` условно на
  `DEV_OVERLAY=1`; единственное реальное включение — эфемерная БД в `ci.yml` e2e-джобе, ни в
  `deploy.yml`, ни в docker-compose, ни в `.env.example`.
- RBAC/security: dev-only путь за двумя guard'ами (`DEV_OVERLAY=1` + `NODE_ENV!=production`), не
  тронутыми диффом; staging-guard (`enforceStagingRoleCheck`) даёт независимый уровень защиты — даже
  на staging-БД (куда сидер намеренно предназначен для запуска) `manager@local` не может мутировать
  данные без SUPERADMIN, только читать UI-разделы, к которым уже был `ModuleAssignment` до фикса.

**Вердикт: PASS.** Фикс решает заявленную в issue #615 проблему: `manager@local` больше не редиректится
на `/admin/forbidden` при первом же заходе после логина, поскольку теперь получает `AdminPermission` на
`dashboard`/`gazebos`/`ps-park` идемпотентно, в соответствии с уже существующими `ModuleAssignment`.
Включение секции `dashboard` подтверждено как объективно необходимое (не просто удобство) —
независимая трассировка полного пути логина показывает, что credentials-вход безусловно приводит на
`/admin/dashboard` первым экраном. Тесты содержательны (первое покрытие сидера), идемпотентность и
аддитивность (не стирает чужие ручные гранты) подтверждены собственным adversarial-тестированием, а не
просто повторным прогоном тестов из PR. Регрессий нет, RBAC/security-поверхность продакшена не
затронута, единственная находка — незначительная и не воспроизводимая при текущем реальном пути вызова.
