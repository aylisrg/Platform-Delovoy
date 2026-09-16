# Review: Недельный product-analyst — отчёт по воронке, гипотезы, дайджест (issue #726, PR #897)

## Вердикт: PASS

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-2.1 | PASS | `buildWeeklyFunnelReport`/`aggregateFunnelStats` считают конверсию по шагу, Δ п.п. к прошлой неделе, `biggestDropStep` per funnel; таблицы в разделе 2 отчёта. Тесты в `weekly-report.test.ts`. |
| AC-2.2 | PASS | `releasesForPeriod()` тянет merged PR через `ghApi`, `groupReleasesByDay` раскладывает по МСК-дням; `releasesSection()` пишет машинную строку при `|Δ| ≥ NOTABLE_DELTA_PP` (5 п.п.) с датами релизов или честным «релизов не было». |
| AC-2.3 | PASS | `buildHypothesisIssueBody` содержит все 4 обязательных поля (что менять / ожидаемый результат / как измеряем / baseline); baseline подставляется из сайдкара, не из прозы. `hypothesis` CLI отказывает на 4-й гипотезе (exit 7, `MAX_HYPOTHESES_PER_WEEK=3`). |
| AC-2.4 | PASS | Новая полоса `auto:hypothesis` в `laneOf()` (после `parked`, до `blocked` — порядок как в ADR §5): `isUntriaged`→false, `isEligible`→false, `assertClaimable`→throws. Единственный путь в работу — `promote`, который сам проверяет `lane === 'hypothesis'`. Триаж-команда `triage` тоже не может её тронуть — она отказывает на любой уже-`auto:*` issue. Всё покрыто тестами (`scripts/__tests__/issue-queue.test.ts`). |
| AC-2.5 | PASS | Пороги — именованные константы (`MIN_TOP_SESSIONS_FOR_CONCLUSIONS=30`, `MIN_STEP_SESSIONS_FOR_DELTA=10`); `insufficientData` на воронку и на отчёт целиком; `hypothesis` CLI отказывает при недостатке данных (exit 5) — воспроизведено и в CLI, и в контракте функций, не полагается на промпт. |
| AC-2.6 | PASS | `WeeklyFunnelSummary`/`WeeklyFunnelSidecar`/`WeeklyFunnelDigest` структурно не содержат ни одного поля с идентификатором посетителя — свойство типа, не дисциплины. `sessionKey` в SQL-экспорте участвует только внутри `COUNT(DISTINCT "sessionKey")`. `findPii()` проверяет прозу агента перед созданием issue (exit 6). Тест «ни в markdown, ни в сайдкаре нет идентификаторов посетителя» зелёный. |
| AC-3.1 | PASS | `weeklyFunnel(now)` в `scripts/owner-digest.ts` находит последний `*-funnel-weekly.json`, проверяет `isFreshSidecar` (доехал в `main` за 24ч через `git log -1 --format=%cI`), рендерит блок конверсий/Δ/оттока в `owner-digest.ts`. |
| AC-3.2 | PASS | Блок явно называет гипотезы по номерам и текстом «ждут твоего "делай", сами в работу не уйдут» (`weeklyFunnelLines`). |
| AC-3.3 | PASS | `weeklyFunnel === null` → `buildOwnerDigest` не добавляет ни одной строки блока (весь рендер внутри `if (i.weeklyFunnel)`), тест это явно проверяет. |
| AC-3.4 | PASS | Блок ограничен: по 1 строке на воронку + список гипотез (заголовок+номер) + путь к файлу; полный отчёт не пересказывается, ссылок на GitHub нет. |

## Соответствие ADR

Прошёлся по §3–§9 построчно против кода:

