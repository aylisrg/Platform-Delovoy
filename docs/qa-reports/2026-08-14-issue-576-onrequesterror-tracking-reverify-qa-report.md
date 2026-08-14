# QA Report: Issue #576 — onRequestError → SystemEvent (server-error, digest, троттлинг) — Re-verification

## Вердикт: PASS

Branch: `claude/issue-576-onrequesterror-tracking`, HEAD `c393b0c2` (`fix(monitoring): server-error digest —
синтетический хэш вместо общей заглушки "no-digest"`), поверх `a02b1cb8` (исходный PR, ревью которого дало
**FAIL** — см. `docs/qa-reports/issue-576-qa-report.md`).

Цель этого прохода — независимо перепроверить ровно ту находку, которая заблокировала предыдущий вердикт:
`err.digest` у Next.js существует только для ошибок рендера RSC, а для исключений из Route Handler'ов (весь
REST API) отсутствует; фолбэк на литерал `"no-digest"` заставлял `pattern-extractor.ts` и Redis-троттлинг
трактовать его как настоящий уникальный digest, из-за чего разные несвязанные ошибки в разных route handler'ах
схлопывались в один фингерпринт/троттл-ключ и вторая ошибка в течение 60с молча терялась.

## 1. Фикс по коду

`src/instrumentation.ts` (diff `a02b1cb8..c393b0c2`):

```diff
-    const digest = typeof errDigest === "string" ? errDigest : "no-digest";
+    const digest =
+      typeof errDigest === "string" && errDigest.length > 0
+        ? errDigest
+        : createHash("sha256").update(`${context.routePath}:${err.message}`).digest("hex").slice(0, 12);
```

Вместо константы — стабильный синтетический хэш от `routePath:message` (12 hex-символов). Разные route/сообщения
→ разные digest → разные фингерпринты в `pattern-extractor.ts` и разные Redis-ключи `server-error-throttle:*`.
Повтор одной и той же ошибки на одном и том же route → тот же хэш → троттлинг/дедуп по-прежнему работает как
задумано. Это устраняет именно тот механизм, который был указан как причина находки (общий литерал вместо
per-error значения), а не работает вокруг неё.

## 2. Живая репродукция на исправленном коде (Postgres 16 + Redis 7 + `next dev`, Next 16.2.6)

Повторил собственный оригинальный сценарий репродукции из FAIL-отчёта на текущем HEAD `c393b0c2`:
временный `.env` (та же `DATABASE_URL`/`REDIS_URL`, что и в прошлой сессии), `next dev`, два временных route
handler'а — `src/app/api/qa576c/health/route.ts` и `src/app/api/qa576d/health/route.ts`, оба
`export async function GET() { throw new Error("QA576-FIX-VERIFY-ROUTE-{C,D}"); }` — разные сообщения, разные
пути, не начинаются с `_` (не приватная папка), заканчиваются на `/health` (обходят auth-гейт в `src/proxy.ts`).

1. Redis перед стартом чист (`redis-cli KEYS "server-error-throttle:*"` — пусто).
2. `curl /api/qa576c/health` → `500`, пустое тело. `SystemEvent`: `message="QA576-FIX-VERIFY-ROUTE-C"`,
   `metadata.digest="658278ef3767"`, `metadata.route="/api/qa576c/health"`.
3. Сразу же `curl /api/qa576d/health` (другой route, другое сообщение, тот же 60-секундный троттл-интервал) →
   `500`, пустое тело. `SystemEvent`: `message="QA576-FIX-VERIFY-ROUTE-D"`, `metadata.digest="1e74ac5c9ba5"`,
   `metadata.route="/api/qa576d/health"`.
4. **Оба события присутствуют в `SystemEvent`, оба с разными digest.** Раньше на этом шаге вторая строка не
   появлялась вовсе (см. FAIL-отчёт, шаг 3 репродукции) — это и есть точное закрытие исходной находки.
5. Контрольная проверка троттлинга не сломана: 3 дополнительных `curl` подряд на тот же `/api/qa576c/health`
   (тот же digest) → `count(*) FROM "SystemEvent" WHERE message='QA576-FIX-VERIFY-ROUTE-C'` остался равен `1`
   (было `1` до, `1` после трёх повторов). `redis-cli TTL server-error-throttle:658278ef3767` — активен (~29с из
   60), ключ `SET ... NX EX 60` отработал как задумано. Ни один из повторных HTTP-вызовов не завис/не сломался
   (все `500`, все с пустым телом).
6. `metadata` для route C проверен целиком: `route`, `routeType`, `method`, `statusCode: 500`, `stack`
   (усечён), `digest` — без `headers`/`cookies`/`body`, без утечки в HTTP-ответе (`curl -i` — 0 байт тела).

