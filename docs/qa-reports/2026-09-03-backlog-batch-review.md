# Review: Batch — backlog automation/monitoring cleanup (2026-09-03)

RUN_ID: `2026-09-03-backlog-batch`
Issues: #835, #730 (dependabot-commands-from-sessions, dependabot-group-red-stuck), #728 (flaky-cancellation-boundary), #717 (router-state-header-parse, rsc-invariant-text-plain), #720 (executedecision-lib, batchadd-list-consistency), #708, #736, #719 (bottleneck-map-retro), #805 (+ #757/#758 dependabot ignore)

## Вердикт: NEEDS_CHANGES

Один конкретный, легко исправимый scope-creep item (см. п.1 ниже). Всё
остальное — тесты, типы, security, соответствие issues — в порядке; после
фикса пункта 1 это PASS без оговорок.

---

## Acceptance Criteria (по issue)

| Issue | Статус | Комментарий |
|---|---|---|
| #835 (дедуп чек-ранов) | PASS | `latestCheckRunsByName`/`summarizeChecks` в `scripts/lib/issue-queue.ts:872-937` группируют по имени, берут самый свежий по `started_at`→`id`→порядку в списке. Тест `scripts/__tests__/issue-queue.test.ts:1099-1156` прямо проверяет и «старый cancelled перекрыт свежим success → green», и обратный случай «свежий cancelled после старого success → по-прежнему red» — подмены не происходит. |
| #730 dependabot-commands-from-sessions | PASS | `canCommandDependabot` из `HAS_PAT` (`scripts/issue-queue.ts:857-860`), без PAT `dependabotHealAction` сразу `to-queue` вместо мёртвой просьбы к боту (`scripts/lib/issue-queue.ts:784-790`). CLAUDE.md синхронизирован (раздел «Мерж», строки 197-200). |
| #730 dependabot-group-red-stuck | PASS | Отказ бота «only users with push access» после отправленной просьбы тоже переводит в `to-queue` (`scripts/lib/issue-queue.ts:792-798`), тест `scripts/__tests__/issue-queue.test.ts:1040-1062` покрывает и «отказ относится к текущей просьбе», и «отказ от старой просьбы не считается». |
| #728 flaky-cancellation-boundary | PASS | Общая точка `now` в `src/modules/booking/__tests__/cancellation.test.ts:37-45`, устраняет гонку часов на границе 2.0h. |
| #717 router-state-header-parse / rsc-invariant-text-plain | PASS с оговоркой | Оба заявленных паттерна реализованы и покрыты тестами (`src/lib/server-error-classify.ts:17-24`, `src/__tests__/instrumentation.test.ts:168-198`). См. п.1 — третий паттерн в этом же списке не привязан к issue. |
| #720 executedecision-lib | PASS | `executeDecision` вынесен в `scripts/lib/decision-executor.ts` с инжектируемым `DecisionIo`; сверил построчно со старой веткой в `git diff` — логика идентична (grace-окно, пин к SHA, `merge-hold`/`blocked-question`/`owner-idea`/`pat-rotation`), только I/O теперь за интерфейсом. 20 юнит-тестов в `scripts/lib/__tests__/decision-executor.test.ts`. |
| #720 batchadd-list-consistency | PASS | In-process кэш `createdBatches`/`addedComments` в `scripts/lib/batch-io.ts:57-75` компенсирует eventual consistency листинга; `resetBatchIoCache()` для тестов. 5 тестов в `scripts/lib/__tests__/batch-io.test.ts`, включая гонку двух `batchAdd` подряд и потолок `maxItems` с недоотданными GitHub комментариями. |
| #708 (root cause notifications-down) | PASS | Повтор пробы — только после `transportError` (не после ошибки API), гистерезис в Redis с TTL 30 мин, порог 3, Redis недоступен → старое поведение (503 сразу). `ok` дополнительно требует `queueCheck.failedLastHour === 0 && ownerDecisionsCheck.ok` — гистерезис не глушит остальные проверки. 9 новых тестов в `src/modules/notifications/__tests__/health.test.ts:210-313`, включая «смешанный отказ (транспорт + API-ошибка) не считается флапом» и «Redis упал на INCR — fail-safe, не проброс исключения». |
| #736 (root cause site-down) | PASS | Маркер `<!-- watchdog:probe-flap -->` ставится ТОЛЬКО когда ремедиация вызвала `finish healthy` по ветке `public_ok` в самом начале скрипта (`scripts/watchdog-remediate.sh:101-104`) — единственный путь, где `WATCHDOG_RESULT=healthy` и `nothing to fix` совпадают одновременно; любое реальное восстановление (docker/nginx-рестарт) идёт через `finish recovered`, флап-классификация не может поглотить настоящий инцидент. Порядок шагов в `site-watchdog.yml` корректный: `PROBE_FLAP` считается в шаге «Save report to file» (строка 368) раньше обоих потребителей — «Telegram alert» (385) и «Open or update site-down issue» (439). Разбор в `docs/incidents/2026-09-03-site-down-probe-flaps.md` без PII/секретов. |
| #719 bottleneck-map-retro | PASS | Секцию «Ретро 2026-09-03» проверил построчно против кода: `block-native-automerge.yml`, `merge-gate-check.yml`, `src/lib/event-sources.ts`, чек «AC-трассируемость (отчёт)» в `ci.yml:63`, `docs/pipeline-runs/next-issue.jsonl` (3 строки) — все факты подтверждаются. |
| #805 (красный dependabot-PR #802) | PASS | Ровно те же 10 minor/patch бампов, что в #802 (grammy 1.46.0, isomorphic-dompurify 3.23.0 pinned, next 16.3.3 pinned, resend 6.24.0, @testing-library/react 16.3.3, @testing-library/user-event 14.6.6, @types/node 26.4.0, @types/react-dom 19.2.5, eslint 10.9.1, eslint-config-next 16.3.3 pinned). `npm ci --dry-run` проходит чисто на перегенерированном `package-lock.json`. |
| #757/#758 (dependabot ignore для major typescript/nodemailer) | PASS, не заявлен явно в списке issues, но легитимен | `.github/dependabot.yml` изменения привязаны к реальным открытым issues #757 (typescript-eslint не поддерживает TS7) и #758 (nodemailer 9 конфликтует с peer next-auth) — оба подтверждены через GitHub API, PR #749/#748 закрыты. Коммит-месседж это явно называет. Это добавление к батчу той же тематической области (dependencies), backed своей issue — соответствует Scope guard #3, не scope creep. |

