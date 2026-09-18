# QA-отчёт: #726 — недельный product-analyst loop (отчёт по воронке, гипотезы, дайджест), PR #897

**PR**: https://github.com/aylisrg/Platform-Delovoy/pull/897 (`feat(analytics): weekly
product-analyst loop — funnel report, hypotheses, digest block`)
**Ветка**: `claude/issue-726-weekly-product-analyst-loop`
**HEAD проверен**: `a2fefcd`
**Ревью кода**: PASS (`docs/qa-reports/issue-726-review.md`) — эта проверка независима,
AC перепроверены заново по коду и живым прогонам, не приняты на слово.

Источники истины: `docs/adr/2026-09-16-weekly-product-analyst-loop.md` (все открытые
вопросы PRD закрыты в ADR) и `docs/requirements/2026-08-21-product-loop-prd.md`
(AC-2.1…AC-2.6 — US-2, AC-3.1…AC-3.4 — US-3).

---

## 1. Регрессия и статика

| Проверка | Результат |
|---|---|
| `npm test -- --run` | `Test Files 335 passed (335)`, `Tests 4706 passed (4706)` — совпадает с числами из описания PR, перепроверено самостоятельно, не переписано с чужих слов |
| `npx tsc --noEmit` | чисто, без вывода |
| `npm run lint` | `0 errors, 21 warnings` — все 21 в файлах, не тронутых этим PR (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`), подтверждено `git diff --stat` (в диффе PR этих файлов нет) |
| `npm run agents:eval` | `4/4 passed, 0 failed` |
| `npx vitest run eval` | `Test Files 2 passed`, `Tests 29 passed` |
| Frontmatter-валидация `.claude/agents/*.md` | вручную воспроизведена логика шага CI — `name`/`description`/`model` присутствуют во всех файлах, включая тронутый `product-analyst.md` |
| CHANGELOG-gate | `git diff --name-only origin/main -- 'agents/*.md' …` → только `agents/analytics.md`; `agents/CHANGELOG.md` в том же диффе — условие джобы `Require CHANGELOG update for agent changes` выполняется |

Все статические проверки, которые я обязан был прогнать сам, а не принять из
описания PR, — зелёные.

## 2. Acceptance Criteria — независимая проверка

### AC-2.1 (конверсия по шагам, Δ к прошлой неделе, шаг оттока)

`summarize()`/`funnelTable()` в `src/modules/analytics/weekly-report.ts`
считают `endToEndConversion`, `endToEndDeltaPp`, `biggestDropStep/Label/Conversion`
на основе `FunnelStatsData` (уже посчитанного `aggregateFunnelStats`), раздел 2
markdown-отчёта строит таблицу по каждому шагу с Δ п.п. Живым прогоном CLI
(`build`, см. §3) подтвердил, что цифры в markdown и в JSON-сайдкаре совпадают
байт в байт и по каждой воронке есть строка «Наибольший отток: …». PASS.

### AC-2.2 (сверка заметного изменения с релизами недели)

`releasesForPeriod()` (`scripts/funnel-weekly.ts`) реально тянет merged PR через
`ghApi` постранично и группирует по дням МСК (`groupReleasesByDay` в
`scripts/lib/funnel-weekly.ts`); `releasesSection()` печатает машинную строку
для каждой воронки с `|Δ| ≥ NOTABLE_DELTA_PP` (5 п.п.), с явным списком дат
релизов или честным «релизов на неделе не было — изменение не объясняется
выкаткой», когда PR-ов нет. В моём живом прогоне (§3) при отсутствии релизов
в тестовом периоде отчёт корректно напечатал именно эту фразу для «Беседок»
(единственная воронка с |Δ| ≥ 5 п.п. в фикстуре). PASS.

### AC-2.3 (≤3 гипотезы, 4 обязательных поля, baseline не выдуман)

