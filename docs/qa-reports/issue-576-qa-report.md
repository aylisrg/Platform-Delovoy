# QA Report: #576 — onRequestError → SystemEvent (server-error, digest, троттлинг)

## Вердикт: FAIL

---

## Источник правды

Ветка `claude/issue-576-onrequesterror-tracking`, коммит `a02b1cb8`
(`feat(monitoring): onRequestError → SystemEvent server-error со стеком и
digest`). `code-reviewer` дал PASS. Эта проверка независимая: собственная
эмпирическая репродукция на реальном `next dev` + Postgres + Redis, а не
пересказ ревью или юнит-тестов разработчика.

Реальный диф PR (`git diff c5acfbb5..HEAD`, `c5acfbb5` — точка ветвления от
`origin/main`; `origin/main` с тех пор ушёл вперёд на не относящийся к этой
задаче PR #593, поэтому `git diff origin/main..HEAD --stat` показывает лишние
удаления — это шум от дивергенции, не часть этого PR):

```
scripts/__tests__/pattern-extractor.test.ts |  59 ++++++++++++
scripts/analyze-errors.ts                   |   7 +-
scripts/lib/pattern-extractor.ts            |  16 +++-
src/__tests__/instrumentation.test.ts       | 140 +++++++++++++++++++++++++++-
src/instrumentation.ts                      |  58 ++++++++++++
5 files changed, 273 insertions(+), 7 deletions(-)
```

