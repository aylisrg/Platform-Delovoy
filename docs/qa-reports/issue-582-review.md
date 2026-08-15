# Review: телеметрия прогонов /next-issue в pipeline-metrics (#582)

## Вердикт: PASS (раунд 2, коммит c3b7aef)

Раунд 1 (ниже) вернул NEEDS_CHANGES из-за одной блокирующей находки. Раунд 2
независимо перепроверил фикс: коммит метрики — новый пуш в PR, `ci.yml`
триггерится на `synchronize` без `paths-ignore`, `pr-merge` смотрит чеки
именно текущего HEAD SHA (`checksFor()` — живой fetch без кэша) — поэтому
между пушем метрики и `pr-merge` теперь обязателен повторный `pr-wait`.
Прослежено по коду (`scripts/issue-queue.ts`/`scripts/lib/issue-queue.ts`,
`.github/workflows/ci.yml`, включая `concurrency`-группу — новой гонки не
возникает, т.к. первый прогон CI уже `done` к моменту пуша метрики), плюс
живая проверка новой валидации `cmdMetric` (issue/branch) и рефакторинга
`parseJsonlLines<T>`. Оба минорных замечания раунда 1 (указатель на
телеметрию из шага 5, дублирование parse-логики) тоже устранены и
подтверждены. `npm test` 3817/3817, `tsc`/`lint` чисто. Готово к QA.

Два некритичных наблюдения на будущее: у нового `pr-wait` перед `pr-merge`
нет явно расписанной ветки red/timeout в тексте шага 7 (низкая вероятность —
тот же код, минутами ранее уже был зелёным); каждый `merged`-исход теперь
платит за два полных прогона CI вместо одного — осознанный, задокументированный
trade-off, не недосмотр.

---

## Раунд 1 (устарело, см. вердикт выше)

## Вердикт: NEEDS_CHANGES

## Контекст

Friction F7 из `docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md`: у
5-стадийного `pipeline.sh` есть наблюдаемость (JSONL + `/admin/monitoring/pipelines`), а у
основного рабочего контура `/next-issue` — никакой. Нет отдельного PRD/ADR для этой задачи
(точечный infra-фикс уровня backlog-очереди) — источник правды: текст issue #582 + текущий
`.claude/commands/next-issue.md` на этой ветке.

Изменённые файлы (ровно 7, без scope creep — `git diff main...HEAD --stat` вне них пуст):
`.claude/commands/next-issue.md`, `scripts/issue-queue.ts`,
`src/app/admin/monitoring/pipelines/page.tsx`, `src/app/api/monitoring/pipelines/route.ts`,
`src/modules/pipeline-metrics/{types,service}.ts`,
`src/modules/pipeline-metrics/__tests__/service.test.ts`.

## Acceptance Criteria (из текста issue #582)

| AC | Статус | Комментарий |
|----|--------|-------------|
| `next-issue.md` step 8/completion: JSONL-строка `{ts, issue, branch, outcome, ci_fix_rounds, review_rounds, duration_min}` в `docs/pipeline-runs/next-issue.metrics.jsonl` | PASS (формат) / **FAIL (последовательность)** | Формат точно совпадает (`scripts/issue-queue.ts:623-631` ↔ `src/modules/pipeline-metrics/types.ts` `NextIssueMetricEvent`). Но инструкция вставлена в шаг 7, **перед** `pr-merge`, и эта последовательность ломает сам мерж для доминирующего исхода `merged` — см. «Что исправить» п.1. |
| `types.ts`/`service.ts` — новый event-kind + агрегаты (outcomes/30 дней, средние раунды, медиана длительности) | PASS | `NextIssueOutcome/NextIssueMetricEvent/NextIssueAggregate` (`types.ts:49-79`), `readNextIssueMetrics()`/`aggregateNextIssueRuns()` (`service.ts:189-259`) — 30-дневное окно, `avgCiFixRounds`, `avgReviewRounds`, `medianDurationMin` (ручная реализация медианы, корректна для чётного/нечётного count). |
| Дашборд `/admin/monitoring/pipelines` — отдельный блок | PASS | Новая `Card` в `page.tsx:219-301`, 4 KPI-тайла + список последних 20 событий, тот же SUPERADMIN-гейт (`page.tsx:61-62`, `route.ts:26-27`). |
| JSONL коммитится в PR самой задачи | PASS (по конструкции) / см. п.1 по факту работоспособности | `next-issue.md:193-199` инструктирует `git add/commit/push` до терминального действия. |
| Unit-тесты на парсер/агрегаты нового event-kind | PASS | `service.test.ts` — 4 теста `readNextIssueMetrics` (ENOENT→[], well-formed, malformed-line-skip, non-ENOENT propagate) + 6 тестов `aggregateNextIssueRuns` (empty, window-filter, outcome-counts, avg, median odd/even). |
| Дашборд не падает на пустых данных | PASS | `page.tsx:224-231` — явный empty-state при `totalRuns === 0`, никаких `.toFixed`/арифметики на пустом массиве до этой проверки. |

