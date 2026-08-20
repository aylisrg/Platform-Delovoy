# QA: chore(deps) батч — ioredis 6, framer-motion 13, tsx 4.23 — issues #680/#681/#684, PR #716

## Вердикт: PASS

## Скоуп

Батч из трёх version bump'ов вместо трёх зависших dependabot-PR: `ioredis`
5.10.1→6.0.0 (MAJOR, держит rate-limit + realtime/SSE), `framer-motion`
12.42.2→13.1.1 (MAJOR, UI-анимации), `tsx` 4.22.4→4.23.12 (minor, раннер
`scripts/`). Дифф: 5 файлов, +133/-69 (`git diff origin/main...HEAD --stat`).
Формального PRD нет (dependency-bump, не фича) — источник правды: сами issues
+ `agents/SECURITY.md` §4 supply chain + правило авто-мерж гейта по major-ам
в `CLAUDE.md`. Учтён `docs/qa-reports/issue-680-681-684-review.md` (Reviewer,
вердикт PASS, статический разбор исходников ioredis) — моя часть добавляет то,
чего в ревью не было: живую функциональную проверку против реального Redis.

## Гейт — фактические цифры

| Проверка | Команда | Результат |
|---|---|---|
| `npm ci` | `npm ci` | exit 0, `added 646 packages, and audited 647 packages`. Package.json/lock согласованы — именно на этом падали исходные dependabot-PR. |
| Lint | `npm run lint` | **0 errors, 17 warnings** — совпадает с заявленным. Ни один из 8 файлов с предупреждениями (`sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts` и др.) не входит в дифф PR (`git diff origin/main...HEAD --name-only` — только 5 файлов) ⇒ логически все 17 предупреждений унаследованы от main, этим PR не добавлены и не убраны. Дешёвая проверка через сравнение множеств файлов, отдельный лог-прогон на main не потребовался. |
| Типы | `npx tsc --noEmit` | Чисто, 0 ошибок, 22s. |
| Тесты | `npm test -- --run` | **304 test files passed (304), 4189 tests passed (4189)**, 47.35s — совпадает с заявленным один-в-один. |
| Build | `npm run build` | exit 0. 4 pre-existing Turbopack warnings про Edge Runtime в `src/instrumentation.ts` (не в диффе PR, унаследованы от main). |
| `npm audit --audit-level=high` | — | 19 vulnerabilities (1 low/3 moderate/12 high/3 critical) — независимо перепроверено, ни `ioredis`, ни `framer-motion`, ни `tsx` в списке не фигурируют (grep по выводу — 0 совпадений); всё в `xlsx`/`@auth/core`/`next`/etc, унаследовано от main. |

## AC-по-пунктам (из задания на верификацию)

### 1. Полный локальный гейт — PASS
Прогнан целиком, цифры выше совпадают с заявленными в PR буквально.

### 2. `npm ci` без рассинхрона — PASS
`npm ci` завершился с exit 0, `package.json`/`package-lock.json` согласованы.
Именно этот шаг ронял исходные dependabot-PR #680/#681/#684.

### 3. ioredis 6 на живом Redis — PASS, проверено вживую
В окружении есть `redis-server` (Ubuntu-пакет, v7.0.15). Поднял отдельный
инстанс на порту 16399 (`redis-server --port 16399 --daemonize yes`) и
прогнал через реальный `ioredis@6.0.0` (установленный в `node_modules`, тот
же, что в `package-lock.json`) ровно те паттерны использования, что есть в
`src/lib/rate-limit.ts` и `src/lib/realtime/redis-bus.ts`:

- **Согласованный протокол**: `CLIENT INFO` на живом соединении вернул
  `resp=3` — ioredis 6 действительно согласовал RESP3 по умолчанию, как
  утверждает комментарий в `redis-bus.ts`.
- **Sliding-window pipeline** (`zremrangebyscore→zadd→zcard→expire→exec`,
  точный порядок команд из `rate-limit.ts`): `results` — массив `[err, value]`
  длиной 4, `results[2][1]` (zcard) — `1`, `typeof === "number"`. Форма ответа
  не изменилась, `count > config.limit` в `rate-limit.ts` продолжит работать.