Acceptance criteria (issue #576, из задания на QA):
1. Артефакт-ошибка в тестовом route handler'е создаёт `SystemEvent` с
   `source="server-error"`, `metadata: {digest, route, method, statusCode,
   stack}` (stack ≤ 2000 симв.), без PII (headers/cookies/body).
2. Юнит-тесты: фингерпринт по digest (не по тексту), дедуп двух событий с
   одинаковым digest в один паттерн.
3. Троттлинг: шторм одинаковой ошибки (один digest) — не более ~1
   `SystemEvent`/мин; повторные вызовы в течение 60с не должны звать
   `log.error` повторно, но обязаны вернуть ответ реальному HTTP-вызывающему
   без исключений.

## AC — по пунктам

| # | AC | Статус | Доказательство |
|---|----|--------|-----------------|
| 1 | `SystemEvent` с корректными полями metadata, без PII | PASS (форма) / см. находку ниже (содержание digest) | Живая репродукция: `curl http://localhost:3000/api/qa576a/health` (route handler, `throw new Error(...)`) → строка в `SystemEvent` с `source="server-error"`, `metadata.route="/api/qa576a/health"`, `metadata.method="GET"`, `metadata.statusCode=500`, `metadata.stack` длиной ровно 2000 символов (усечение работает), `metadata.digest` присутствует. HTTP-ответ реальному вызывающему — `500`, **пустое тело** (`curl -i` — только заголовки, 0 байт тела) — стек/сообщение наружу не уходят. `headers`/`cookies`/`body` нигде в metadata не встречаются (подтверждено и юнит-тестом «не пишет заголовки запроса», и живым дампом `SELECT metadata`). |
| 2 | Дедуп по digest в юнит-тестах | PASS как написано, но покрытие не ловит главный сценарий продакшена (см. «Критическая находка») | `pattern-extractor.test.ts`: два события с одинаковым явно заданным digest → 1 паттерн; с разными digest → 2 паттерна; без digest вовсе (`metadata` без поля) → откат на текстовую нормализацию. **Отсутствует** кейс: два РАЗНЫХ по сути server-error, у которых Next.js в принципе не предоставляет digest (то есть оба реально получат `metadata.digest === "no-digest"`) — именно это происходит в проде для route handlers, см. ниже. |
| 3 | Троттлинг шторма одного digest, ответ вызывающему не ломается | PASS для реального совпадающего digest / **FAIL для скрытого случая пустого digest** | Живой прогон: 3 последовательных `curl` на один и тот же route handler → `SystemEvent` count вырос на 1 (не на 3), Redis-ключ `server-error-throttle:no-digest` с `TTL=59`. Все 3 HTTP-ответа — `500`, ни один вызов не подвесил/не сломал ответ. Это соответствует заявленному поведению **для одного и того же digest**. Но т.к. Redis-ключ троттлинга строится буквально как `server-error-throttle:${digest}`, а *подавляющее большинство* server-error в этом API-first приложении получают одинаковый фиктивный digest `"no-digest"` (см. ниже) — троттлинг на практике происходит не «по конкретной ошибке», а глобально по всему сайту сразу. |

## Критическая находка: `digest` отсутствует у Next.js для Route Handler-исключений → все API-ошибки схлопываются в один фингерпринт/троттл-ключ

Это ровно тот edge case, который был прямо указан в задании на QA («Does the
throttle key correctly scope per-digest so two *different* concurrent errors
don't get incorrectly throttled against each other?»). Разобрал вопрос и
прочтением исходников Next.js 16.2.6 (`node_modules/next/dist/...`), и живой
репродукцией.

### Источник в коде Next.js

- `scripts/lib/pattern-extractor.ts` и `src/instrumentation.ts` полагаются на
  то, что `err.digest` — стабильный хэш конкретной ошибки, генерируемый
  Next.js. Это правда **только для ошибок React Server Component рендера**:
  `node_modules/next/dist/server/app-render/create-error-handler.js:100` —
  `err.digest = createDigestWithErrorCode(err, stringHash(err.message +
  (err.stack||'')).toString())`.
- Для **Route Handlers** (`app/api/**/route.ts` — то есть буквально весь REST
  API этого API-first приложения, `src/app/api/**`) этот код вообще не
  вызывается. Путь исключения: `node_modules/next/dist/build/templates/app-route.js`
  (общий шаблон для dev и prod) — необработанное исключение из хендлера
  просто перебрасывается (`throw err`, строка 481 модуля `app-route/module.js`)
  до внешнего `catch` (строка 420 `app-route.js`), который сразу зовёт
  `routeModule.onRequestError(...)` **без какого-либо присвоения `.digest`**,
  и отправляет реальному клиенту `new Response(null, {status:500})`. Ни в
  одном месте этого пути `createDigestWithErrorCode`/`stringHash` не
  вызывается — `grep -rln createDigestWithErrorCode node_modules/next/dist`
  находит ровно один файл, и это `create-error-handler.js` (только render-путь).
- Следствие: `err.digest` для plain `throw new Error(...)` внутри
  `route.ts` — всегда `undefined`. `src/instrumentation.ts` в этом случае
  подставляет литерал `"no-digest"` (это осознанный фолбэк по коду, не баг
  сам по себе) — но `scripts/lib/pattern-extractor.ts` проверяет только
  `typeof entry.metadata?.digest === 'string'`, а строка `"no-digest"` тоже
  строка — поэтому эта ветка (digest-based fingerprint) срабатывает и для
  фолбэка, порождая **общий на все route handler-ошибки** фингерпринт
  `sha256("server-error:no-digest")`. То же самое — общий Redis-ключ
  `server-error-throttle:no-digest` для троттлинга.

### Живая репродукция (не гипотеза — воспроизведено на реальном стеке)

Поднял Postgres 16 + Redis 7 (уже были запущены), временный `.env`
(`DATABASE_URL`/`REDIS_URL`/`NEXTAUTH_*`), `next dev` (Turbopack, Next
16.2.6), два временных route handler'а (`/api/qa576a/health`,
`/api/qa576b/health`, оба — `export async function GET() { throw new
Error(...) }`, разные сообщения) и одна временная страница
(`/qa576page`, `throw` прямо в Server Component).

1. Очистил `server-error-throttle:no-digest` в Redis.
2. `curl /api/qa576a/health` → `SystemEvent` создан, `metadata.digest =
   "no-digest"`. Redis: ключ `server-error-throttle:no-digest` появился,
   `TTL=60`.
3. Сразу же (~1с спустя) `curl /api/qa576b/health` — **другая ошибка,
   другой route, другое сообщение** → HTTP-ответ клиенту всё ещё корректный
   `500` (регрессии в ответе нет), но **`SystemEvent` НЕ создан**: `SELECT
   count(*) FROM "SystemEvent" WHERE source='server-error'` не изменился.
   Ошибка route B молча потеряна для мониторинга — троттлинг сработал по
   чужому, не относящемуся к делу событию.
4. Контрольная проверка: `curl /qa576page` (ошибка в рендере страницы, не в
   route handler) → `metadata.digest = "2037918473"` — **настоящий**,
   специфичный для этой ошибки числовой digest от Next.js, что подтверждает:
   механизм digest в принципе работает **только для render-пути**, не для
   route handlers.

```sql
 message                          | digest      | route                | routeType
-----------------------------------+------------+-----------------------+-----------
 QA576-ARTIFICIAL-RENDER-ERROR-PAGE | 2037918473 | /qa576page            | render
 QA576-ARTIFICIAL-ERROR-ROUTE-A     | no-digest  | /api/qa576a/health    | route
 QA576-ARTIFICIAL-ERROR-ROUTE-B     | no-digest  | /api/qa576b/health    | route
                                     ^ ЭТА строка НЕ появилась после шага 3 —
                                       событие потеряно.
```

### Почему это FAIL, а не «известное ограничение»

- **Ломает именно то, ради чего сделан #576.** Цель issue — «стабильный
  digest-based fingerprint, чтобы `analyze-errors.ts` мог дедуплицировать/
  группировать паттерны и заводить actionable GitHub issues». Для route
  handlers (доминирующая часть серверного кода в API-first приложении,
  `GET/POST/PATCH/DELETE /api/{module}` по конвенции CLAUDE.md) это не
  работает: **все** различные баги в route handlers схлопываются в один
  паттерн `sha256("server-error:no-digest")`. `analyze-errors.ts`
  (`findNewPatterns`) сравнивает текущее окно с baseline 7–14 дней назад по
  фингерпринту — если хоть одна ошибка без digest попала в baseline-окно,
  **любая другая, никак не связанная ошибка** в любом другом route handler
  в текущем окне будет считаться «уже известным» паттерном и не создаст
  новый issue. Ровно обратный эффект тому, что было задумано (issue
  описывает существовавшую ДО #576 проблему именно так: «Error-to-Fix видел
  только текст сообщения» — новая реализация должна была это исправить для
  digest-случая, но для route handlers digest-случая просто не существует).
- **Троттлинг теряет реальные события.** Шаг 3 репродукции — не
  гипотетический: два независимых, не связанных сбоя в течение 60с (что для
  прод-инцидента, затрагивающего несколько эндпоинтов одновременно —
  например, при падении БД — совершенно реалистичный сценарий) → второй
  инцидент не попадает в `SystemEvent` вовсе. `agents/SECURITY.md`/`CLAUDE.md`
  не описывают именно этот кейс явно, но это прямое нарушение духа AC3
  («троттлинг ПО digest», а не троттлинг «всего подряд под одним и тем же
  фиктивным ключом»).
- **Юнит-тесты не поймали бы это** — они везде либо задают явный digest
  (`"abc123"`, `"digest-a"`/`"digest-b"`), либо тестируют полное отсутствие
  поля `metadata.digest` (текстовый фолбэк), но никогда — два разных
  реальных вызова `onRequestError`/`generateFingerprint`, оба легитимно
  получившие строку-заглушку `"no-digest"`. Это ровно тот пробел, который
  скрыл баг от `code-reviewer` и от разработчика.

### Рекомендация разработчику (для баг-репорта, не чиню сам)

Не полагаться на `"no-digest"` как на валидный "digest" в
`pattern-extractor.ts`/троттлинге. Варианты: (а) когда `err.digest`
недоступен, самим вычислять стабильный хэш от `message + stack` (по образцу
того, что уже делает сам Next.js для render-пути —
`stringHash(err.message + (err.stack||''))`) вместо константы `"no-digest"`;
или (б) явно исключить литерал `"no-digest"` из ветки `typeof ===
'string'` в `generateFingerprint` и troттлинг-ключе, откатываясь на
текстовую нормализацию/собственный хэш message+route.

## Побочные (некритичные) наблюдения — не блокируют вердикт сами по себе

- **Сообщение ошибки логируется дословно, без редактирования.** Комментарий
  в коде верно называет `err.message` "developer-authored, not user input" —
  это соответствует существующему во всей кодовой базе паттерну (`log.error`
  и раньше принимал message от пойманных исключений). Но #576 — первый
  канал, который **автоматически**, без участия разработчика, подхватывает
  вообще все необработанные исключения сайта и (через `analyze-errors.ts` →
  `scripts/lib/github-issues.ts`, без какой-либо санитизации
  `sampleMessage`/`examples`) превращает их в тела GitHub issues. Если
  где-либо в кодовой базе исключение интерполирует пользовательский ввод в
  `message` (например, `throw new Error(\`Invalid email: ${input}\`)`), этот
  ввод теперь потенциально долетает до GitHub issue. Не баг именно этого
  PR (существующий паттерн логирования не менялся), но новый, ранее не
  существовавший канал утечки для конкретно такого класса ошибок — стоит
  зафиксировать как отдельный follow-up для владельца/security-review, не
  блокирует этот вердикт.
- **`context.routePath` типизирован Next.js как строгий `string`
  (`node_modules/next/dist/server/instrumentation/types.d.ts`), не
  optional** — в реальных вызовах пусто не бывает. Даже если бы было пустой
  строкой — код не упадёт (`route: context.routePath` просто запишет `""`).
  Не проблема.
- **`statusCode: 500` — обоснованное предположение**, а не жёстко
  захардкоженное неверное значение: подтверждено чтением
  `app-route.js`/`route-module.js` — `onRequestError` для route handlers
  вызывается ИСКЛЮЧИТЕЛЬНО в ветке, которая затем шлёт `new Response(null,
  {status:500})`. Ожидаемые 4xx (`NextResponse.json(..., {status:404})`,
  `notFound()`/`redirect()` из `next/navigation`) не доходят до
  `onRequestError` вообще — подтверждено чтением `isHTTPAccessFallbackError`/
  `isRedirectError` веток в `module.js:447-481`, которые превращают их в
  обычный `Response` до перевыброса.
- **Гонки/атомарность троттлинга.** `SET NX EX` атомарен на стороне Redis —
  конкурентные вызовы с одинаковым digest корректно сериализуются (только
  один получит `"OK"`). Не проблема сама по себе — проблема только в том,
  какой ключ используется, см. основную находку.

## Регрессия

- `npm test -- --run` → **255 файлов, 3639 тестов, все зелёные** (включая
  оба изменённых файла тестов из диффа).
- `npx tsc --noEmit` → чисто, без вывода.
- `npm run lint` → **0 errors**, 16 pre-existing warnings, ни один не в
  файлах диффа (`src/instrumentation.ts`, `scripts/lib/pattern-extractor.ts`,
  `scripts/analyze-errors.ts`, оба тестовых файла) — warnings в
  `session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`,
  `ChatWindow.tsx`, `useChatList.ts`, `modules/messenger/types.ts`,
  `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts`,
  не связаны с этим PR.

## Security (обязательные функциональные кейсы, `agents/qa.md`)

- **RBAC:** N/A — `onRequestError` не HTTP endpoint, не имеет роли/сессии,
  вызывается фреймворком напрямую. Тестовый route `/…/health` намеренно
  публичный по конвенции (`src/proxy.ts` matcher `/api/((?!auth|health|[^/]+/health$).*)`)
  — подтверждено живым прогоном: HTTP-ответ без авторизации, `500`, пустое
  тело, никаких данных сессии/токенов.
- **Rate limiting:** N/A напрямую (не публичный API-эндпоинт), но
  функциональный эквивалент — троттлинг по digest — является ядром находки
  выше: работает корректно для реального совпадающего digest, но неверно
  скоупится при отсутствующем digest.
- **Input validation:** N/A — на вход `onRequestError` не подаются
  пользовательские данные из HTTP body/query, это внутренний хук фреймворка.
- **Data leakage:** PASS. Живой дамп `SELECT metadata FROM "SystemEvent"`
  подтверждает: `headers`/`cookies`/`body` нигде не появляются;
  `metadata.stack` содержит абсолютные серверные пути (`/home/user/...`) —
  это ожидаемо и осознанно (комментарий в коде, PRD) для **внутреннего**
  канала телеметрии (SystemEvent, потребляется `analyze-errors.ts`), а не
  для публичного HTTP-ответа — реальный вызывающий получает пустое тело
  `500` без стека (подтверждено `curl -i`). Это соответствует правилу
  CLAUDE.md «Stack traces… в production error response» — response, а не
  внутренний лог.

## Уборка после живой репродукции

- Временные route handler'ы (`src/app/api/qa576a/health`,
  `src/app/api/qa576b/health`) и страница (`src/app/(public)/qa576page`)
  удалены.