## Scope Check
- Scope creep: Нет. Ровно 7 файлов, все по теме телеметрии `/next-issue`.
- `package.json`/`package-lock.json`/`prisma/schema.prisma`/`CLAUDE.md` не тронуты — новых
  зависимостей и модулей нет (это CLI/infra-фича внутри существующего модуля
  `pipeline-metrics`, не новый `src/modules/`).
- Независимо подтверждено: ветка НЕ зависит от #580 (`verdict`-команда) — `git merge-base
  --is-ancestor 5cdfc1b HEAD` → false, `verdict` в `scripts/issue-queue.ts` на этой ветке
  отсутствует. Коммит-месседж это заявляет — перепроверено, верно.
- Параллельная модель данных (`NextIssueMetricEvent`/`NextIssueAggregate` вместо переиспользования
  `PipelineMetricEvent`/`aggregateRuns`) обоснована: структурное несоответствие реальное —
  файл-на-стейдж-с-итерациями vs. общий файл со строкой-на-завершённую-задачу — форсировать в одну
  абстракцию значило бы городить условную логику внутри `toRun()`/`aggregateRuns()`. Согласен с
  решением. Минорная невынесенная дупликация — см. «Что исправить» п.3.

## Качество кода
- TypeScript strict: OK, `npx tsc --noEmit` — 0 ошибок.
- `any`: не введено.
- Zod: N/A для этого PR (CLI-аргументы и JSONL-парсинг, не HTTP-вход; `cmdMetric` валидирует
  `outcome` списком и раунды/длительность `Number.isFinite` вручную — см. п.4 ниже про пробел в
  этой валидации).
- API формат: `apiResponse()` не сломан, просто добавлены поля `nextIssueEvents`/
  `nextIssueAggregate` в существующий success-response (`route.ts:35`).
- Тесты: OK, см. ниже.

## Безопасность

### RBAC
- `/admin/monitoring/pipelines` (`page.tsx:61-62`) и `GET /api/monitoring/pipelines`
  (`route.ts:26-27`) — тот же паттерн `session.user.role !== "SUPERADMIN"`, что и до PR, для новых
  next-issue-полей отдельного гейта не требуется (одна страница/один роут). Утечки нет: issue-номера,
  branch-имена, счётчики раундов — не секреты и не PII.

### Secrets leakage
- `git diff main...HEAD | grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'`
  — единственное совпадение это комментарий-упоминание `$GH_TOKEN` (env var name, не значение) в
  JSDoc над `cmdMetric` — не утечка.
- `.env*` не тронут.

### Supply chain
- Новых зависимостей нет.

### Injection
- Нет raw SQL/`$executeRawUnsafe`, нет `dangerouslySetInnerHTML`. JSONL парсится через
  `JSON.parse` с try/catch на строку (не `eval`), формат файла — те же гарантии, что и у
  существующего `readMetricsFile`.

### Dangerous ops
- Нет `rm -rf`/force-push/деструктивных операций в диффе.

**Инцидентов (secrets/RBAC/injection/supply chain) не найдено.** Но ниже — некритичный для
security, но реальный **функциональный** баг, из-за которого вердикт NEEDS_CHANGES.

## Тесты
- `npm test -- --run`: **268 test files passed, 3817/3817 tests passed**.
- `npx tsc --noEmit`: чисто.
- `npm run lint`: 0 errors, 16 pre-existing warnings в несвязанных файлах (messenger,
  notifications, telephony, ps-park) — не в изменённых файлах этого PR.

