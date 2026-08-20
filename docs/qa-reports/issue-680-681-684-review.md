# Review: chore(deps) батч — ioredis 6, framer-motion 13, tsx 4.23 — issues #680/#681/#684, PR #716

## Вердикт: PASS

## Контекст

Батч заменяет три зависшие с 17.08 dependabot-ветки (CI на них падал на `npm ci`
из-за рассинхрона `package.json`↔`package-lock.json`; major-ы #680/#684
не попали под `dependabot-automerge.yml`, т.к. PR открылись до появления
воркфлоу в main). Один PR поверх свежего main с заново сгенерированным локом —
соответствует Scope guard #3 (батч связанных задач — норма, микро-PR не
делаем).

## Acceptance Criteria

Формального PRD/ADR для dependency-bump задач нет — источник правды: сами
issues (#680 ioredis, #681 tsx, #684 framer-motion) + правила supply chain
из `agents/SECURITY.md` §4 и `CLAUDE.md` (авто-мерж гейт по major-ам).

| AC | Статус | Комментарий |
|----|--------|-------------|
| ioredis 5.10.1 → 6.0.0 не ломает rate-limit/realtime | PASS | Проверено по исходникам установленного пакета (`node_modules/ioredis/built/Redis.js:363-366`, `utils/index.js:381-383`): `isResp2SubscriberMode(condition)` возвращает `true` только при `condition.protocol !== 3`; с RESP3 по умолчанию (v6) команда на подписанном соединении больше не отклоняется, и `.mode` (Redis.js:291-297) использует ту же функцию → остаётся `"normal"`. Официальный CHANGELOG (`redis/ioredis` v6.0.0) подтверждает единственный breaking change: `Node >= 20` + `RESP3 по умолчанию`. Полный обход всех потребителей `@/lib/redis` (`grep -rn 'from "@/lib/redis"' src/ bot/` — 43 файла) показал, что используются только `get/set/del/incr/expire/ttl/exists/sadd/srem/pipeline(zadd/zcard/zremrangebyscore/expire)/publish/subscribe` — ни одного RESP3-чувствительного reply-типа (`hgetall`, `config get`, `zscore`, `mget/hmget`, `scan` — нигде не используются). `src/lib/redis.ts` слушает только `ready`/`close`/`error`, обработчика `connect` с командами нет. `.mode` нигде в бизнес-коде не читается (`grep -rn "\.mode\b"` — только `editor.mode`/`props.mode`, к Redis не относятся). `bot/` — не отдельный процесс со своим lockfile, а модуль в том же Next.js-проекте (`bot/handlers/auth-deeplink.ts` импортирует тот же `@/lib/redis`), единый `ioredis` во всём дереве — версийного расхождения между web и bot нет. |
| framer-motion 12.42.2 → 13.1.1 не ломает UI | PASS | Официальный CHANGELOG (`motiondivision/motion`): единственный breaking change v13.0.0 — удаление опционального `@emotion/is-prop-valid` peer-dep, актуально только при `styled-components`/`emotion`, которых в проекте нет (стили — Tailwind). Поверхность использования в проекте — ровно `motion.div` + `AnimatePresence` в `toast.tsx` (встроенные компоненты со своим списком валидных HTML-атрибутов, `is-prop-valid` для них не требовался) и тип `Variants` в `animations.ts`. `tsc --noEmit` по всему проекту — чисто. |
| tsx 4.22.4 → 4.23.12 | PASS | Minor, без breaking changes по CHANGELOG. |
| Комментарий в `redis-bus.ts` не вводит в заблуждение | PASS | Логика файла не менялась — дифф `src/lib/realtime/redis-bus.ts` затрагивает только строки 7-11 (комментарий). Новый текст фактически точен (см. выше проверку по исходникам ioredis); обоснование «отдельного клиента всё равно держим» (не смешивать push-поток с ответами команд, autoResubscribe после реконнекта) соответствует `README.md` ioredis (`autoResubscribe`, документированное поведение). |
| Тесты закрывают заявленные слепые зоны | PASS | `redis-bus.test.ts`: новый блок реально создаёт `ioredis`-клиент через тот же `require()`-путь, что и `getSubscriber()` в проде (а не мок) — так ловит поломку CJS-интеропа/конструктора при следующих апдейтах. `lazyConnect: true` ⇒ сокет не открывается, `client.disconnect()` в конце — прогнан изолированно (`npx vitest run .../redis-bus.test.ts`) и в составе полного прогона: 7/7 тестов, 354мс, никаких зависших хендлов/таймеров, процесс завершается штатно. `toast.test.tsx`: framer-motion не замокан (проверено — ни `vi.mock("framer-motion")`, ни глобального мока в `vitest.config.ts`/сетапе нет), рендер идёт через реальные `motion.div`/`AnimatePresence`; тест autoHide корректно использует `vi.useFakeTimers()`/`vi.advanceTimersByTime()` с `afterEach(() => vi.useRealTimers())`. `@testing-library/react` — существующий devDependency, паттерн `@vitest-environment jsdom` в докблоке уже используется в проекте (базовый `vitest.config.ts` — `environment: "node"`). |

## Scope Check
- Scope creep: Нет.
- Дифф — ровно 5 файлов: `package.json`, `package-lock.json` (регенерирован `npm install`, без ручных правок — см. ниже), комментарий в `redis-bus.ts` (без изменения логики), два новых/расширенных тестовых файла, закрывающих реальные слепые зоны именно этого батча. Каждое изменение прослеживается либо к одному из трёх issues (#680/#681/#684), либо к прямому следствию бампа (тест на реальный контракт, который ловит регресс молча — без него имел бы смысл сомневаться в PASS). Никакого рефакторинга не по делу, никакой не относящейся к задаче правки бизнес-логики.

## Качество кода
- TypeScript strict: OK — `npx tsc --noEmit -p tsconfig.json` чисто.
- ESLint: OK — `npx eslint` по всем 3 нетривиальным файлам диффа (`redis-bus.ts`, `redis-bus.test.ts`, `toast.test.tsx`) — 0 замечаний.
- Тесты: OK — `npm test -- --run` → **304 test files / 4189 tests, все зелёные**.
- package-lock.json: чистый регенерированный дифф — только `ioredis`/`framer-motion`/`tsx` и их прямые транзитивные зависимости (`@ioredis/commands`, `cluster-key-slot`, `debug`, `denque`, `redis-errors`, `standard-as-callback` для ioredis; `motion-dom`, `motion-utils`, удаление опционального `@emotion/is-prop-valid` для framer-motion). Нет вложенных дублей (`node_modules/ioredis/node_modules/...` — отсутствуют), `lockfileVersion: 3` не менялся, версии в lock совпадают с диапазонами `^13.1.1`/`^6.0.0`/`^4.23.12` из `package.json`. Понижение `cluster-key-slot` 1.1.2→1.1.1 — не даунгрейд решения проекта, а точный пин, который сам объявляет `ioredis@6.0.0` в своём `package.json` (единственный потребитель пакета в дереве — проверено).

## Безопасность

### Secrets leakage
`git diff origin/main...HEAD -- src/ | grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — 0 совпадений. `.env*` не затронут.

### RBAC
Не применимо — PR не трогает ни одного API-эндпоинта, ни модели прав. Подтверждено: `git diff --stat` содержит только `package.json`, `package-lock.json`, комментарий в `redis-bus.ts`, два тестовых файла.

### Supply chain
- Новых зависимостей (новых имён пакетов в `package.json`) не добавлено — только version bump трёх уже существующих, давно используемых в проекте пакетов.
- `ioredis`, `framer-motion`, `tsx` — все крупные, активно поддерживаемые (тысячи ⭐, регулярные релизы), не typosquat.
- Лицензии всех затронутых пакетов (прямых и транзитивных, включая новые/пересобранные записи в lock) — MIT/Apache-2.0, GPL/AGPL нет (проверено по `package-lock.json`).
- `npm audit --audit-level=high` на PR-ветке: 19 уязвимостей (1 low / 3 moderate / 12 high / 3 critical) — все в пакетах, не относящихся к этому диффу (`@auth/core`, `next-auth`, `next`, `prisma`, `sharp`, `xlsx`, `undici` и т.д.); ни `ioredis`, ни `framer-motion`, ни `tsx`, ни их транзитивные зависимости в списке не фигурируют. Состояние унаследовано от `main`, этим PR не ухудшено.

### Injection / Dangerous ops
`git diff origin/main...HEAD -- src/ | grep -iE 'executeRawUnsafe|dangerouslySetInnerHTML|rm -rf|--force|reset --hard'` — 0 совпадений.

**Итог по Security: инцидентов не найдено.**

## Что хорошо
- Автор не просто продекларировал безопасность major-ов, а показал ход проверки прямо в commit message (протокол согласования RESP3, форма ответа rate-limit-пайплайна, hgetall, subscriber-режим) — при независимой перепроверке по исходникам установленного пакета и официальному CHANGELOG все утверждения подтвердились без единого расхождения.
- Тесты добавлены целенаправленно под конкретный, реально существовавший пробел (динамический `require("ioredis")` вне контроля `tsc`, framer-motion без единого рендер-теста) — не «для галочки», а закрывают ровно тот сценарий, где major мог бы тихо сломать прод при зелёном CI.
- Комментарий в `redis-bus.ts` исправлен по факту, а не просто актуализирован «на всякий случай» — старый текст был не про RESP3 вообще, новый явно объясняет, почему архитектура (отдельный subscriber-клиент) остаётся правильной даже когда техническое ограничение снято.
- `package-lock.json` — образцовый диф для dependency bump: ничего лишнего, ничего вручную подправленного, все транзитивные изменения объяснимы.