`buildHypothesisIssueBody()` формирует ровно 4 обязательных раздела: «Что
предлагается изменить», «Ожидаемый результат и почему» (проза агента, приходит
через `--body-file` и парсится `parseHypothesisProse`), «Как измеряем» (код),
«Baseline» (код, из `HypothesisBaseline`, который собирается в `cmdHypothesis`
исключительно из уже провалидированного Zod-схемой сайдкара — агент передаёт
только `title`/`change`/`expected`, числа baseline ему физически недоступны).
4-я гипотеза за неделю отклоняется (`MAX_HYPOTHESES_PER_WEEK = 3`, проверено
живым прогоном, exit 7, см. §3). PASS.

### AC-2.4 (гипотеза не уходит в работу сама)

Новый lane `hypothesis` в `scripts/lib/issue-queue.ts::laneOf()` (проверка
после `parked`, до `blocked`/`ready` — соответствует ADR §5). Проверил
эффект на все точки входа:
- `isUntriaged()` → `false`, `untriagedIssues()` не включает гипотезу — шаг 0
  триажа её не видит;
- `isEligible()` → `false`, `pickNext()` не выбирает — `next` не подхватит;
- `assertClaimable()` бросает `«не в auto:ready (сейчас: hypothesis)»` — прямой
  `claim <N>` тоже отказывает;
- `snapshot().byLane.hypothesis` — отдельная корзина, не смешана с `parked`.

Все четыре пункта покрыты тестами в `scripts/__tests__/issue-queue.test.ts`
(добавления полностью аддитивны — существующие ассерты по `wip`/`review`/
`ready`/`parked` не тронуты, регрессии в порядке проверок `laneOf` нет).
Единственный легальный путь — `npx tsx scripts/issue-queue.ts promote <N> <P>`,
которая явно проверяет `laneOf(labels) !== 'hypothesis'` перед переводом в
`auto:ready`. `.claude/commands/next-issue.md` дословно (проверено чтением)
содержит правило шага 0 из ADR §5: «не триажируй и не бери», единственный
способ — `promote`, и то только после явного слова владельца. PASS.

**Замечание (не блокирует).** `cmdPromote` — сама команда CLI в
`scripts/issue-queue.ts` (I/O: `gh()`, `setLabels()`, `comment()`) — прямым
unit-тестом не покрыта; тестируется только логика, на которую она опирается
(`laneOf`). Это не регрессия и не новый пробел этого PR: ни один другой
`cmd*` в этом файле (`cmdClaim`, `cmdRelease`, `cmdTriage`, `cmdPark`, …) тоже
не тестируется напрямую — архитектурно вся I/O-обвязка CLI остаётся
непокрытой, тестируется только вынесенная в `scripts/lib/issue-queue.ts`
чистая логика. Фиксирую как наблюдение для дальнейшего рассмотрения, не как
причину NEEDS_CHANGES.

### AC-2.5 (мало данных → честный отчёт, не гипотезы из шума)

Пороги — именованные константы: `MIN_TOP_SESSIONS_FOR_CONCLUSIONS = 30`,
`MIN_STEP_SESSIONS_FOR_DELTA = 10`. Проследил путь данных построчно:
- `summarize()`: `insufficientData = topSessions < 30`; `endToEndDeltaPp`
  считается `null`, если своя неделя недостаточна **или** прошлая неделя
  ниже `MIN_STEP_SESSIONS_FOR_DELTA` — выдуманная дельта на пяти сессиях
  невозможна структурно, не только по соглашению;
- `funnelTable()`: дельта шага печатается только если **обе** недели по
  этому шагу ≥ 10 сессий (`comparable`);
- на уровне всего отчёта — `insufficientData = summaries.every(s =>
  s.insufficientData)` → раздел 6 показывает фиксированную строку без единой
  гипотезы;
- в CLI — `cmdHypothesis` отказывает (`fail(..., EXIT.INSUFFICIENT_DATA)`),
  если `sidecar.insufficientData || summary.insufficientData` — двойная
  проверка (по всему отчёту и по конкретной воронке).

Живым прогоном (§3) подтвердил: воронка с 14 сессиями на входе (порог 30)
корректно помечена `insufficientData: true`, `endToEndDeltaPp: null`; попытка
зарегистрировать по ней гипотезу упала с exit 5. PASS.

### AC-2.6 (нет PII)