- **`hgetall`**: вернул плоский объект `{"a":"1","b":"two","c":"3.5"}`, все
  значения — строки. Не RESP3-map, не изменение формы.
- **`ttl`**: вернул число (`42`).
- **pub/sub через отдельного клиента-подписчика** (точный паттерн
  `getSubscriber()` из `redis-bus.ts`, включая опции `lazyConnect: true,
  enableOfflineQueue: false, retryStrategy`): `publish()` вернул `1`
  (число доставленных подписчиков), событие `"message"` на subscriber-клиенте
  доставило исходный JSON-payload без искажений.
- **RESP3-снятие ограничения на подписанном соединении**: `subscriber.ping()`
  после активной подписки успешно вернул `PONG` — то самое поведение, на
  которое ссылается новый комментарий в `redis-bus.ts` (при RESP2 эта команда
  была бы отклонена с `"Connection is in subscriber mode..."`). Дополнительно
  проверил это по исходникам установленного пакета:
  `node_modules/ioredis/built/utils/index.js:381-383` —
  `isResp2SubscriberMode(condition) = Boolean(condition?.subscriber) &&
  condition?.protocol !== 3` — при протоколе 3 функция всегда `false`, значит
  ограничение снято именно и только по причине RESP3. Комментарий технически
  точен.
- **`lazyConnect` + `connect()` → `ready`**: `client.status` до `connect()` —
  `"wait"` (сокет не открыт), после `connect()` — `"ready"`, событие `"ready"`
  зафиксировано слушателем. `enableOfflineQueue: false` не мешает этому пути.

Все 6 сценариев из задания прогнаны на реальном Redis 7.0.15 через реальный
`ioredis@6.0.0` — не мок, не approximation. Скрипт временно клался в корень
репозитория (`.qa-probe-ioredis.mjs`, нужен для резолва `node_modules` через
`tsx`) и удалён после прогона; `git status` после прогона — чистое дерево,
тестовый Redis-инстанс остановлен (`SHUTDOWN NOSAVE`).

### 4. Реальные потребители Redis не сломаны — PASS, с оговоркой
`src/lib/__tests__/rate-limit.test.ts`, `src/lib/realtime/__tests__/sse.test.ts`,
`src/modules/messenger/__tests__/service.test.ts`,
`src/modules/notifications/__tests__/service.test.ts` — все зелёные в общем
прогоне. **Важная оговорка, которую стоит зафиксировать явно**: ни один из
этих unit-тестов не идёт через реальный wire-протокол ioredis — `rate-limit.test.ts`
полностью мокает `@/lib/redis` (`pipeline`/`exec` — `vi.fn()`), `sse.test.ts`
вообще не трогает Redis (чистая cleanup-логика AbortController), messenger/
notifications-тесты мокают Prisma и внутренние модули, до реального ioredis-клиента
не доходят. Это не находка нового бага и не претензия к тестам — это
объективный факт архитектуры юнит-тестов проекта (мок DB/Redis — правило из
`CLAUDE.md` "Tests"), но он означает, что **зелёный `npm test` сам по себе не
доказывает совместимость ioredis 6 с реальным wire-протоколом** — эту часть
закрывает исключительно живой прогон из пункта 3 (который я выполнил отдельно),
плюс новый блок "ioredis CJS-интероп" в `redis-bus.test.ts`, который сознательно
обходит мок и создаёт клиента через тот же `require()`-путь, что и продовый
`getSubscriber()` (хотя и без реального сетевого раунд-трипа — `lazyConnect`
не подключается). Итог: consumers протестированы на уровне бизнес-логики
(правильно), а совместимость с реальным Redis подтверждена отдельно моим
живым прогоном, а не как побочный эффект `npm test`.

### 5. tsx 4.23 не сломал скрипты — PASS
`npx tsx scripts/issue-queue.ts` (без аргументов) → корректный usage-вывод
со списком подкоманд, exit 0. Дополнительно `npx tsx scripts/health-check.ts
http://localhost:39999` (заведомо недоступный порт, ничего разрушительного/
БД/прод не затронуто) → скрипт выполнился до сетевого вызова и корректно
вывел `[Health] Unreachable — fetch failed`, exit 0 — подтверждает, что tsx
4.23 транспилирует и исполняет реальные TS-скрипты проекта (импорты, top-level
await, CLI-парсинг) без регрессий.