- **§3 (граница «числа считает код, текст пишет агент»)** — соблюдена: ни `weekly-report.ts`, ни `funnel-stats.ts` не импортируют `@/lib/*` (проверено `grep`), агент пишет прозу только в двух маркированных секциях (`INTERPRETATION_MARKER`, `HYPOTHESES_MARKER`), любая цифра в отчёте выведена одной из двух функций.
- **§4 (repo variable как транспорт)** — `analytics-funnel-export.yml` пишет `FUNNEL_WEEKLY_STATS` через `gh variable set`, `funnel-weekly.ts stats` читает её же, дёргает workflow при протухании (`isStatsExportFresh`, порог 36ч), опрос 30с/12мин, exit 4 при неудаче — совпадает 1:1.
- **§5 (лейбл `auto:hypothesis`)** — реализовано ровно как описано: новый `Lane`, позиция в `laneOf` (после `parked`), команда `promote` с точной проверкой lane, правка `next-issue.md` дословно близка к тексту ADR.
- **§6 (артефакты недели)** — имена файлов, состав сайдкара, разделы markdown (1–7), пороговые константы — всё совпадает.
- **§7 (freshness дайджеста)** — `isFreshSidecar` с толерансом в 1 час на рассинхрон часов, `fetch-depth: 50` добавлен в `owner-digest.yml` — как в ADR.
- **§8 (расписание, программа сессии)** — `.claude/commands/weekly-funnel.md` воспроизводит все 8 шагов ADR один в один, включая коды выхода и порядок `code-reviewer → qa-engineer`.
- **§9 (RBAC/секреты)** — новых эндпоинтов нет, новых секретов нет, SQL без пользовательского ввода — подтверждено ниже в разделе Security.

## Scope Check

- Scope creep: Нет.
- Новых `src/modules/{slug}/` директорий не создано — `weekly-report.ts`/`funnel-stats.ts` лежат внутри существующего `src/modules/analytics/`.
- `CLAUDE.md` синхронизирован в этом же PR: строка модуля `analytics`, описание `auto:hypothesis`, новый workflow `analytics-funnel-export.yml`, команда `promote` в разделе автоочереди — Scope guard #4 соблюдён.
- Три файла из `HOLD_PATTERNS` (`scripts/lib/issue-queue.ts`, `scripts/issue-queue.ts`, `.claude/commands/next-issue.md`) действительно затронуты — это ожидаемо по ADR §9, не флагую как проблему. Проверил содержимое: изменения строго аддитивны (новый lane, новая команда `promote`, новое условие в дашборде), ни один существующий hold-паттерн, порядок проверки в `laneOf` (`wip`/`review` по-прежнему первые) или дедуп-логика `create` не ослаблены. `npx tsx scripts/issue-queue.ts gate 897` возвращает `hold` по этим же трём файлам + отсутствию вердиктов ревью-агентов — гейт срабатывает штатно.
- `funnel-stats.ts` — чистый вынос существующей математики без изменения поведения; delegация в `product-events.ts` подтверждена диффом (просто вызов `aggregateFunnelStats`), существующие тесты `getFunnelStats` не менялись и остаются зелёными.
- Никаких новых npm-зависимостей, миграций Prisma, `.env.example` изменений — подтверждено пустым `git diff` по этим файлам.

## Качество кода

- TypeScript strict: OK (`npx tsc --noEmit` — чисто).
- Zod валидация: OK — сайдкар (`parseWeeklySidecar`), экспорт агрегатов (`parseWeeklyStatsExport`), CLI-аргументы (`parseDate`/`parseFunnel`/`parseStep`) — везде Zod или regex-схемы, ничего не бросает наружу необработанным.
- API формат: N/A — новых HTTP endpoints нет (подтверждено ADR §9 и диффом `src/app/api/`).
- Тесты: OK — `npm test -- --run` зелёный (335 файлов / 4706 тестов), включая 225 тестов из файлов, прямо относящихся к этой задаче (`weekly-report.test.ts`, `funnel-stats.test.ts`, `funnel-weekly.test.ts`, `owner-digest.test.ts`, `issue-queue.test.ts`). `npm run lint` — 0 ошибок (21 неотносящихся к PR warning в старом коде мессенджера/телефонии).

## Безопасность