## Что исправить (обязательно перед PASS)

1. **Сломанная последовательность «телеметрия → `pr-merge`» для исхода `merged` — CI сбрасывается
   новым коммитом, и `pr-merge` откажет.** `next-issue.md:159-163` и блок «Телеметрия прогона»
   (`next-issue.md:186-199`) инструктируют: для `tier: "auto"` — запушить коммит с JSONL-строкой,
   а СРАЗУ ЗАТЕМ вызвать `pr-merge $PR`, без повторного `pr-wait`. Но `attemptMerge()`
   (`scripts/issue-queue.ts:559-574`) на каждый вызов заново тянет чеки для ТЕКУЩЕГО head-коммита
   PR (`checksFor` → `pr.head.sha`, `scripts/issue-queue.ts:400-406`) и требует `s.green`.
   `summarizeChecks()` (`scripts/lib/issue-queue.ts:558-573`) явно и намеренно трактует пустой/
   неполный список чеков как «не зелено» — комментарий там же: «Пустой список — это «CI ещё не
   зарегистрировал прогон», а не «всё прошло». Сразу после push чеков секунду-другую нет вообще;
   посчитать это зелёным значит разрешить мерж кода, который никто не проверял.» CI-workflow
   триггерится на `pull_request: [opened, synchronize, reopened]` без `paths-ignore`
   (`.github/workflows/ci.yml:3-8`), т.е. `git push` метрик-коммита ЗАПУСКАЕТ новый прогон CI и
   инвалидирует «зелёный» статус, полученный на предыдущем `pr-wait`. Итог: `pr-merge`,
   вызванный сразу после push, детерминированно вернёт `{merged: false, reason: 'CI не
   стартовал — чеков нет вообще'}` (или `'CI ещё идёт'`) — `process.exitCode = 3`
   (`scripts/issue-queue.ts:640`). Ни одна ветка шага 7 не описывает, что делать с этим отказом
   (единственная описанная причина отказа `pr-merge` — «GitHub отказал в мерже» / branch
   protection, это другой код-путь). На практике это означает: **каждый** `outcome: merged`
   прогон либо потребует незадокументированной импровизации сессии (повторный `pr-wait` +
   `pr-merge`), либо просто провиснет до тех пор, пока не подберёт `issue-queue-merge.yml`
   (15 минут simple + требование «не пушили последние 20 минут» — итого до ~35 минут), что
   ломает сам смысл «сначала телеметрия, потом мерж прямо сейчас» и не совпадает с тем, что
   заявлено в PR-narrative («живая проверка» покрыла только рендер дашборда, а не реальный
   `pr-merge` после метрик-коммита — эта часть, судя по всему, не была прогнана вживую).
   **Исправление**: между `git push` метрик-коммита и вызовом `pr-merge` в
   `next-issue.md` нужен повторный `pr-wait $PR <timeout>` (или другое явное указание ждать
   зелёного CI на новом коммите перед мержем), либо — если авторы хотят сохранить «мгновенный»
   мерж — метрику для `merged` нужно закоммитить иначе (например, отдельным быстрым workflow
   без полного набора джоб, или до последнего `pr-wait`, оценивая `duration_min` заранее).

2. **Инструкция по телеметрии для пути «после 3 кругов ревью на шаге 5 → `park`» не привязана
   к месту действия.** Терминальное действие живёт в шаге 5 (`next-issue.md:117-119`: «После
   третьего круга не буксуй: закоммить что есть, открой PR... park $ISSUE») и само по себе не
   упоминает телеметрию вообще. Требование записать её для этого пути сформулировано только в
   блоке «Телеметрия прогона» под шагом 7 (`next-issue.md:188-189`, в скобках: «включая park из
   шага 6/после третьего круга ревью на шаге 5»). Сессия, читающая и исполняющая шаг 5
   последовательно, может уйти в `park` и к шагу 8, ни разу не заглянув в шаг 7 — типичный для
   агентных инструкций риск «ссылка вперёд потеряется». Добавьте явный однострочный указатель
   прямо в шаге 5 рядом с `park $ISSUE` («телеметрия — см. шаг 7 «Телеметрия прогона», исход
   `parked`»).

## Что исправить (nice to have, не блокирует само по себе)