Побочное наблюдение при живом прогоне: в БД до моей проверки уже лежали 2 строки `SystemEvent` с
`message IN ('QA576-FIX-VERIFY-ROUTE-A', 'QA576-FIX-VERIFY-ROUTE-B')`, `createdAt` на ~2 минуты раньше коммита
`c393b0c2` — по всей видимости, собственная живая проверка разработчика перед коммитом (commit message
упоминает «Проверено вживую... два разных route handler'а»), не удалённая после прогона. Их digest'ы
(`dcaa7ccec956`, `338b351f6625`) тоже были различны — независимое дополнительное подтверждение фикса, но это
гигиенический минус: разработчик не убрал за собой тестовые данные из общей dev-БД. Не блокирует вердикт (не
функциональный баг), удалено мной в рамках уборки этого прохода — см. раздел «Уборка» ниже; отмечаю как
процессный momento для разработчика на будущее.

## 3. Юнит-тесты — ревью на предмет спурного прохождения

Два новых теста в `src/__tests__/instrumentation.test.ts`:

- «одинаковый route+message → стабильный одинаковый синтетический digest» — не мокает Redis по ключу (мок
  `redisSetMock` по умолчанию всегда резолвит `"OK"` вне зависимости от аргументов), поэтому сам по себе не
  проверяет коллизию троттлинга — но это и не заявлено; заявленная проверка (`digestA === digestB`) прямая и
  корректная.
- «разные route/сообщение → разные synthetic digest, оба залогированы (issue #576)» — ключевая проверка:
  `expect(digestA).not.toBe(digestB)` + `expect(logErrorMock).toHaveBeenCalledTimes(2)`.

Проверил на спурность вручную: на **старом** коде (`digest = typeof errDigest === "string" ? errDigest :
"no-digest"`) оба вызова без `err.digest` дали бы `digestA === digestB === "no-digest"` — assertion
`.not.toBe` упал бы; `toMatch(/^[0-9a-f]{12}$/)` в соседнем тесте тоже упал бы (`"no-digest"` не 12-символьный
hex). Т.е. оба новых теста **корректно различают старое и новое поведение**, не спурны. Ограничение — они не
эмулируют Redis по ключу (mock не является настоящим key-value store), поэтому не служат независимым
регрессионным барьером для сценария «два разных digest → раздельные Redis NX-ключи»; это компенсируется
отдельным существующим тестом «разные digest не троттлят друг друга» (не новый, был и раньше, использует явные
литералы `digest-a`/`digest-b`) и моей живой репродукцией на реальном Redis (п.2, шаги 3–5), которая покрывает
именно это. В сумме: юнит-тесты + живая проверка закрывают весь путь.

## 4. Regression / build gates

| Проверка | Результат |
|---|---|
| `npm test -- --run` | 255 файлов / **3641 тестов** — все зелёные |
| `npx tsc --noEmit` | без ошибок |
| `npm run lint` | 0 errors, 16 pre-existing warnings, ни один не в файлах диффа (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `useChatList.ts`, `modules/messenger/types.ts`, `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts`) |

## 5. Побочное (некритичное) наблюдение — не блокирует вердикт

При старте `next dev` Turbopack печатает предупреждение (не ошибку сборки, сервер стартует и работает
нормально — `GET /api/health` вернул `200` сразу же):

```
⚠ ./src/instrumentation.ts:1:1
A Node.js module is loaded ('node:crypto' at line 1) which is not supported in the Edge Runtime.
```

Новый top-level `import { createHash } from "node:crypto"` анализируется статически при подготовке edge-бандла
(та же категория предупреждений уже существовала для `process.on(...)` внутри `register()` — оба защищены
рантайм-гвардом `if (process.env.NEXT_RUNTIME !== "nodejs") return;`, так что функционально безопасно: код
внутри `if` не исполняется в edge-контексте). Чисто косметическое предупреждение сборки, не влияет на
поведение — не блокирует вердикт, но стоит упомянуть разработчику как потенциальный follow-up (например,
динамический `await import("node:crypto")` внутри ветки `typeof errDigest !== "string"`, по аналогии с уже
существующими `await import("@/lib/redis")`/`await import("@/lib/logger")` в этом же файле, убрал бы и это
предупреждение).

## 6. Security (обязательные функциональные кейсы, `agents/qa.md`)

Без изменений относительно исходного прохода — RBAC/rate-limiting/input-validation N/A (не HTTP-эндпоинт, не
принимает пользовательский ввод), data leakage — PASS (пустое тело `500` клиенту, `headers`/`cookies`/`body` не
попадают в `metadata`, подтверждено повторно живым `curl -i` и `SELECT metadata`).

## Уборка после живой репродукции

- Временные route handler'ы (`src/app/api/qa576c/health`, `src/app/api/qa576d/health`) удалены.
- Тестовые строки `SystemEvent` (`message LIKE 'QA576-%'`, включая 2 неудалённые разработчиком строки A/B)
  удалены — `SystemEvent` вернулся к исходным 3 строкам.
- Redis-ключи `server-error-throttle:*` удалены — `redis-cli KEYS "*"` пуст.
- Временный `.env`, `.next` (dev build cache) удалены, dev-сервер остановлен.
- `git status --short` — пусто, рабочее дерево чистое.

## Итог

Фикс `c393b0c2` устраняет ровно ту причину, которая была указана в FAIL-находке предыдущего прохода: вместо
общего литерала `"no-digest"` для отсутствующего `err.digest` теперь вычисляется стабильный per-route+message
синтетический хэш. Живая репродукция на реальном Postgres+Redis+`next dev` подтверждает: два разных route
handler'а с разными ошибками в пределах одного 60-секундного окна теперь оба создают `SystemEvent` с разными
`digest` (раньше вторая ошибка молча терялась); повторы одной и той же ошибки на одном route по-прежнему
корректно троттлятся (не более ~1 записи/мин на digest), HTTP-ответ реальному вызывающему не ломается и не
содержит утечек. Новые юнит-тесты корректно различают старое/новое поведение (не спурны), хотя и не эмулируют
Redis по ключу — это компенсировано живой проверкой и существующим тестом на разные digest. `npm test`
(3641/3641), `tsc --noEmit`, `npm run lint` (0 errors) — чисто, регрессий нет. Единственное найденное
несовершенство — косметическое предупреждение сборки про `node:crypto` в edge-бандле (не функциональная
проблема, не блокирует) и то, что разработчик не убрал за собой тестовые `SystemEvent`-строки после
собственной живой проверки перед коммитом (гигиенический momento, не баг).

**Вердикт: PASS** — критическая находка предыдущего прохода устранена и независимо подтверждена; issue #576
можно закрывать.