### RBAC
- Новых API endpoints нет — RBAC-риска на уровне HTTP не возникает. `GET /api/analytics/funnel` (из #725, не тронут этим PR) продолжает использовать `requireAdminSection`.

### Secrets leakage
- `grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по диффу — все совпадения это `${{ secrets.* }}` в workflow (существующий, уже одобренный паттерн `backlog-intake.yml`/`deploy.yml`), SSH-ключ пишется во временный файл и удаляется (`rm -f ~/.ssh/funnel_key`) сразу после использования. Токены/ключи в лог/JSON не попадают.
- `.env.example` не тронут — новых секретов действительно нет, как заявлено в ADR §9.

### Injection
- SQL в `analytics-funnel-export.yml` полностью статический, без единого пользовательского ввода: `SQL=$(cat <<'SQL' ... SQL)` — heredoc с quoted-delimiter (`<<'SQL'`), никакой shell-интерполяции внутри; литералы — `$$...$$` (dollar-quoting), интервалы — `make_interval(...)`. Ни одной одинарной кавычки, ни одной переменной окружения внутри запроса. `sessionKey` фигурирует единственный раз — внутри `COUNT(DISTINCT "sessionKey")` — не покидает агрегат.
- `$SQL` подставляется в `ssh ... "docker exec delovoy-postgres psql -U delovoy -d delovoy_park -Atc '$SQL'"` — сама SQL-строка неизменна (heredoc-константа), инъекции через неё нет; риск был бы, если бы `$SQL` содержал пользовательский ввод, но он не содержит.
- CLI (`funnel-weekly.ts`) не выполняет raw SQL и не строит shell-команды из пользовательского текста прозы — `execFileSync` вызывается с массивом аргументов (`npx tsx scripts/issue-queue.ts create ...`), не через `exec`/shell-строку — безопасно от argument injection.

### XSS / HTML injection
- `scripts/lib/owner-digest.ts::weeklyFunnelLines` — `escapeHtml()` применён везде, где непроверенный текст (заголовки гипотез из прозы агента, `label` воронки из каталога, `biggestDropLabel`, `reportPath`) попадает в HTML-форматированное Telegram-сообщение. Проверил построчно: `escapeHtml(f.label)`, `escapeHtml(f.biggestDropLabel)`, `escapeHtml(h.title)`, `escapeHtml(w.reportPath)`, заголовок периода тоже экранирован. Тест `заголовок гипотезы — данные, а не разметка: HTML экранируется` зелёный.
- Markdown-отчёт (`docs/analytics/*.md`) не рендерится как HTML нигде в этом PR — не требует экранирования по тем же правилам.

### PII
- Структурная защита подтверждена: `WeeklyFunnelSummary`/`WeeklyFunnelSidecar`/`WeeklyFunnelDigest` физически не могут нести PII (только `funnel`, `step`, `label`, счётчики, проценты).
- `findPii()` — единственная поверхность риска (проза агента). Регулярка ИНН `\b(?:\d{10}|\d{12})\b` **действительно может дать false positive** на случайном 10/12-значном числе в тексте гипотезы, не являющемся ИНН (например, если агент вставит длинный ID заказа или число без разделителей). Это осознанная и оправданная асимметрия: guard фейлит **закрыто** (блокирует создание issue, exit 6, ничего не публикуется), а не открыто — то есть цена ложного срабатывания — session переписывает формулировку и повторяет вызов, а не утечка данных. Учитывая, что baseline-числа форматируются кодом с `%`/`п.п.`/разделителями и обычно не достигают 10+ подряд идущих цифр без пробелов, вероятность события низкая. Оцениваю как приемлемый trade-off, а не блокирующий баг; фиксирую как **некритичное наблюдение**, а не причину NEEDS_CHANGES.

### Anti-fraud / gaming (специально проверено по заданию)
- Гипотеза без baseline: невозможно — baseline формируется исключительно из уже прочитанного и провалидированного (`parseWeeklySidecar`) файла сайдкара, агент не может передать свои числа в `buildHypothesisIssueBody`, только `change`/`expected` (прозу).
- Больше 3 гипотез в неделю: невозможно — проверка `sidecar.hypotheses.length >= MAX_HYPOTHESES_PER_WEEK` перед созданием issue (exit 7), подтверждено тестом на CLI-уровне и `weekly-report.test.ts`.
- Гипотеза в недели с `insufficientData`: невозможно — двойная проверка (`sidecar.insufficientData || summary.insufficientData` → exit 5).
- Обход полосы `auto:hypothesis` через другие команды: проверил `triage` (`cmdTriage`) — отказывает на любой issue, уже имеющей `auto:*`-лейбл (`existing.length > 0` → throw), то есть попытка `triage` на гипотезу гарантированно падает. `claim`/`assertClaimable` — throws при lane ≠ `ready`. `next`/`pickNext` — `isEligible` требует lane === `ready`. Единственный путь — `promote`, который сам явно проверяет `laneOf(labels) !== 'hypothesis'` и бросает исключение иначе. Обхода не нашёл.

### Идемпотентность (специально проверено по заданию)
- `build` при повторном запуске для того же `period.dateFrom`: `existingSidecars()` сканирует `docs/analytics/*.json`, находит совпадение по `period.dateFrom` **до** любого `writeFileSync` — повторный вызов не пишет ни `.md`, ни `.json`, только exit 3. Побочных эффектов нет.
- `hypothesis` при повторном запуске на тот же funnel/step: `createHypothesisIssue` вызывает общий `issue-queue.ts create --dedup-key funnel-hyp-<date>-<funnel>-<step>`, который ищет issue с маркером `<!-- create-dedup:... -->` в теле за последние 14 дней (`state=all`, значит и закрытые считаются) **до** создания — при находке возвращает `deduped: true`, новый issue не создаётся. CLI-обработчик (`cmdHypothesis`) при `created.deduped` завершает работу до `sidecar.hypotheses.push`/`appendHypothesisToMarkdown` — второй раз сайдкар/markdown не переписываются. Проверил единственный слабый сценарий: если процесс упадёт **между** успешным созданием issue и записью сайдкара — повторный запуск найдёт issue по dedup-маркеру и корректно завершится как "deduped", но тогда issue так и останется незалинкованной в сайдкар/отчёт. Это узкое окно (крах сессии между двумя системными вызовами) — не баг реализации ADR и не проще устранить, чем аналогичные окна в остальной автоматике очереди (например `staleWipWithPr`); фиксирую как известное ограничение, не блокирую.

**Итог по security: инцидентов не найдено.**

## Что исправить (если NEEDS_CHANGES)

Не применимо — вердикт PASS. Не блокирующие наблюдения для дальнейшего рассмотрения (не требуют правки в этом PR):
1. `findPii` ИНН-регулярка может ложно сработать на постороннем 10/12-значном числе в прозе гипотезы — направление ошибки безопасное (блокирует публикацию, не пропускает PII), но при частых срабатываниях в будущем можно рассмотреть уточнение (например: требовать явного слова «ИНН» рядом или контекстной метки).
2. Узкое окно неидемпотентности `hypothesis` при крахе процесса между созданием issue и записью сайдкара (см. раздел «Идемпотентность») — теоретическое, не встречалось на практике, ADR его не описывает как решённый вопрос.

## Что хорошо

- Граница «код считает числа, агент пишет прозу» реализована буквально — `weekly-report.ts`/`funnel-stats.ts` действительно не тянут ни одного `@/lib/*` импорта, что подтверждено и вручную, и работоспособностью как чистого модуля (тесты не мокают БД).
- Тестовое покрытие образцовое и прямо трассируется на AC: тесты называются по AC-кодам (`AC-2.1`, `AC-2.5`, `AC-2.6`, `AC-3.1/3.2/3.4`, `AC-3.3`), что заметно облегчает ревью.
- Анти-фрод для лейбла `auto:hypothesis` продуман многослойно: машинная проверка в `laneOf`/`isEligible`/`assertClaimable` + отдельная проверка в новой команде `promote` + текстовое правило в `next-issue.md` — defense in depth, а не одна точка отказа.
- SQL-экспорт продолжает уже принятый в проекте паттерн (`backlog-intake.yml`) без единой одинарной кавычки — заметно снижает риск инъекции при двойном прохождении через shell (local → ssh → remote).
- Идемпотентность `build`/`hypothesis` продумана на уровне персистентного состояния (файл сайдкара / dedup-маркер в issue), а не эфемерных флагов в памяти сессии — переживает падение и рестарт сессии.

---

Диапазон проверки: `git diff 5e3c48d..HEAD` (18 файлов, +2305/-7), `npm test -- --run` (335/335 файлов, 4706/4706 тестов зелёные), `npx tsc --noEmit` (чисто), `npm run lint` (0 ошибок, warnings не относятся к PR), `npx tsx scripts/issue-queue.ts gate 897` (hold по ожидаемым причинам).