### 6. Новые тесты действительно проверяют заявленное — PASS, мутационно подтверждено
Оба новых файла временно ломались и откатывались (`cp` бэкап →
правка → `npx vitest run <file>` → восстановление из бэкапа → повторный зелёный
прогон), финальное состояние репозитория — чистое (`git status --short` пусто).

- `toast.test.tsx`: сломал рендер (`{isVisible && (` → `{false && (`) →
  тест "показывает сообщение при isVisible=true" упал с
  `TestingLibraryElementError: Unable to find an element...`. Восстановил,
  сломал autoHide (убрал `onClose()` из `setTimeout`) → тест "вызывает onClose
  по истечении autoHideDuration" упал (`expected "vi.fn()" to be called 1
  times, but got 0 times`). Восстановил — 3/3 снова зелёные.
- `redis-bus.test.ts` (блок "ioredis CJS-интероп"): убрал `lazyConnect: true`
  из опций клиента в самом тесте → `expect(client.status).toBe("wait")` упал
  (`expected 'connecting' to be 'wait'`) — подтверждает, что assertion
  реально проверяет поведение библиотеки, а не тавтология. Восстановил — 7/7
  снова зелёные.
- Хендлы/таймеры: полный `npm test -- --run` (все 304 файла, включая оба
  новых) завершается штатно за 47.35s без зависаний — если бы `lazyConnect`-тест
  держал открытый сокет/таймер, `vitest run` не завершился бы вовремя.
  Живого Redis для этого теста не требуется (`lazyConnect: true` ⇒ сокет не
  открывается, `client.disconnect()` в конце — тест это явно проверяет).

## Расхождения между заявленным и фактическим

Не найдено. Все количественные заявления PR (4189 тестов / 304 файла, tsc
чисто, lint 0 errors/17 warnings, build успешен, `npm ci` без рассинхрона)
подтверждены один-в-один фактическим прогоном. Технические утверждения в
комментарии `redis-bus.ts` (RESP3 по умолчанию в ioredis 6, снятие
ограничения на подписанном соединении) подтверждены и по исходникам
установленного пакета, и живым прогоном против реального Redis — не просто
правдоподобны, а буквально воспроизведены.

## Security-чеклист (функциональный, по `agents/qa.md`)

- RBAC — не применимо: PR не трогает ни одного API-эндпоинта, модели прав, RBAC-хелперов (`git diff --stat` — только `package.json`, lock, комментарий в `redis-bus.ts`, 2 тест-файла).
- Rate limiting — косвенно затронуто (ioredis — транспорт `rate-limit.ts`): пайплайн-паттерн проверен вживую в п.3, форма ответа не изменилась, `count > limit` продолжит работать корректно.
- Input validation — не применимо, новых входных точек нет.
- Data leakage — не применимо, публичных API-ответов PR не меняет.
- Secrets leakage — `git diff origin/main...HEAD -- src/ | grep -iE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key'` — 0 совпадений (перепроверено).

Все применимые security-кейсы — PASS, неприменимые — обоснованно N/A ввиду характера PR (dependency bump без изменения бизнес-логики/эндпоинтов).

## Что не удалось проверить

- Поведение в кластерном/sentinel-режиме Redis (`cluster-key-slot` в диффе
  lock) — в проде используется single-instance Redis (`REDIS_URL`), эта ветка
  ioredis не задействована ни локально, ни в проде; не проверял, т.к. вне
  скоупа реального использования.
- Полный прод-трафик под нагрузкой (реальный CGNAT-паттерн множества IP через
  rate-limit) — вне возможностей локального окружения; логика пайплайна
  проверена изолированно и её формат ответа не изменился.

## Результат
- Гейт (lint/tsc/test/build/ci): 5/5 PASS, цифры совпадают с заявленными.
- AC верификационного задания (1–6): 6/6 PASS.
- Security: применимые кейсы PASS, остальные обоснованно N/A.
- Расхождений между заявленным и фактическим не найдено.