---

## Scope Check

- Scope creep: **Да, один пункт.**
- Лишнее изменение: `src/lib/server-error-classify.ts:22-23` (третий паттерн `/Failed to find Server Action/i`) + соответствующие тест-кейсы в `src/lib/__tests__/server-error-classify.test.ts:9,15` и `src/__tests__/instrumentation.test.ts:172`.

  Issue #717 — общий зонтик, но конкретные пункты в нём (обязательный процесс
  зонтиков, CLAUDE.md/«Автоочередь») — это `batch-item`-комментарии:
  `router-state-header-parse` (issues #702-706, RSC router-state текст) и
  `rsc-invariant-text-plain` (issues #701/#707, RSC invariant текст). Я проверил
  все открытые/закрытые issues репозитория по паттерну `server-error`
  (`gh issues?state=all`) — ни один не упоминает `Failed to find Server Action`.
  Собственный код-коммент в `server-error-classify.ts:9` тоже ссылается только
  на `#701/#702` как источник («паттерны #701/#702… две недели ходили по
  интейку как ERROR») — то есть у самого автора нет production-инцидента,
  оправдывающего третий паттерн, он его добавил проактивно, без наблюдаемого
  случая и без `batch-add` на #717.

  Функционально паттерн безопасен (официально задокументированное сообщение
  Next.js именно для stale-deployment сценария, не может маскировать
  прикладной баг) и покрыт тестом — риска для мониторинга это не несёт. Но по
  букве CLAUDE.md Scope guard #5 («Scope creep — это… код без своей
  задачи/PRD») это неподтверждённое расширение классификатора сверх
  заявленных двух паттернов.

  **Исправление (любое из двух, на выбор Developer):**
  1. Убрать `Failed to find Server Action` из `CLIENT_INDUCED_FRAMEWORK_ERRORS`
     и соответствующие тест-кейсы; вернуть, когда паттерн реально появится в
     интейке (`analyze-errors.ts` заведёт issue/пункт зонтика).
  2. Оставить, но добавить `batch-item` на #717 (`npx tsx scripts/issue-queue.ts
     batch-add --area server-error --key server-action-stale-deploy --title
     "..."`) с обоснованием источника (реальный `SystemEvent`/инцидент или явное
     решение владельца), чтобы у изменения была своя задача, как того требует
     процесс зонтиков.

- Больше лишних изменений не найдено. Все остальные файлы прямо соответствуют
  перечисленным issues; batch дополнительно закрывает #757/#758 — легитимно
  (см. таблицу выше).

---

## Архитектура

- Бизнес-логика вне route handlers: `notificationsHealth()` в
  `src/modules/notifications/health.ts`, route (`src/app/api/notifications/health/route.ts`)
  только читает результат и логирует — соответствует конвенции.
- `executeDecision` теперь чистая функция над инжектируемым `DecisionIo` — явное
  улучшение тестируемости, поведение идентично старому (построчно сверено).
- CLI (`scripts/issue-queue.ts`) остаётся тонкой прослойкой I/O над
  `scripts/lib/*` — паттерн выдержан последовательно для новых модулей
  (`decision-executor.ts`, обновлённый `batch-io.ts`).
- API-контракты не менялись (никаких новых endpoint'ов); `/api/notifications/health`
  остаётся публичным health-check без RBAC, как и было документировано в его
  собственном докстринге — соответствует изначальному назначению.

---

## Качество кода

- TypeScript strict, нет `any`: OK (`npx tsc --noEmit` — 0 ошибок).
- Zod-валидация: N/A — в батче нет новых API-входов пользовательских данных.
- API-формат (`apiResponse`/`apiError`): не затронут (единственный route не менялся в части формата ответа).
- Тесты: OK — `npx vitest run` 4490/4490 зелёных, `npm run lint` 0 ошибок (21 warning — все в непричастных файлах: `messenger/*`, `telephony/novofon-client.ts`, `notifications/service.ts`).
- Комментарии в коде содержательные и снабжены ссылками на issue/данные (замеры, фингерпринты) — выше среднего уровня документированности решений.

---

## Безопасность

### Secrets leakage
- `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по всему диффу — совпадения только на именах переменных окружения (`GITHUB_TOKEN`, `AUTOMATION_TOKEN`, `OWNER_DECISIONS_SECRET`, `HAS_PAT`) в комментариях/тексте документации, ни одного литерального значения.
- Новые поля в ответе `/api/notifications/health` (`degraded.reason/flapStreak/failedProbes`, `checks.*.transportError`) — только имена проб (`"botToken"`, `"adminChat"`, `"ownerChat"`) и человекочитаемый текст без токенов/чата ID.
- `.env*` не тронут, не добавлен в git.

### RBAC
- Новых endpoint'ов нет. Единственный изменённый route (`/api/notifications/health`) — намеренно публичный health-check (задокументировано в его собственном docstring, использовался smoke-тестами деплоя и до этого PR); RBAC-требование к нему не применимо.

### Supply chain
- 10 minor/patch бампов существующих зависимостей (не новые пакеты), сохранены прежние стратегии пиннинга (`next`, `isomorphic-dompurify`, `eslint-config-next` — точные версии без `^`, как и раньше). `npm ci --dry-run` проходит чисто на перегенерированном lock-файле.
- Новые dependabot-ignore правила (typescript major, nodemailer major) — политика подавления шумных красных PR, не установка новых пакетов; обоснована в комментариях YAML и коммит-месседже, backed реальными issues #757/#758.

### Injection
- Raw SQL/`$executeRawUnsafe`: нет (в диффе не затронуты Prisma-модели вообще).
- `dangerouslySetInnerHTML`: нет.
- Grep всего диффа на `rm -rf|push --force|reset --hard|DROP TABLE|DROP COLUMN|TRUNCATE` — пусто.

### Dangerous ops
- Нет деструктивных git/shell операций в новых/изменённых скриптах.
- Гистерезис #708 не ослабляет обнаружение реальных поломок: ошибки Telegram API (`Unauthorized`, `chat not found`) не попадают под `transportError` и валят health немедленно (`src/modules/notifications/health.ts:296-301`, тест `health.test.ts:266-276`); смешанный отказ (часть проб — транспорт, часть — API) тоже не засчитывается в серию (`failedProbes.every(p => p.check.transportError)`, тест `health.test.ts:280-287`); при недоступном Redis — старое поведение 503 сразу (`bumpTransportFlapStreak` возвращает `null`, тест `health.test.ts:290-297`). `notificationsHealth()` используется только диагностическим route, не гейтит реальную отправку уведомлений — риск ограничен качеством мониторинга, не функциональностью.
- Классификация #717 — закрытый список из 3 regex (не catch-all), всё неизвестное остаётся ERROR; функционально не может замаскировать прикладной баг (все три паттерна — документированные внутренние сообщения Next.js для конкретных non-app сценариев). Единственная претензия — к процессу обоснования третьего паттерна (см. Scope Check).
- Дедуп чек-ранов #835 не даёt зелёный при «свежий cancelled после старого success» — явно протестировано и разобрано выше.

**Security-инцидентов не найдено.** Вердикт NEEDS_CHANGES вынесен не по
security, а по scope-creep пункту (см. выше) — согласно чеклисту это
отдельное основание, не отменяющее оценку остальных пунктов как PASS.

---

## Что исправить (для NEEDS_CHANGES → PASS)

1. `src/lib/server-error-classify.ts:22-23` — паттерн `/Failed to find Server Action/i`
   не привязан ни к одному issue/batch-item на #717. Либо убрать (и связанные
   тест-кейсы в `src/lib/__tests__/server-error-classify.test.ts` и
   `src/__tests__/instrumentation.test.ts`), либо завести под него `batch-item`
   на #717 с указанием источника (реальный `SystemEvent`/инцидент), прежде чем
   мержить. Это единственный блокер.

---

## Что хорошо

- Тестовое покрытие исключительно тщательное для инфраструктурного кода:
  граничные случаи (Redis недоступен/упал посреди операции, смешанные отказы,
  «свежий cancelled после старого success», гонка `batchAdd`, отказ бота от
  старой vs текущей просьбы) — покрыты явно и с говорящими описаниями.
- `#720` executedecision-lib — образцовый рефакторинг: чистая функция +
  инжектируемый I/O, поведение сверено построчно со старой версией, ничего не
  потеряно и не изменено по смыслу.
- `#736` разбор в `docs/incidents/2026-09-03-site-down-probe-flaps.md` —
  редкий случай, когда root-cause анализ действительно объясняет механику
  (таблица трёх циклов, общий паттерн с #708, явное «что не трогали» и
  почему), а не просто закрывает issue.
- `#708` гистерезис спроектирован консервативно: реальные поломки (API-ошибки,
  смешанные отказы, недоступный Redis) осознанно выведены из-под смягчения —
  видно, что авторы проверяли именно этот риск, а не просто заглушили шум.
- `#719` ретро — все фактические утверждения проверяются по коду и
  подтвердились; отдельная ценность — секция «Новые узкие места», которая сама
  честно называет находки этого же PR как реакцию на найденный шум мониторинга.
- CLAUDE.md синхронизация (#730) — маленькая, точная, без разрастания.
