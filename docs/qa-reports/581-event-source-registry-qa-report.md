# QA-отчёт: Issue #581 — реестр SystemEvent.source и миграция на logger.ts

## Вердикт: PASS

---

## Контекст

- Ветка `claude/issue-581-event-source-registry`, 2 коммита поверх `main`: `52209f2`
  (имплементация) + `caf256f` (отчёт code-reviewer'а). `git status` — чистое дерево на
  момент проверки.
- Нет PRD (`docs/requirements/` не содержит записи по 581) — задача из автоочереди
  `/next-issue`, источник правды — текст issue + F4-находка аудита
  `docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md`. `docs/qa-reports/issue-581-review.md`
  прочитан для контекста, ниже — независимая перепроверка, не пересказ его выводов.

## Регрессия

- `npm test -- --run`: **269 test files passed (269), 3810 tests passed (3810)**, 0 failed.
- `npx tsc --noEmit`: чисто, пустой вывод.
- `npm run lint`: **0 errors, 16 warnings** — все pre-existing, в файлах вне диффа
  (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`).

## Проверка ключевых файлов (прочитаны сам, не по пересказу)

- `src/lib/event-sources.ts` — новый файл, 35 констант `EVENT_SOURCES` + union-тип
  `EventSource`. Шапка файла явно перечисляет 4 значения "НЕ переименовывать" и 3
  переименованных.
- `src/lib/logger.ts` — `logEvent`, `alertCritical`, все методы `log.*` типизированы
  через `EventSource` вместо `string`; единственный оставшийся `prisma.systemEvent.create`
  в проекте — именно здесь (строка внутри самого logger).
- `eslint.config.mjs` — добавлен `no-restricted-syntax` с AST-селектором на
  `CallExpression[callee.property.name='create'][callee.object.property.name='systemEvent']`
  для `src/**/*.{ts,tsx}`, с override, снимающим правило только для `src/lib/logger.ts`.

## Живая проверка ESLint-правила

Создал временный файл `src/lib/__qa_throwaway_581.ts` с сырым `prisma.systemEvent.create(...)`,
прогнал `npx eslint` — правило сработало (`no-restricted-syntax`, ожидаемое сообщение про
issue #581), файл удалён сразу после проверки. `git status --short` после удаления — пусто,
следов не осталось.

## Живая проверка типобезопасности `EventSource`

В `src/lib/avito/calls.ts:194` временно заменил `EVENT_SOURCES.AVITO_CALLS` на опечатку
`"avito.calsl"`. `npx tsc --noEmit` немедленно выдал ошибку ровно в этой точке:
`error TS2345: Argument of type '"avito.calsl"' is not assignable to parameter of type 'EventSource'`.
Откатил (`git checkout -- src/lib/avito/calls.ts`), `git status` снова чист, `tsc --noEmit`
снова чист.

## Поведенческое изменение — POST /api/monitoring/client-error (500 → 200)

Прочитал `src/app/api/monitoring/client-error/route.ts` и вызывающий браузерный код
`src/components/ClientErrorBeacon.tsx` независимо:

- Роут теперь всегда возвращает 200 `{accepted:true}` после прохождения Zod-валидации —
  `logClientError` вызывает `log.warn`, который не бросает (внутренний try/catch с
  console-fallback в `logger.ts`), внешний try/catch в роуте убран как мёртвый код.
- `ClientErrorBeacon.tsx:32-39` — `fetch(...).catch(() => {})`, без `.then`, без проверки
  `res.ok`/`res.status`, без retry, `keepalive: true` — fire-and-forget. Статус ответа браузером
  не инспектируется вообще, разница 200 vs 500 для клиента не наблюдаема.
- `grep -rn "client-error"` по всему репозиторию (включая `.github/workflows/`, `scripts/`)
  — совпадения только в самих файлах роута/компонента/теста/beacon-lib и в документации
  (`CLAUDE.md`, ADR аудита); ни один сторонний скрипт/воркфлоу/дашборд не завязан на конкретный
  код ответа этого эндпоинта.
- Тест `route.test.ts` обновлён консистентно: явный кейс "still accepts the beacon when the DB
  write fails" проверяет 200 + `success:true` + `accepted:true`, при этом сохранена проверка на
  отсутствие утечки деталей ошибки в тело (`not.toContain("db down")`).

Вывод: изменение реальное, задокументировано в doc-комментарии роута, безопасно с точки зрения
внешнего контракта — единственный вызывающий код его не наблюдает, сторонних зависимостей нет.

## Проверка "не переименовывать" значений — посимвольно, оба конца

| Значение | Источник константы | Читатель | Совпадение |
|---|---|---|---|
| `client-beacon`, `rate-limit` | `EVENT_SOURCES.CLIENT_BEACON`, `.RATE_LIMIT` | `scripts/lib/log-reader.ts:21` `WARNING_SOURCES = ['client-beacon', 'rate-limit']` | точное |
| `server-error` | `EVENT_SOURCES.SERVER_ERROR` | `scripts/lib/pattern-extractor.ts:58` `entry.source === 'server-error'` | точное |
| `cron.processOutgoing` | `EVENT_SOURCES.CRON_PROCESS_OUTGOING` | `src/modules/notifications/health.ts:118` `where: { source: "cron.processOutgoing" }` | точное |

Прочитаны оба конца сам, не через доверие ревью — все три совпадают.

## Проверка переименованных значений (нет орфанных зависимостей на старую строку)

`grep -rn` по `src/`, `scripts/`, `bot/`, `landing-delovoy-park.ru/`:
- `"scheduler"` (точный литерал) — 0 совпадений вне комментария в `event-sources.ts`.
- `cron/inventory`, `cron/process-recurring` — совпадения только в URL-путях/console.error-метках
  (`/api/cron/inventory`, `/api/cron/process-recurring` route-комментарии), не в `source`-полях
  `SystemEvent` — не связаны с миграцией.

## Проверка транзакционных исключений (5 штук)

Прочитал `src/modules/payments/service.ts` и все 3 `subjects/*.ts`: все 5
`tx.systemEvent.create` имеют `eslint-disable-next-line no-restricted-syntax` прямо над строкой
и `source: EVENT_SOURCES.PAYMENTS`. Проследил цепочку вызовов для самого неочевидного —
`service.ts:239` (внутри `applySubjectEffectsOnSuccess`) — вызывается на `service.ts:290`,
что физически внутри `prisma.$transaction(async (tx) => {...})` (открывается на `service.ts:276`,
тот же `tx` прокидывается насквозь). Атомарность подтверждена по коду, не по описанию.

## Полнота миграции

`grep -rln "systemEvent"` с последующим `grep -ln "\.create("` по `src/`, `scripts/`, `bot/`,
`landing-delovoy-park.ru/` — ровно 5 файлов: `logger.ts` (разрешённый writer) + 4 файла модуля
payments (5 задокументированных транзакционных исключений). Ни одного пропущенного прямого
writer'а.

## Скимминг миграции колл-сайтов

Прочитал diff `src/app/api/cron/inventory/route.ts` и `src/modules/booking/overdue-reminders.ts`
целиком — механическая замена `prisma.systemEvent.create({data:{level,source,message,metadata}})`
на `log.warn(EVENT_SOURCES.X, message, metadata)`, без изменения уровня/сообщения/метаданных,
`"scheduler"` → `EVENT_SOURCES.BOOKING_SCHEDULER` (`"booking.scheduler"`) применено консистентно
во всех 4 местах файла.

## Scope check

`git diff main...HEAD --stat` — 25 файлов (24 кода/тестов + 1 review-отчёт), в рамках заявленного
диффа. `package.json`, `package-lock.json`, `prisma/schema.prisma`, `CLAUDE.md` не тронуты — новых
зависимостей/модулей нет.

## Security-чеклист (функциональный)

- RBAC: миграция не добавляет новых эндпоинтов/прав, только меняет способ логирования —
  неприменимо напрямую, регрессии не найдено.
- Data leakage: `route.test.ts` подтверждает, что детали ошибки БД (`"db down"`) не попадают в
  тело ответа и при новом 200-контракте.
- `grep -iE '(password|token|secret|api[_-]key)'` по диффу — 0 совпадений.
- Секреты/`.env*` не тронуты, новых зависимостей нет.

## Итог

- AC (из issue): реестр источников, типизация logger.ts, миграция колл-сайтов, ESLint-правило,
  сохранение "не переименовывать" значений, зелёные тесты — все PASS, каждый проверен
  самостоятельно (не пересказ ревью).
- Регрессия: `npm test` 269/269 файлов, 3810/3810 тестов; `tsc --noEmit` чисто; `lint` 0 ошибок.
- Живые проверки ESLint-правила и типобезопасности `EventSource` — обе воспроизведены
  independently, throwaway-артефакты не оставлены (`git status` чист).
- Поведенческое изменение client-error route (500→200) — безопасно: единственный вызывающий код
  не инспектирует статус, сторонних зависимостей нет, тест обновлён консистентно.
- "Не переименовывать" значения сверены посимвольно на обоих концах — совпадают.
- 5 транзакционных исключений — атомарность подтверждена трассировкой вызовов по коду.

Security-блокеров не найдено. **Вердикт: PASS.**