3. Дублирование парсинга JSONL-строк: `readMetricsFile()` (`service.ts:30-44`, существующий код)
   и новый `readNextIssueMetrics()` (`service.ts:189-206`) — почти идентичная логика
   (`split("\n").filter(Boolean)` + `try { JSON.parse } catch { skip }`), различаются только типом
   и ENOENT-обработкой (у старой функции её нет — она специально не оборачивает try/catch, это
   делают её вызыватели `listPipelineRuns`/`getPipelineRun`). Легко выносится в generic
   `parseJsonlLines<T>(raw: string): T[]`. Сам проект в `next-issue.md:99` называет копирование
   функций багом, а не решением («Восьмая копия одной и той же функции — это баг») — стоит
   применить этот же стандарт к новому коду, раз уж он лежит в одном файле с оригиналом.

4. `cmdMetric()` (`scripts/issue-queue.ts:609-635`) валидирует `outcome` (список) и
   `ciFixRounds`/`reviewRounds`/`durationMin` (`Number.isFinite`), но не `issue` (`Number(rest[0])`
   может быть `NaN`) и не `branch` (`rest[1] ?? ''` тихо подставляет пустую строку при отсутствии
   аргумента). При кривом вызове `issue: NaN` в `JSON.stringify` сериализуется в `"issue":null`
   (JSON не знает `NaN`) — попадёт в файл наблюдаемости молча, без ошибки, испортив агрегаты
   дашборда неотличимо от валидной записи. Добавьте `Number.isFinite(issue)` и непустой `branch`
   в тот же блок валидации.

## Что хорошо
- Формат JSONL-строки и порядок полей у CLI-команды `metric` (`scripts/issue-queue.ts:623-631`)
  и у типа `NextIssueMetricEvent` (`types.ts:60-68`) совпадают буква в букву — нет риска, что
  дашборд получит записи в неожиданной форме.
- Резервирование `blocked` в словаре исходов с явным JSDoc-комментарием, почему он сейчас нигде
  не эмитится (`types.ts:56-59`) — разумное, задокументированное решение генуинной
  неоднозначности спеки, а не тихая недоделка.
- Разделение модели данных от `pipeline.sh`-машинерии (`PipelineMetricEvent`/`toRun`/
  `aggregateRuns`) — оправдано структурным несовпадением «файл-на-прогон-по-стейджам» vs.
  «общий файл-по-завершённым-задачам»; попытка форсировать общую абстракцию была бы хуже.
  Точное происхождение решения задокументировано прямо в JSDoc `types.ts:49-55`.
- Тесты не просто покрывают happy path: есть отдельный кейс на malformed-строку в файле
  (не роняет остальной парсинг) и на пропагацию не-ENOENT ошибок — соответствует правилу
  «моки не должны прятать реальные баги».
- Независимо перепроверенная (и подтвердившаяся) диагностика про `process.chdir(__dirname)` +
  output-file-tracing standalone-сборки Next.js: `Dockerfile` runner-стадия не делает
  `COPY --from=builder /app/docs ./docs` явно — единственный способ, которым
  `docs/pipeline-runs/*.jsonl` вообще попадает в прод-контейнер, это захват директории целиком
  через NFT, спровоцированный уже существующим `fs.readdir(METRICS_DIR)` в `listPipelineRuns()`.
  Это пред-существующее (до этого PR) поведение, от которого уже зависел дашборд `pipeline.sh`;
  цепочка `deploy.yml` (`workflow_run` от CI + `push: [main]`) и `ci.yml` (`build` джоба —
  `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, т.е. строго после мержа)
  подтверждает: сборка образа в проде всегда происходит после того, как файл уже в `main`, так
  что квази-баг с NFT-снапшотом реальному деплою не вредит — вывод в коммит-месседже корректен.

## Итог
NEEDS_CHANGES из-за пункта 1 (последовательность «телеметрия перед `pr-merge`» ломает сам мерж
для исхода `merged` — основного, наиболее частого исхода) и пункта 2 (недокументированный на
месте действия путь телеметрии для парковки после 3 кругов ревью). Остальное — на высоком
уровне сделано аккуратно: формат, типы, агрегаты, RBAC, тесты и вывод про порядок деплоя
проверены и подтверждаются независимо.
