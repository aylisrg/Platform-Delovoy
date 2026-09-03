# QA-отчёт: Batch — backlog automation/monitoring cleanup (2026-09-03)

RUN_ID: `2026-09-03-backlog-batch`
PR: #839, ветка `claude/close-prs-resolve-issues-b0wv6m` → `main`
Issues: #835, #730 (`dependabot-commands-from-sessions`, `dependabot-group-red-stuck`),
#728 (`flaky-cancellation-boundary`), #717 (`router-state-header-parse`,
`rsc-invariant-text-plain`, `failed-server-action-stale-deploy`), #720
(`executedecision-lib`, `batchadd-list-consistency`), #708, #736, #719
(`bottleneck-map-retro`), #805 (+ #757/#758 dependabot ignore)

PRD нет — AC выведены из текстов issues/комментариев зонтиков (GitHub API) и
из отчёта Reviewer'а `docs/qa-reports/2026-09-03-backlog-batch-review.md`
(вердикт PASS, единственный блокер прошлого раунда — источник у пункта
`failed-server-action-stale-deploy` — закрыт batch-item-комментарием на #717).

## Вердикт: PASS

---

## Регрессия и сборка

| Проверка | Результат |
|---|---|
| `npx vitest run --reporter=dot` | 320 test files, **4490/4490** зелёных |
| `npx tsc --noEmit` | 0 ошибок |
| `npm run lint` | **0 errors**, 21 warning — все в файлах вне диффа (`src/components/admin/sidebar.tsx`, `src/components/auth/vk-community-banner.tsx`, `src/components/messenger/*`, `src/modules/messenger/types.ts`, `src/modules/notifications/service.ts`, `src/modules/telephony/novofon-client.ts`) |
| `npm ci --dry-run --ignore-scripts` | проходит чисто (108 добавлений — резолв платформо-специфичных опциональных зависимостей, ожидаемо) |
| `python3 -c "import yaml; ..."` для `.github/dependabot.yml` и `.github/workflows/site-watchdog.yml` | оба валидны |

## Mutation-check

Временно отключил дедуп чек-ранов в `summarizeChecks` (`scripts/lib/issue-queue.ts:927`,
`const runs = latestCheckRunsByName(allRuns)` → `const runs = allRuns`) и прогнал
`scripts/__tests__/issue-queue.test.ts`. Упали ровно 2 новых теста из блока
«summarizeChecks — один чек-ран на имя, самый свежий (issue #835)»:
- `cancelled-прогон гейта, перекрытый более свежим success с тем же именем — CI зелёный`
- `cancelled + более свежий in_progress того же имени — ждём, а не считаем провалом`

Остальные 159 тестов файла (включая «свежий cancelled после старого success —
по-прежнему красный» и «разные имена не склеиваются») остались зелёными —
тесты специфичны к фиксу, а не к побочному эффекту. Откатил мутацию
(`git checkout -- scripts/lib/issue-queue.ts`), перепрогнал файл — 161/161 зелёных.

Финальный `git status --short` — пусто (кроме этого отчёта и `.claude/feedback/qa-patterns.md`, которые пишу этим прогоном).

---

## Проверка по пунктам батча

### 1. #835 — дедуп чек-ранов гейта (`scripts/lib/issue-queue.ts`)

| AC | Статус |
|---|---|
| Cancelled-ран, перекрытый более свежим success того же имени → green | PASS — тест `scripts/__tests__/issue-queue.test.ts:1109-1119`, подтверждён mutation-check |
| Свежий cancelled после старого success → red (побеждает свежесть, не «лучший» исход) | PASS — `issue-queue.test.ts:1121-1129` |
| Cancelled + in_progress того же имени → pending (не failed) | PASS — `issue-queue.test.ts:1131-1139`, подтверждён mutation-check |
| Разные имена не склеиваются | PASS — `issue-queue.test.ts:1146-1153` |
| Без `started_at` — свежесть решает `id`; без обоих — последний в списке | PASS — `issue-queue.test.ts:1141-1144` |

`latestCheckRunsByName`/`summarizeChecks` (`scripts/lib/issue-queue.ts:882-942`)
группируют строго по `name`, выбор свежести — `started_at` → `id` → порядок в
списке, реализация читаема и соответствует комментарию.

### 2. #730 — dependabot heal (зонтик `automation`)

| AC | Статус |
|---|---|
| Без `canCommandDependabot` (`HAS_PAT` ≠ `yes`) → `to-queue`, а не мёртвая просьба | PASS — `dependabotHealAction` (`scripts/lib/issue-queue.ts:772-808`), тест `issue-queue.test.ts` (блок `dependabotHealAction`, кейс «PAT нет — сразу задача») |
| Ответ бота «only users with push access» после отправленной просьбы → `to-queue` | PASS — `DEPENDABOT_COMMAND_REJECTED_RE`, тест на строках ~1044-1052 |
| Отказ от СТАРОЙ просьбы (до текущей) не считается | PASS — тест `issue-queue.test.ts:1056-1063` («отказ бота, оставшийся от старой просьбы... не считается: свежую просьбу ждём») |
| CLI (`healDependabotPr`) берёт `HAS_PAT` из env | PASS — `scripts/issue-queue.ts:859` (`process.env.HAS_PAT === 'yes'`) |
| Текст создаваемой задачи содержит причину эскалации | PASS — `scripts/issue-queue.ts:877` («Причина эскалации: ${reason}») |
| CLAUDE.md синхронизирован | PASS — `git diff origin/main...HEAD -- CLAUDE.md` добавляет абзац про `HAS_PAT=yes` в разделе «Мерж» |

Оба пункта зонтика закрыты `batch-result`-комментарием на #730
(`- [x] dependabot-commands-from-sessions`, `- [x] dependabot-group-red-stuck`).

### 3. #728 — flaky cancellation boundary

`src/modules/booking/__tests__/cancellation.test.ts:37-45`: тест «exactly at
threshold boundary (2.0h)» теперь берёт общий `now = new Date()` и передаёт
его в `hoursFromNow(2.0, now)` вместо двух независимых `new Date()`. Граница
детерминирована — PASS.

### 4. #717 — server-error классификация (зонтик `server-error`)

| AC | Статус |
|---|---|
| `The router state header was sent but could not be parsed` → `log.warn`, `classification: client-induced` | PASS — `src/lib/server-error-classify.ts:21`, тест `server-error-classify.test.ts:6`, `instrumentation.test.ts:168-198` |
| `Invariant: Expected RSC response, got text/plain` (и `text/html`) → то же | PASS — `server-error-classify.ts:23` |
| `Failed to find Server Action` → то же | PASS — `server-error-classify.ts:27`, `instrumentation.test.ts` |
| Всё остальное → `log.error`, без поля `classification` | PASS — `instrumentation.test.ts` «неизвестная ошибка рендера остаётся ERROR без classification» — явно проверяет `not.toHaveProperty("classification")` |
| Троттлинг по digest сохранён | PASS — не тронут, тест `instrumentation.test.ts` «троттлинг по digest работает и для WARNING-класса» |
| Нет PII/заголовков в metadata | PASS — `onRequestError` берёт только `path/method` из аргументов Next.js, заголовки не читаются вообще (см. докстринг `src/instrumentation.ts:47-49`) |

Все три паттерна имеют свой `batch-item` на #717 с проверяемым источником
(третий, `failed-server-action-stale-deploy`, добавлен по замечанию Reviewer'а
и подтверждён прямой цитатой из issues #694/#711/#735 — перепроверил
самостоятельно через GitHub API, тексты совпадают дословно с описанием в
batch-item). Зонтик закрыт (`batch-result` со всеми тремя пунктами, включая
поздний).

### 5. #720 — decision-executor.ts / batch-io.ts (зонтик `infra`)

`executedecision-lib`: `scripts/lib/decision-executor.ts` — сравнил построчно
со старой версией `executeDecision` из `git show origin/main:scripts/issue-queue.ts`
(строки 1659-1789 старого файла). Логика идентична 1:1 (grace-окно, пин к SHA,
ветвление `merge-hold`/`blocked-question`/`owner-idea`/`pat-rotation`), только
прямые `gh()`/`comment()`/`patchDecision()` заменены на методы инжектируемого
`DecisionIo`. Вызывающий код (`scripts/issue-queue.ts:1645-1669`, функция
`decisionIo()`) собирает реализацию интерфейса из тех же старых хелперов —
поведение при исполнении не изменилось. 20 тестов в
`scripts/lib/__tests__/decision-executor.test.ts` — PASS.

`batchadd-list-consistency`: `scripts/lib/batch-io.ts:57-176` — in-process кэш
`createdBatches`/`addedComments` компенсирует eventual consistency листинга
GitHub. Прогнал `scripts/lib/__tests__/batch-io.test.ts` отдельно — 5 тестов
зелёные, включая точный AC-сценарий «два batchAdd подряд при отстающем
листинге → один зонтик» (`batch-io.test.ts:50-61`) и «дедуп ключа видит
пункт, дописанный этим же процессом» (`batch-io.test.ts:63-76`). Механика уже
подтверждена в проде: `failed-server-action-stale-deploy` заведён этим же
кодом без дублей (см. п.4 выше и review-отчёт).

### 6. #708 — notifications health (root-cause `notifications-down`)

Прочитал `src/modules/notifications/health.ts` целиком.

| AC | Статус |
|---|---|
| Повтор пробы — только после `transportError` | PASS — `probeWithRetry` (`health.ts:80-86`): `if (first.ok \|\| !first.transportError) return first` |
| Серия < 3 чисто транспортных сбоев → `ok:true` + `degraded` + WARNING в роуте | PASS — `health.ts:297-309` (`streak < TELEGRAM_TRANSPORT_FLAP_STREAK`), route `src/app/api/notifications/health/route.ts:33-39` логирует `log.warn` с `flapStreak`/`failedProbes` |
| Серия ≥ 3 → `ok:false` | PASS — тест `health.test.ts` «серия дошла до порога → ok:false» |
| Ошибка API (`Unauthorized`/`chat not found`) → `ok:false` сразу, без `incr` | PASS — тест «ошибка API — не транспорт: без повтора и без гистерезиса», `redisIncrMock` не вызывается |
| Смешанный отказ (часть — транспорт, часть — API) → `ok:false`, без incr | PASS — `failedProbes.every(p => p.check.transportError)` (`health.ts:297`), тест «смешанный отказ... серия не считается» |
| Redis недоступен/упал → `ok:false` (старое поведение) | PASS — `bumpTransportFlapStreak` возвращает `null` при `!redisAvailable` и при исключении (`health.ts:116-127`); тесты «Redis недоступен» и «Redis упал на INCR» |
| Здоровые пробы → `DEL` ключа серии | PASS — `clearTransportFlapStreak()` вызывается при `telegramOk` (`health.ts:295-296`), тест `redisDelMock` |
| `ok` требует `failedLastHour === 0 && ownerDecisions.ok` | PASS — `health.ts:311` (`const ok = telegramOk && queueCheck.failedLastHour === 0 && ownerDecisionsCheck.ok`) — гистерезис телеграм-проб не глушит очередь/owner-decisions |
| Публичный health-роут без RBAC — задокументировано | PASS — докстринг `route.ts:10-18` явно называет роут публичным (deploy smoke tests), поведение не менялось этим PR |

9 новых тестов в `src/modules/notifications/__tests__/health.test.ts:210-313`
и 3 в `route.test.ts` покрывают все ветки. Все PASS.

### 7. #736 — root-cause `site-down`: флап внешней пробы

| AC | Статус |
|---|---|
| Маркер `<!-- watchdog:probe-flap -->` (или `WATCHDOG_RESULT=healthy` + `nothing to fix`) не считается в цикл эскалации | PASS — `isProbeFlap()` (`scripts/lib/incident-escalation.ts:30-36`), тест `incident-escalation.test.ts:129-136` |
| Три флапа → без root-cause | PASS — тест «три цикла site-down, все — флапы (#694/#711/#735): root-cause не заводится» (`incident-escalation.test.ts:138-145`) |
| Настоящие циклы считаются, флапы перечисляются отдельно | PASS — тест «настоящие циклы считаются, флапы идут отдельным списком» (`incident-escalation.test.ts:147-158`), `rootCauseIssue` включает список флапов в тело |
| `watchdog-remediate.sh`: маркер ставится только в branch `finish healthy` из самого начала скрипта (единственный путь, где `WATCHDOG_RESULT=healthy` и `nothing to fix` совпадают) | PASS — проверил `scripts/watchdog-remediate.sh:101-104`: `if public_ok; then echo "Public health OK — nothing to fix."; finish healthy; fi` — единственное место с обоими текстами; остальные пути (`T1`-`T5`) идут через `finish recovered`, не пересекаются |
| `site-watchdog.yml`: `PROBE_FLAP` вычисляется раньше обоих потребителей | PASS — шаг «Save report to file» (строка 368, `PROBE_FLAP` выставляется на 375-382) идёт раньше «Telegram alert» (385) и «Open or update site-down issue» (439) |
| Маркер ставится только в flap-ветке | PASS — `if [ "$PROBE_FLAP" = "true" ]; then BODY+=... "<!-- watchdog:probe-flap -->"; fi` (строки 465-468), безусловной вставки нет |
| YAML валиден | PASS — `python3 -c "import yaml; yaml.safe_load(...)"` |
| `docs/incidents/2026-09-03-site-down-probe-flaps.md` без PII | PASS — только номера issues, таймстемпы UTC, статусы контейнеров; ни chat ID, ни IP, ни email |

### 8. #719 — ретро в `docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md`

Выборочно перепроверил 4 фактических утверждения секции «Ретро 2026-09-03»
напрямую по коду (не по пересказу):
- «чек `AC-трассируемость (отчёт)` в `ci.yml`» — `grep -n "AC-трассируемость" .github/workflows/ci.yml` → строка 63, совпадает.
- «`src/lib/event-sources.ts` (#581)» — файл существует.
- «`docs/pipeline-runs/next-issue.jsonl` ... за три недели в нём 3 строки» — `wc -l` = 3, совпадает.
- «нативный auto-merge заблокирован (#745)» / «`merge-gate-check.yml` (#770)» — оба файла (`block-native-automerge.yml`, `merge-gate-check.yml`) существуют.

Все проверенные утверждения подтверждаются. PASS.

### 9. #805 — красный dependabot-PR #802 (10 minor/patch бампов)

`package.json`: сравнил diff с таблицей в теле PR #802 (`curl` GitHub API) —
все 10 пакетов и версии совпадают дословно: `grammy` 1.45.1→1.46.0,
`isomorphic-dompurify` 3.22.0→3.23.0 (pinned), `next` 16.3.1→16.3.3 (pinned),
`resend` 6.21.0→6.24.0, `@testing-library/react` 16.3.2→16.3.3,
`@testing-library/user-event` 14.6.5→14.6.6, `@types/node` 26.2.0→26.4.0,
`@types/react-dom` 19.2.4→19.2.5, `eslint` 10.8.1→10.9.1,
`eslint-config-next` 16.3.1→16.3.3 (pinned). Стиль пиннинга сохранён (три
пакета без `^`, как и раньше). `npm ci --dry-run --ignore-scripts` проходит
чисто.

`.github/dependabot.yml`: два новых `ignore`-правила (`typescript` major,
`nodemailer` major) с комментариями, ссылающимися на #757/#758 — проверил обе
issues через GitHub API, обе открыты и описывают ровно те причины (TS7 не
поддерживается typescript-eslint; nodemailer 9 конфликтует с peer-диапазоном
next-auth). YAML валиден. PASS.

---

## Security-чеклист (`agents/SECURITY.md`, `agents/qa.md`)

Батч целиком — инфраструктура/мониторинг/CI-скрипты, новых пользовательских
API endpoints не добавлено. Функциональные RBAC/rate-limit/input-validation
кейсы из чеклиста QA в основном **N/A** по объективной причине (нет нового
пользовательского API-входа) — единственный тронутый route
(`/api/notifications/health`) как был публичным health-check без RBAC
(задокументировано в его собственном докстринге до этого PR), так и остался;
его RBAC-статус этим PR не менялся.

| Кейс | Результат |
|---|---|
| Секреты в диффе (`password\|token\|secret\|NEXTAUTH\|TELEGRAM_.*TOKEN\|api[_-]key`, без учёта отчёта Reviewer'а и своего отчёта) | Только имена env-переменных (`OWNER_DECISIONS_SECRET`, `HAS_PAT`) в комментариях/CLAUDE.md — ни одного литерального значения. PASS |
| Деструктивные git/shell операции (`rm -rf`, `push --force`, `reset --hard`, `DROP TABLE/COLUMN`, `TRUNCATE`, `DELETE FROM`) | Пусто в диффе. PASS |
| `dangerouslySetInnerHTML` / `$executeRawUnsafe` | Не встречаются — Prisma-модели вообще не тронуты. PASS |
| Data leakage в `/api/notifications/health` | Новые поля (`degraded.reason/flapStreak/failedProbes`, `checks.*.transportError`) — только имена проб и человекочитаемый текст, ни chat ID, ни токенов. PASS |
| RBAC на изменённом route | Не изменился — намеренно публичный health-check, задокументировано. N/A (не новый endpoint) |
| Anonymous/USER/MANAGER/SUPERADMIN на новых endpoints | N/A — новых API endpoints нет |
| Rate limiting 60+ req/min → 429 | N/A — публичных user-facing endpoints не добавлено; существующий health-роут не переведён на новую политику этим PR |
| Невалидный JSON → 400 VALIDATION_ERROR | N/A — новых Zod-схем нет |
| SQL-инъекция (`' OR 1=1--`) | N/A — новых Prisma-запросов с пользовательским вводом нет |
| PII в `docs/incidents/2026-09-03-site-down-probe-flaps.md` | Отсутствует (см. п.7) |

Security-инцидентов не найдено.

---

## Что хорошо

- Тестовое покрытие батча тщательное для инфраструктурного кода: граничные
  случаи (Redis упал посреди операции, смешанные отказы, гонка `batchAdd`,
  «свежий cancelled после старого success») покрыты явно.
- Mutation-check на #835 подтвердил, что новые тесты действительно ловят
  регресс дедупа чек-ранов, а не проходят «случайно».
- `executeDecision` → `decision-executor.ts` — образцовый рефакторинг:
  поведение идентично старому построчно, только I/O вынесено за интерфейс.
- Разбор `docs/incidents/2026-09-03-site-down-probe-flaps.md` содержателен и
  проверяем (таблица трёх циклов, явное «что не трогали»).

## Замечаний нет

Ни один пункт батча не провалил проверку AC, регрессии, mutation-check или
security-чеклиста.

---

*QA: Claude Code (Fable 5.1)*