`WeeklyFunnelSummary`/`WeeklyFunnelSidecar`/`WeeklyFunnelDigest` структурно
содержат только `funnel`/`step`/`label`/счётчики/проценты — ни одного поля
для идентификатора посетителя. `sessionKey` в SQL-экспорте
(`analytics-funnel-export.yml`) фигурирует единственный раз — внутри
`COUNT(DISTINCT "sessionKey")` — не покидает агрегат ни в каком виде.
Единственная поверхность риска — проза агента (`change`/`expected`/`title`),
и там стоит `findPii()` (email/телефон/ИНН), вызываемый в `cmdHypothesis`
**до** любого сетевого вызова. Живым прогоном подтвердил exit 6 на строке с
email в тексте гипотезы (§3). ИНН-регулярка `\b(?:\d{10}|\d{12})\b` может
дать ложное срабатывание на постороннем 10/12-значном числе — уже
зафиксировано code-reviewer как принятый asymmetric fail-closed trade-off,
повторно не переоцениваю, новых аргументов против не нашёл. PASS.

### AC-3.1 / AC-3.3 (блок в сводке только в день, когда сайдкар доехал за 24ч)

`scripts/owner-digest.ts::weeklyFunnel(now)` ищет максимальный по имени
`*-funnel-weekly.json` в `docs/analytics/`, парсит через `parseWeeklySidecar`
(Zod, никогда не бросает), берёт `landedAt` через `git log -1 --format=%cI --
<path>` и пропускает через `isFreshSidecar({ landedAt, publishedAt, now })`
(окно 24ч + допуск в 1 час на рассинхрон часов раннера). Любая неудача на
любом шаге (нет папки, битый JSON, чужая `schemaVersion`, `git log` не отдал
историю) → `null` — дайджест не падает, просто едет без блока. `weeklyFunnel
=== null` → в `buildOwnerDigest` весь блок целиком внутри `if (i.weeklyFunnel)`,
ни одной строки не появляется — тест `AC-3.3` в
`scripts/lib/__tests__/owner-digest.test.ts` это подтверждает. `fetch-depth:
50` добавлен в `.github/workflows/owner-digest.yml` (было `1` по умолчанию —
без глубины истории `git log` за файлом не сработал бы вовсе). PASS.

### AC-3.2 / AC-3.4 (гипотезы явно ждут решения, выжимка не весь отчёт)

`weeklyFunnelLines()` печатает `«💡 Гипотезы недели (N) — ждут твоего "делай",
сами в работу не уйдут»` + по строке на гипотезу с номером issue — прямое
исполнение требования PRD «явно показывает, что они ждут решения владельца,
а не уже в работе». Объём блока ограничен: заголовок + по строке на воронку
+ список гипотез (заголовок+номер) + один путь к файлу отчёта — полный
markdown не пересказывается, ссылок на GitHub нет (владелец туда не ходит,
см. ADR §7). `escapeHtml()` применён на всех местах, куда попадает проза
агента (`f.label`, `f.biggestDropLabel`, `h.title`, `w.reportPath`) — заголовок
гипотезы не может сломать HTML-разметку Telegram-сообщения. PASS.

## 3. Живой прогон CLI (`scripts/funnel-weekly.ts`) на синтетических фикстурах

Сгенерировал фикстуру агрегатов (`schemaVersion: 1`, 4 воронки, часть с
достаточными, часть с недостаточными сессиями, дневная гранулярность за две
недели) и прогнал реальный TypeScript-код (не мок) через `npx tsx`:

```
$ npx tsx scripts/funnel-weekly.ts build --stats-file <fixture> --report-date 2020-01-13
→ создал docs/analytics/2020-01-13-funnel-weekly.{md,json}, exit 0
  (releasesForPeriod реально сходил в GitHub API за merged PR — сеть отработала;
  для 2020 года релизов нет, отчёт корректно напечатал «в прод не уехало ни одного PR»)

$ npx tsx scripts/funnel-weekly.ts build --stats-file <fixture> --report-date 2020-01-14
→ {"skipped": true, "reason": "отчёт за этот период уже есть", ...}
  EXIT CODE: 3   ✅ идемпотентность подтверждена без мока

$ npx tsx scripts/funnel-weekly.ts hypothesis --funnel ps-park --step slot_selected ...
→ "данных по воронке ps-park за неделю недостаточно (14 сессий на входе)..."
  EXIT CODE: 5   ✅ AC-2.5 подтверждён без мока

$ npx tsx scripts/funnel-weekly.ts hypothesis --funnel gazebos --step submitted \
    --body-file <текст с email ivan.petrov@example.com> ...
→ "в тексте гипотезы найдены персональные данные (email: ...)"
  EXIT CODE: 6   ✅ AC-2.6 PII-guard подтверждён без мока

# вручную дописал 3 фиктивные гипотезы в сайдкар, затем:
$ npx tsx scripts/funnel-weekly.ts hypothesis --funnel gazebos --step paid ...
→ "за неделю уже зарегистрировано 3 гипотез — больше 3 не берём"
  EXIT CODE: 7   ✅ AC-2.3 лимит подтверждён без мока

$ npx tsx scripts/funnel-weekly.ts stats --no-dispatch --out ...
→ "агрегаты воронки недоступны ..." EXIT CODE: 4   ✅ подтверждён БЕЗ триггера
  реального dispatch на analytics-funnel-export.yml (прод-workflow не тронут)
```

Все пять exit-кодов из контракта (3/4/5/6/7) воспроизведены реальным
выполнением кода, не unit-тестом и не мок-объектом. Намеренно НЕ выполнял
happy-path `hypothesis` до конца (создание issue) и `pr` — это привело бы к
реальной мутации в GitHub-репозитории (создание issue/PR через `gh()`), что
выходит за рамки безопасного QA-прогона; happy-path создания issue покрыт
юнит-тестами (`weekly-report.test.ts::buildHypothesisIssueBody`) и был
задокументирован разработчиком как проверенный вручную на временном Postgres
— не переисполняю с реальными побочными эффектами. Артефакты фикстур
(`docs/analytics/2020-01-13-funnel-weekly.*`) удалены после проверки —
untracked-файлы, `git status` чист.

## 4. Regression в `scripts/lib/issue-queue.ts`

`git diff origin/main...HEAD -- scripts/__tests__/issue-queue.test.ts` — диф
полностью аддитивен (31 новая строка, 0 удалений/изменений существующих
ассертов). Существующие тесты порядка `laneOf` (`wip` > `review` > `epic` >
`parked` > … > `ready`) не тронуты и остаются зелёными в общем прогоне.
Новый `hypothesis` вставлен в цепочку между `parked` и `blocked` — там же,
где в ADR §5. `assertClaimable`/`isEligible`/`isUntriaged`/`snapshot` для
`auto:hypothesis` — все три поведения (false/false/throw/отдельная корзина)
явно протестированы. См. также замечание по `cmdPromote` в AC-2.4 выше.

## 5. CLAUDE.md / agents/CHANGELOG.md

- `CLAUDE.md`: строка модуля `analytics` дополнена ссылкой на новый ADR и
  артефакты (`weekly-report.ts`, `funnel-weekly.ts`, `docs/analytics/…`);
  раздел «Автоочередь» — `analytics-funnel-export.yml`, `auto:hypothesis` в
  описании лейблов очереди, `promote` в списке команд. Сверено построчно с
  тем, что реально в коде (lane после `parked`, CLI-путь `promote <N> <P0..P3>`)
  — расхождений нет.
- `agents/CHANGELOG.md`: запись `[1.5.0] — 2026-09-16` добавлена, версия
  `analytics` в таблице внизу файла поднята `1.1.0 → 1.2.0`, что совпадает с
  фактическим изменением `agents/analytics.md`. CI-джоба «Require CHANGELOG
  update for agent changes» (`agents-eval.yml`) сравнивает список
  изменённых `agents/*.md` (кроме README/SECURITY/CHANGELOG) с фактом
  изменения CHANGELOG — воспроизвёл логику вручную: единственный тронутый
  файл `agents/analytics.md`, CHANGELOG в том же диффе — условие
  выполняется. Джоба «Run agents eval» (`npm run agents:eval` + `npx vitest
  run eval` + frontmatter-валидация) — все три шага прогнаны локально и
  зелёные (см. §1). PASS.