- Тестовые строки `SystemEvent` (`message LIKE 'QA576-%'`) удалены —
  `SystemEvent` вернулся к исходным 3 строкам, которые были в БД до
  проверки.
- Redis-ключи `server-error-throttle:no-digest` и
  `server-error-throttle:2037918473` удалены — `redis-cli KEYS "*"` пуст.
- Временный `.env` удалён, `.next` (dev build cache) удалён, dev-сервер
  остановлен.
- `git status --short` — пусто, рабочее дерево чистое.

## Итог

Форма записи `SystemEvent` (AC1) и корректность троттлинга/дедупа **для
случая, когда Next.js реально предоставляет digest** (AC2/AC3, render-путь)
подтверждены как юнит-тестами, так и собственной живой репродукцией. Но для
route handlers — то есть практически всего REST API этого API-first
приложения — Next.js в принципе не выдаёт `.digest`, и реализация
подставляет общую заглушку `"no-digest"`, которую `pattern-extractor.ts`
ошибочно трактует как валидный уникальный отпечаток. Эмпирически
подтверждено: (1) два независимых, не связанных сбоя в разных route
handlers в течение 60с — второй теряется из-за троттлинга по общему ключу;
(2) `analyze-errors.ts` будет схлопывать все различные баги route handlers в
один и тот же паттерн, что подрывает главную заявленную цель issue #576
(дедуп/группировка по стабильному отпечатку для создания actionable GitHub
issues). Это системная проблема, воспроизводимая на реальном стеке
(Postgres + Redis + `next dev` 16.2.6), не покрытая существующими юнит-
тестами.

**Вердикт: FAIL** — security-кейсы сами по себе PASS, но функциональная
находка выше (некорректный скоуп троттлинга/фингерпринта при отсутствующем
digest, эмпирически подтверждена) блокирует общий вердикт по правилу
«баг-репорт конкретен → Developer исправляет, QA не чинит сам».
