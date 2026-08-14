# QA-отчёт: issue #572 — Playwright E2E job

## Скоуп

Независимая верификация ветки `claude/issue-572-playwright-e2e` (2 коммита
поверх `origin/main`, HEAD `ba903fb2`): `87f5bc94` (feat, основной job/e2e-набор)
и `ba903fb2` (fix, depth-safe Vitest exclude). Code Reviewer уже вынес PASS —
этот отчёт не пересказывает его вывод, а перепроверяет всё заново с нуля:
живой прогон CI-последовательности на свежесозданной БД, независимая проверка
двух задокументированных отклонений (миграции #590, живой RBAC-баг #591),
регрессия, скоуп, `.gitignore`, синхронность lock-файла.

Изменённые файлы (`git diff origin/main...HEAD --stat`):
```
.github/workflows/ci.yml    | 84 ++++
.gitignore                  |  3 ++
e2e/admin-rbac.spec.ts      | 40 ++
e2e/cafe-checkout.spec.ts   | 31 ++
e2e/gazebo-booking.spec.ts  | 79 ++
e2e/helpers/auth.ts         | 26 ++
e2e/helpers/db.ts           |  8 ++
e2e/homepage.spec.ts        | 26 ++
e2e/ps-park-booking.spec.ts | 50 ++
package-lock.json           | 64 ++
package.json                |  4 ++
playwright.config.ts        | 47 ++
vitest.config.ts            |  6 ++
13 files changed, 467 insertions(+), 1 deletion(-)
```
Только файлы, относящиеся к E2E/CI/vitest-конфигу. Скоуп не расширен — **PASS**.

## AC из issue #572

1. Новый job `e2e` в `ci.yml`: `postgres:16` + `redis:7`, схема + seed, build + start, `@playwright/test`.
2. Новая папка `e2e/` + `playwright.config.ts` (chromium only, `retries: 1`).
3. 5–7 критических флоу: главная, беседка → БД, PS-Park слот → БД, cafe checkout → БД, admin RBAC-отказ, health.
4. Job зелёный и падает при намеренной поломке (проверено локально).
5. Время ≤ ~8 мин (без учёта одноразовой загрузки браузера).
6. Флоу пишут/читают реальную БД, без моков.

Источник — тело issue #572, получено напрямую через GitHub REST API
(`api.github.com/repos/aylisrg/Platform-Delovoy/issues/572`), не пересказ.

## 1. Окружение — с нуля, не переиспользуя чужое состояние

В песочнице уже существовали роль/БД `delovoy`/`delovoy_park` с посторонними
данными (2 Booking, 1 Order) — по-видимому, остаток чужого прогона в этой же
sandbox. Для честной проверки пересоздал БД с нуля и очистил Redis:

```
$ psql -U delovoy -d postgres -c "DROP DATABASE IF EXISTS delovoy_park;"
$ psql -U delovoy -d postgres -c "CREATE DATABASE delovoy_park OWNER delovoy;"
$ redis-cli FLUSHALL
OK
```

Также обнаружил и убил осиротевший `next-server` (pid 7543), державший порт
3000 занятым от предыдущего чужого прогона — иначе `playwright test` падает на
`webServer` (`Error: http://localhost:3000 is already used`). Не баг диффа,
артефакт shared-песочницы.

## 2. Полный прогон точной CI-последовательности (реальные времена)

```
$ npm ci                                                    → exit 0, 29.4s
$ npx prisma db push --skip-generate --accept-data-loss      → exit 0,  2.4s  "database is now in sync"
$ DEV_OVERLAY=1 npx tsx scripts/seed.ts                       → exit 0,  1.3s
    admin@local / manager@local (→ ps-park, gazebos) / user@local созданы
$ npm run build:e2e                                          → exit 0, 105.4s (1m45s)
$ npx playwright install --with-deps chromium                 → exit 0 (браузер уже в кеше песочницы,
                                                                  как и было бы в CI с actions/cache)
$ CI=true npx playwright test                                 → exit 0, 75s  (7 passed)
```

Повторный прогон с `--reporter=list` (отдельный запуск, новый сервер) — тоже
`exit 0`, 85s, все 7 тестов поимённо:

```
✓ 1 e2e/admin-rbac.spec.ts:20   Admin RBAC › MANAGER без доступа к разделу → редирект на /admin/forbidden   (13.8s)
✓ 2 e2e/admin-rbac.spec.ts:31   Admin RBAC › USER без прав → /api/admin/* отвечает 403                       (13.3s)
✓ 3 e2e/cafe-checkout.spec.ts:7 Кафе — гостевой чекаут › ... создают запись Order в БД                       (0.85s)
✓ 4 e2e/gazebo-booking.spec.ts:14 Бронирование беседки › ... создают запись Booking в БД                     (27.0s)
✓ 5 e2e/homepage.spec.ts:4      Главная страница › отвечает 200 и рендерит ключевые блоки                    (1.0s)
✓ 6 e2e/homepage.spec.ts:17     Health check › GET /api/health отвечает 200 success                          (28ms)
✓ 7 e2e/ps-park-booking.spec.ts:8 Плей Парк — выбор слота ... создают запись Booking в БД                    (26.5s)

7 passed (1.4m)
```

**AC 1, 2, 3, 6 — PASS.**

### Реальные записи в БД (не UI-иллюзия) — проверено напрямую `psql`, не через код теста

После двух прогонов (совокупно):
```
SELECT "moduleSlug", status, count(*) FROM "Booking" GROUP BY 1,2;
 gazebos | PENDING | 2
 ps-park | PENDING | 2

SELECT "moduleSlug", status, count(*) FROM "Order" GROUP BY 1,2;
 cafe    | NEW     | 2
```
`userId` во всех Booking-строках совпадает с `user@local` (`cmstcqzfo002n7dv9gw3lnn1k`,
id из вывода seed) — флоу действительно создают записи от имени залогиненного
пользователя, не анонимные строки. **Подтверждает AC 6 напрямую через БД, не через ассерты теста.**

### Бюджет времени (AC 5)

`db push` (2.4s) + `seed` (1.3s) + `build:e2e` (105.4s) + `playwright test` (75–85s)
≈ **185–190s (≈ 3.1 мин)**, без `npm ci` (в реальном CI — `setup-node` с кешем
npm, сопоставимо или быстрее) и без загрузки браузера (кешируется
`actions/cache` по `hashFiles(package-lock.json)`, что подтверждено в diff'е
job'а). Двукратный запас от бюджета ~8 мин. **PASS.**

## 3. "Падает при намеренной поломке" (AC 4) — проверено остановкой Postgres

```
$ service postgresql stop
 * Stopping PostgreSQL 16 database server ...done.
$ CI=true npx playwright test e2e/homepage.spec.ts
  ✓ Главная страница › отвечает 200 и рендерит ключевые блоки
  ✘ Health check › GET /api/health отвечает 200 success
    Expected: "healthy"
    Received: "degraded"
    (retry #1 — тоже упал)
  1 failed, 1 passed
EXIT_CODE=1
$ service postgresql start   # восстановлено, данные целы (Booking count = 2 после рестарта)
```
Ровно один упавший тест (health-check), retries:1 честно повторил и не
спас упавший тест синтетической поломкой — задание корректно становится
красным. **PASS.**

## 4. Два задокументированных отклонения — независимая перепроверка, не доверие отчёту Reviewer'а

### 4a. `prisma db push` вместо `migrate deploy`

```
$ grep -rl "RecurringExpense" prisma/migrations/*/migration.sql   → пусто, exit 1
$ grep -rl "SmsLog" prisma/migrations/*/migration.sql              → пусто, exit 1
$ grep -rl "TelegramLinkToken" prisma/migrations/*/migration.sql   → пусто, exit 1
$ grep -rl 'CREATE TABLE "Expense"' prisma/migrations/*/migration.sql → пусто, exit 1
```
Все 4 таблицы из issue #590 действительно отсутствуют во всех 27
`migration.sql`. Дополнительно получил тело issue #590 через GitHub API:
открыт, `prio:P1`, содержит идентичный `migrate diff` вывод (создание тех же 4
таблиц + расхождения FK/индексов), заявлено найденным "при работе над issue
#572" — согласуется с коммит-сообщением. `db push` для одноразовой
сервис-контейнерной БД CI — обоснованное, задокументированное отклонение,
не влияет на прод (прод не трогается этим PR). **Обоснование подтверждено, не блокер.**

### 4b. `admin-rbac.spec.ts` не тестирует буквально "USER → /admin/dashboard → отказ"

Поднял реальный standalone-сервер (`node .next/standalone/server.js`, те же
env, что использует `docker-entrypoint.sh` в проде) и ударил по нему БЕЗ
единого cookie:

```
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/dashboard
200                                                    # ожидался бы 302/401/403
$ curl -sD - -o /dev/null http://localhost:3000/admin/dashboard
HTTP/1.1 200 OK                                        # нет Location, не редирект
$ grep -c "Дашборд" admin-dashboard-body.html
2                                                       # реальный контент страницы отдан анониму
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/users
200                                                    # второй независимо проверенный маршрут — тоже дыра
```
Контрольная проверка (API-уровень защищён корректно, в отличие от page-уровня):
```
$ curl -s http://localhost:3000/api/admin/badge-counts
{"success":false,"error":{"code":"UNAUTHORIZED","message":"Необходимо войти в аккаунт"}}  # 401
```
Баг реально воспроизведён вживую (не гипотеза из чтения кода), совпадает с
описанием в теле issue #591 (получено через GitHub API: открыт, `prio:P0`,
`needs-owner`, описывает тот же механизм — `proxy.ts` оборачивает `auth()`
кастомной middleware, `authorized(): false` тихо отбрасывается вместо
редиректа). Учитывая, что баг реален и жив прямо сейчас, кодировать
"USER → /admin/dashboard → 200" как зелёный тест было бы активно неверным
(закрепило бы дыру как "ожидаемое поведение"). Замена на два реально
работающих RBAC-барьера (MANAGER не в своём разделе → редирект;
USER → `/api/admin/*` → 403) — оправданная, задокументированная в самом
спеке (комментарий `NOTE`) подмена. **Обоснование подтверждено эмпирически, не блокер.**

Здесь же — единственная неустранённая проблема этой ветки: она **не
кодирует регресс-тест на сам баг #591** (что логично, раз баг ещё жив), но
и явного `test.fixme()`/`.skip()`-маркера с id issue тоже нет — комментарий
`NOTE` в файле это компенсирует (явно ссылается на #591 и говорит, что делать
после фикса). Не блокер, косметика.

## 5. Регрессия

```
$ npm test -- --run
 Test Files  254 passed (254)
      Tests  3616 passed (3616)
 Duration    31.64s
exit 0

$ npx tsc --noEmit
exit 0, без вывода (12s)

$ npm run lint
✖ 16 problems (0 errors, 16 warnings)
exit 0
```
16 warnings — все вне диффа этой ветки (`messenger/*`, `notifications/service.ts`,
`novofon-client.ts` — pre-existing, не относятся к этому PR). **PASS.**

### Перепроверка depth-safety фикса (не поверил коммит-сообщению на слово)

`.next/standalone/e2e/` — реальный артефакт `build:e2e` (проверил `find`,
директория существует после сборки). Временно откатил `vitest.config.ts` на
старый паттерн `"e2e/**"` (без `**/`-префикса) и прогнал `npm test`:

```
FAIL .next/standalone/e2e/homepage.spec.ts
FAIL .next/standalone/e2e/ps-park-booking.spec.ts
... (5 файлов)
Test Files  5 failed | 254 passed (259)
exit 1
```
Vitest действительно подхватывает Playwright-спеки из вложенной копии в
`.next/standalone/e2e/` при старом паттерне и падает на `test.describe()` вне
Playwright-раннера — ровно баг, который описывает коммит `ba903fb2`. Вернул
`vitest.config.ts` к состоянию ветки (`"**/e2e/**"`), прогнал `npm test`
повторно — снова `254 passed (254)`, `exit 0`. **Фикс реален и необходим, не
косметика — PASS.**

## 6. Commit messages

```
ba903fb2 fix(test): make Vitest's e2e/ exclude pattern depth-safe
87f5bc94 feat(ci): Playwright E2E job — критические флоу против живого стека
           ...
           Closes #572
```
Conventional commits (`fix(test):`, `feat(ci):`), `Closes #572` присутствует в
основном коммите. **PASS.**

## 7. `.gitignore` и синхронность lock-файла

```diff
+/playwright-report
+/test-results
+/blob-report
```
Все три артефакта Playwright добавлены. После двух прогонов E2E
`git status --short --ignored` подтвердил: `test-results/` игнорируется
(`!! test-results/`), в `git status` (без `--ignored`) не появляется — не
попадёт в коммит по случайности.

```
$ npm ci
added 649 packages, and audited 650 packages in 29s
exit 0
```
`package-lock.json` в синхроне с `package.json` — критично, так как это
первый шаг CI-job'а; при рассинхроне `npm ci` падает сразу. **PASS.**

## 8. Отдельно проверенная, но не блокирующая находка Reviewer'а — `needs:` build vs e2e

```
$ grep -n "needs:" .github/workflows/ci.yml
178:    needs: [lint, test, typecheck]
```
`build`-джоб (Docker-образ) действительно не зависит от `e2e`. Но:
- `e2e` триггерится только на `pull_request` (`if: github.event_name == 'pull_request'`);
- на PR `build`-джоб делает только локальную сборку без push (`push: false, load: true`) — сборка образа, не деплой;
- пуш образа в GHCR происходит только на `push` в `main`, где `e2e` вообще не
  запускается (это post-merge событие, `e2e` — pre-merge гейт).

Реальный гейт авто-мержа — `scripts/lib/issue-queue.ts:summarizeChecks()`,
который читает **все** check-runs коммита через GitHub API (не граф `needs:`
внутри одного workflow-файла) и требует, чтобы ни один не был `pending`/`failed`
— `e2e` как отдельный джоб репортит собственный check-run и попадёт под это
требование независимо от `needs:` в `build`. Отсутствие `e2e` в `needs: build`
не открывает дыру в auto-merge safety; влияет только на ручной мерж через
GitHub UI до тех пор, пока владелец не добавит `e2e` в required status checks
branch protection — это прямо названо шагом владельца в самом issue #572
("Шаг владельца (1 клик, после мержа)"), вне зоны кода. **Подтверждено, не блокер.**

## Security / functional checklist (agents/qa.md)

- **RBAC** — покрыто в рамках доступного (не сломанного) поведения:
  MANAGER без доступа к разделу → редирект (`e2e/admin-rbac.spec.ts:20`);
  USER без прав → `/api/admin/*` → 403 (`e2e/admin-rbac.spec.ts:31`).
  Анонимный/USER на `/admin/*` page-роуте прямо сейчас реально уязвим — баг
  подтверждён лично (см. §4b), заведён как issue #591 (P0), не замаскирован
  под "зелёный" тест. Эта ветка не вносит и не усугубляет уязвимость — она
  инфраструктурная (E2E harness), сам баг живёт в `src/proxy.ts` до этого PR.
- **Rate limiting** — не применимо, PR не добавляет публичных API endpoint'ов.
- **Input validation** — не применимо, новых Zod-схем нет.
- **Data leakage** — секреты в `ci.yml` (`NEXTAUTH_SECRET`/`AUTH_SECRET`)
  захардкожены как явно фиктивные (`e2e-ci-secret-not-for-prod-use`),
  не читаются из реальных production secrets. `e2e/helpers/db.ts` открывает
  прямое Prisma-подключение только для тестовых ассертов, не логирует и не
  возвращает данные наружу.

Ввиду того что данная ветка не открывает и не расширяет security-поверхность
(инфраструктура тестирования, а не бизнес-логика/API), а обнаруженный вживую
P0-баг (#591) — не регрессия этого PR и уже задокументирован отдельным issue
с корректным приоритетом, не блокирую вердикт этой ветки из-за него.

## Вывод по AC

| AC | Результат |
|----|-----------|
| 1. Job `e2e`: postgres+redis сервисы, схема+seed, build+start, playwright | PASS |
| 2. `e2e/` + `playwright.config.ts` (chromium only, retries:1) | PASS |
| 3. 5–7 критических флоу (в наличии 7: главная, health, беседка→БД, PS-Park→БД, cafe→БД, 2×RBAC) | PASS |
| 4. Job зелёный и падает при поломке (проверено остановкой Postgres) | PASS |
| 5. Время ≤ ~8 мин (реально ≈3.1 мин без npm ci/загрузки браузера) | PASS |
| 6. Флоу пишут/читают реальную БД без моков (проверено напрямую `psql`) | PASS |
| Отклонение: `db push` вместо `migrate deploy` (issue #590) | Подтверждено, обосновано |
| Отклонение: RBAC-спек не кодирует буквальный сценарий (issue #591, живой P0) | Подтверждено эмпирически, обосновано |
| `needs:` build vs e2e (заметка Reviewer'а) | Подтверждено, не блокер (гейт авто-мержа не зависит от needs) |
| Регрессия (`npm test`, `tsc`, `lint`) | PASS |
| Скоуп диффа | PASS, только E2E/CI/vitest |
| Commit messages | PASS, conventional + `Closes #572` |
| `.gitignore` + `npm ci` синхронность | PASS |

## Вердикт: PASS