## 6. Security (per `agents/SECURITY.md` / `agents/qa.md`)

### RBAC
Новых API endpoints нет (подтверждено диффом — ни одного файла под
`src/app/api/`). Существующий `GET /api/analytics/funnel` (#725) этим PR не
тронут. Функциональные RBAC-кейсы (аноним/USER/MANAGER/SUPERADMIN) неприменимы
за отсутствием новой HTTP-поверхности — фиксирую это явно, а не подгоняю
кейсы под чеклист, которому этот PR не соответствует по типу изменения.

### Rate limiting
Неприменимо — новых публичных эндпоинтов нет.

### Input validation
- CLI-аргументы валидируются Zod/regex (`parseDate`, `parseFunnel`, `parseStep`
  в `scripts/lib/funnel-weekly.ts`) — невалидная воронка/шаг/дата отклоняются
  с понятной ошибкой до любой записи. Проверил вручную (см. §3, неправильный
  шаг для чужой воронки был бы отклонён `parseStep`, не дошёл до логики).
- Сайдкар и экспорт агрегатов проходят Zod (`parseWeeklySidecar`,
  `parseWeeklyStatsExport`) — не бросают на мусоре, возвращают `null`, что
  трактуется вызывающим кодом как «данных нет», а не падение.

### Data leakage
- Проверено (AC-2.6) — структурная невозможность PII в числовых полях +
  `findPii()` для прозы, воспроизведено живым прогоном (exit 6).
- SQL-экспорт (`analytics-funnel-export.yml`): перечитал построчно —
  запрос целиком статический литерал внутри `<<'SQL' … SQL` (single-quoted
  heredoc-delimiter, никакой shell-интерполяции внутри), строковые литералы
  через `$$…$$` (dollar-quoting Postgres), интервалы — `make_interval(...)`.
  Ни одной одинарной кавычки, ни одной переменной окружения или
  пользовательского ввода внутри SQL. `sessionKey` — единственный раз, внутри
  `COUNT(DISTINCT …)`. Секреты (`VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`,
  `secrets.GITHUB_TOKEN`, `secrets.TELEGRAM_BOT_TOKEN`,
  `secrets.TELEGRAM_ADMIN_CHAT_ID`) — везде и только через `${{ secrets.* }}`
  → `env:`, ни один не логируется, SSH-ключ пишется во временный файл и
  удаляется (`rm -f ~/.ssh/funnel_key`) сразу после использования, до вывода
  результата в лог/summary. `grep -inE '(password|secret|token|nextauth|
  telegram_.*token|api[_-]key)'` по всему диффу PR (не по файлу целиком, как
  более мягкая проверка reviewer'а) — все совпадения это `${{ secrets.* }}`
  или несвязанные с секретами слова (`token` в значении «CLI-токен
  аргумента» в `parseFlags`). Ноль новых секретов в открытом виде. PASS.
- 500-ошибки/трейсы: неприменимо — новых HTTP-обработчиков нет; CLI-ошибки
  идут в stderr процесса (`console.error`), не в HTTP-ответ клиенту.

## 7. Scope / зависимости / миграции

- Новых `src/modules/{slug}/` нет — весь новый код внутри существующего
  `src/modules/analytics/`.
- `package.json`, `package-lock.json`, `prisma/`, `.env.example` — пустой
  диф по всем четырём (`git diff origin/main...HEAD -- package.json
  package-lock.json prisma/ .env.example` — ничего). Новых зависимостей и
  миграций нет.
- `product-events.ts`: диф подтверждает чистую делегацию в
  `aggregateFunnelStats` — вся математика конверсий (расчёт `topSessions`,
  `conversionFromPrev/FromTop`, `biggestDropStep`) удалена из файла и вызвана
  из `funnel-stats.ts`; `product-events.test.ts` диффом не тронут вообще
  (`git diff` по нему пуст) — существующие тесты `getFunnelStats` покрывают
  ту же логику без единой правки и остаются зелёными в общем прогоне, что
  подтверждает поведенческую эквивалентность рефактора.
- `gate 897` вернёт `hold` из-за трёх `HOLD_PATTERNS`-файлов
  (`scripts/lib/issue-queue.ts`, `scripts/issue-queue.ts`,
  `.claude/commands/next-issue.md`) — это ожидаемо по ADR §9 и не имеет
  отношения к качеству кода, штатная ветка «нужно решение владельца».

## Edge cases

- Пустой отчёт (все 4 воронки `insufficientData`) — проверено путём построения
  логики: `insufficientData = summaries.every(...)`, раздел «Гипотезы»
  печатает фиксированную строку, `hypothesis` CLI отказывает независимо от
  того, какая воронка выбрана (двойная проверка `sidecar.insufficientData ||
  summary.insufficientData`).
- Повторный запуск `build`/`hypothesis` (идемпотентность при ретрае/крахе
  сессии) — подтверждено живым прогоном (`build` → exit 3) и код-ревью
  дедуп-механизма `hypothesis` (маркер `<!-- funnel-hypothesis: … -->` в теле
  issue, `--dedup-key` в общей команде `create`); узкое окно неидемпотентности
  между созданием issue и записью сайдкара при падении процесса уже
  зафиксировано code-reviewer как известное ограничение — согласен с оценкой,
  не переоцениваю.
- Экспорт-workflow триггерит реальный прод-дамп (`analytics-funnel-export.yml`)
  — сознательно не запускал `workflow_dispatch` и не вызывал `stats` без
  `--no-dispatch`, чтобы не задеть прод; вместо этого проверил exit 4 с
  `--no-dispatch` (см. §3).
- Гонка двух воркеров за `promote` — не новый риск: `laneOf`/labels-API имеют
  то же (уже задокументированное в `scripts/lib/issue-queue.ts` issue #647)
  окно гонки, что и `claim`; `promote` не расширяет и не сужает его.

## Итог

- Всего AC: 10 (AC-2.1…2.6, AC-3.1…3.4)
- PASS: 10
- FAIL: 0
- Security-инцидентов: не найдено
- Некритичные наблюдения (не блокируют): ИНН-regex false positive (уже принят
  code-reviewer'ом), `cmdPromote` не покрыт прямым unit-тестом (архитектурно
  консистентно с остальными `cmd*` в том же файле — не регрессия этого PR)

---

## Вердикт: PASS

Все 10 acceptance criteria (US-2 и US-3 эпика #583) подтверждены независимо —
не только по названиям тестов, но и построчным чтением реализующего кода и
живым прогоном `scripts/funnel-weekly.ts build/hypothesis/stats` на
синтетических фикстурах, воспроизведшим документированные exit-коды 3/4/5/6/7
реальным выполнением, а не моком. Полный прогон `npm test` (335/335 файлов,
4706/4706 тестов), `tsc --noEmit` и `npm run lint` — зелёные, числа из
описания PR подтверждены самостоятельно. Regression-риск в `scripts/lib/
issue-queue.ts` отсутствует: изменения аддитивны, порядок существующих lane
не нарушен, новые ассерты для `auto:hypothesis` присутствуют. `CLAUDE.md` и
`agents/CHANGELOG.md` синхронизированы с тем, что реально уехало в код;
CI-джоба `Run agents eval` (включая frontmatter-валидацию и CHANGELOG-gate)
пройдена локально во всех трёх шагах. Security: RBAC/rate-limiting неприменимы
(новой HTTP-поверхности нет), SQL-экспорт статичен и без единой точки
интерполяции, секреты — исключительно через `${{ secrets.* }}`, PII-guard
и структурная невозможность утечки данных о посетителе подтверждены живым
прогоном. Единственные два замечания — уже принятый code-reviewer'ом
trade-off по ИНН-регулярке и наблюдение про отсутствие прямого unit-теста у
`cmdPromote` (архитектурно консистентно с остальным файлом) — не блокируют.
