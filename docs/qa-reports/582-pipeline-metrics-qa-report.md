# QA-отчёт: issue #582 — телеметрия прогонов /next-issue в pipeline-metrics

**Ветка:** `claude/issue-582-pipeline-metrics` (`72a452c` impl → `c3b7aef` фикс раунда 1 →
`e209210` docs). `code-reviewer`: раунд 1 NEEDS_CHANGES (CI-resequencing баг), раунд 2 PASS.
Эта проверка — независимая: собственная живая репродукция на реальном standalone-сервере +
Postgres + Redis, не пересказ ревью.

## Вердикт: FAIL

---

## Acceptance Criteria (из issue #582)

| # | AC | Статус |
|---|----|--------|
| 1 | `next-issue.md` содержит шаг с точным JSONL-форматом | PASS |
| 2 | Unit-тесты на новый парсер/агрегат | PASS |
| 3 | Дашборд показывает блок `/next-issue` без ошибок на пустых данных | PASS (для нового блока изолированно) — **но см. критическую находку: реальные (не пустые) данные ломают соседний, уже существовавший до этого PR блок дашборда** |

## Регрессия и статика

- `npm test -- --run`: **268 файлов, 3817/3817 тестов зелёные**.
- `npx tsc --noEmit`: чисто, 0 ошибок.
- `npm run lint`: 0 errors, 16 pre-existing warnings, ни один не в изменённых файлах (messenger,
  notifications, telephony) — подтверждено, не регрессия этого PR.

## Живой CLI-тест `npx tsx scripts/issue-queue.ts metric`

Невалидные аргументы отклонены корректно (exit 1, файл не тронут):
```
metric abc branch merged 1 1 30        → issue «NaN» — ожидаю положительное число
metric 999 test-branch bogus-outcome … → outcome «bogus-outcome» — ожидаю merged|parked|blocked|released
metric 999 "" merged 1 1 30            → branch не задан
metric 999 test-branch merged abc 1 30 → ci_fix_rounds/review_rounds/duration_min должны быть числами
metric -5 test-branch merged 1 1 30    → issue «-5» — ожидаю положительное число
```
Валидный вызов (`metric 582 claude/issue-582-pipeline-metrics merged 1 2 47`) → exit 0, корректно
сформированная строка JSONL, поля/порядок совпадают буква в букву с `NextIssueMetricEvent`:
```json
{"ts":"2026-08-15T23:03:04.863Z","issue":582,"branch":"claude/issue-582-pipeline-metrics","outcome":"merged","ci_fix_rounds":1,"review_rounds":2,"duration_min":47}
```
Второй вызов дописывает новую строку (append, не перезапись). Тестовый артефакт удалён,
`git status --short` после уборки — пусто.

## Живая проверка дашборда (реальный standalone-сервер + Postgres + Redis)

`npm run build:e2e` → `DEV_OVERLAY=1 npx tsx scripts/seed.ts` → `node .next/standalone/server.js`,
логин `admin@local`/`admin` (SUPERADMIN).

- **RBAC** (не менялся этим PR, но проверен как регрессия): аноним → `302 /auth/signin` (страница) /
  `401 UNAUTHORIZED` (API); `manager@local`/`user@local` → `302 /admin/forbidden` / `403 FORBIDDEN`;
  `admin@local` → `200`. Утечек нет.
- **Пустые данные** (файла `next-issue.metrics.jsonl` нет): `GET /api/monitoring/pipelines` →
  `nextIssueAggregate.totalRuns: 0`, страница рендерит "Ни одной завершённой задачи /next-issue за
  последние 30 дней…" без ошибок — AC3 выполнен буквально.
- **Build-ordering claim разработчика подтверждён эмпирически**: standalone-сборка (`output:
  standalone`, Next 16.2.6) действительно захватывает `docs/pipeline-runs/*` через file-tracing в
  момент `next build`, а не читает живьём из репо. Проверено оба порядка: (а) файл создан ДО
  `npm run build:e2e` → строки видны в `.next/standalone/docs/pipeline-runs/next-issue.metrics.jsonl`
  и в ответе API; (б) дозапись в файл репозитория ПОСЛЕ сборки, пока сервер уже работает, никак не
  отражается в ответе (`totalRuns` остаётся 0) — сервер `chdir`-нулся в `.next/standalone` и не видит
  живых изменений репо. Прогон `ci.yml`/`deploy.yml` подтверждает: `build`-джоба (пуш образа) идёт
  только по `push: [main]` **после** мержа PR, т.е. "закоммить до сборки" в проде выполняется
  автоматически — для локального тестирования это не баг, но задокументированная в задаче на QA
  формулировка верна.

## Критическая находка (блокирует вердикт): общий JSONL-файл `/next-issue` схлопывается с per-run файлами `pipeline.sh` и портит уже существующий блок дашборда

`listPipelineRuns()` (код ДО этого PR, `service.ts:93-117`) сканирует `docs/pipeline-runs/` и
трактует **любой** файл, оканчивающийся на `.metrics.jsonl`, как отдельный прогон `pipeline.sh`
(`<runId>.metrics.jsonl`, `runId` = имя файла без суффикса). Новый файл этого PR называется буквально
`next-issue.metrics.jsonl` — попадает под тот же glob.

Живая репродукция: положил в `docs/pipeline-runs/next-issue.metrics.jsonl` две валидные строки
`NextIssueMetricEvent` (issue #582, #583; ровно то, что реально напишет `metric`-команда этого PR),
пересобрал, поднял сервер, `GET /api/monitoring/pipelines` под SUPERADMIN:

```json
"runs": [{
  "runId": "next-issue", "task": "", "totalDurationSec": null,
  "status": "failed", "finalVerdict": "n/a", "qaIterations": 0, "reviewerIterations": 0
}],
"aggregate": { "totalRuns": 1, "successRate": 0, "avgDurationSec": null, ... }
```
HTML-рендер верхнего (существовавшего до PR) блока: "Прогонов (50 последних)" = 1, "Success rate" =
**0% / бейдж «Ошибка»**, "Средняя длительность" = **NaNм NaNс**, в списке "Последние прогоны
pipeline" — строка `n/a` / "(задача не указана)" / `next-issue`. Удалил файл → всё вернулось к
чистому `totalRuns: 0` — коллизия детерминированная и стопроцентно воспроизводимая, не артефакт
окружения.

Причина: `toRun()` (`service.ts:61-91`) читает поля `PipelineMetricEvent` (`stage`, `duration_sec`,
`task`, `verdict`), которых у `NextIssueMetricEvent` нет — получает `undefined` на каждом, отсюда
`NaN`-длительность, пустая задача, `finalVerdict: "n/a"` → ветка `status = "failed"` всегда.

**Почему это блокирует, а не nice-to-have:**
- Это не гипотетический edge case — это **основной путь**. Единственная цель `metric`-команды —
  чтобы файл `next-issue.metrics.jsonl` существовал и рос. В проде он появится при первом же
  завершении `/next-issue`-задачи (в т.ч., по иронии, при завершении самой задачи #582) и останется
  навсегда.
- Ломает уже отгруженную (до этого PR) функциональность — success rate/avg duration `pipeline.sh` на
  `/admin/monitoring/pipelines`, которым пользуются другие агенты/владелец для диагностики.
- Не поймано юнит-тестами: `service.test.ts` тестирует `readNextIssueMetrics`/`aggregateNextIssueRuns`
  и `listPipelineRuns` по отдельности, с изолированными моками `fs.readdir`/`fs.readFile` — ни один
  тест не кладёт `next-issue.metrics.jsonl` в тот же смоканный листинг директории, что и обычные
  per-run файлы, поэтому коллизия не всплыла ни в юнитах, ни в двух раундах ревью (оба раунда читали
  код и гоняли только `cmdMetric`/рендер нового блока изолированно, не полный листинг директории с
  обоими форматами одновременно).

**Рекомендация Developer'у (не чиню сам):** имя общего файла не должно оканчиваться на
`.metrics.jsonl`, либо `listPipelineRuns()` должен явно исключать `next-issue.metrics.jsonl` /
переехать на отдельный поддиректорий (`docs/pipeline-runs/next-issue/`).

## Проверка фикса code review (CI-resequencing, раунд 1 → раунд 2)

Подтверждено текстом `.claude/commands/next-issue.md:159-168`: для `tier: "auto"` инструкция теперь
явно требует `pr-wait $PR 30` **между** пушем коммита телеметрии и `pr-merge $PR` (было: пуш →
немедленный `pr-merge`, ломало мерж, т.к. `ci.yml` триггерится на `synchronize` без `paths-ignore`).
Также подтверждён fix для `park` после 3 кругов ревью на шаге 5 (`next-issue.md:118-119`) — явная
ссылка на телеметрию шага 7. Оба замечания раунда 1 устранены корректно.

## Уборка после проверки

`docs/pipeline-runs/next-issue.metrics.jsonl` удалён (репо и standalone-копия), `.next` удалён,
standalone-сервер остановлен, `SystemEvent` за последний час — 0 строк, `git status --short` — пусто.

## Итог

Три заявленных AC формально выполнены (формат в `next-issue.md`, unit-тесты, корректный пустой
дашборд). CI-resequencing фикс из ревью — на месте и корректен. Но независимая живая проверка нашла
детерминированную, стопроцентно воспроизводимую коллизию имён файлов: единственный shared-файл
`/next-issue`-телеметрии попадает под glob `*.metrics.jsonl`, которым существующий
`listPipelineRuns()` ищет per-run файлы `pipeline.sh`, и портит success rate/duration/список прогонов
на уже отгруженном участке того же дашборда — сработает при первом же реальном использовании фичи,
т.е. немедленно после мержа. Это функциональный баг-регресс, не пойманный юнитами/ревью.

**Вердикт: FAIL** — блокирует находка выше, по правилу «баг-репорт конкретен → Developer исправляет,
QA не чинит сам».

---

## Follow-up: повторная проверка фикса (`2ec332a`, ветка теперь на `dfc90dd`)

**Вердикт (обновлённый): PASS**

Фикс `2ec332a` переименовал общий файл `docs/pipeline-runs/next-issue.metrics.jsonl` →
`docs/pipeline-runs/next-issue.jsonl` (без суффикса `.metrics.jsonl`), обновил все живые ссылки
(`service.ts`, `types.ts`, `scripts/issue-queue.ts`, `.claude/commands/next-issue.md`), добавил
предупреждающие комментарии по обе стороны коллизии и регрессионный тест, смешивающий оба формата
файлов в одном моке `fs.readdir`. `code-reviewer` независимо перепроверил это (раунд 3,
`docs/qa-reports/issue-582-review.md`) — но это моя собственная, отдельная живая проверка того же
класса бага, который я нашла в первом проходе.

**Проверка 1 — статика на diff.** `git diff c3b7aef 2ec332a`: подтверждено, что
`NEXT_ISSUE_METRICS_FILE`/`METRICS_FILE` теперь указывают на `next-issue.jsonl` и в `service.ts`,
и в `scripts/issue-queue.ts`; `grep -rn "next-issue.metrics.jsonl"` по `src/`, `scripts/`, `.claude/`,
`docs/` (кроме `docs/qa-reports/`) — 0 совпадений в живом коде; единственные оставшиеся упоминания —
исторические (мой собственный оригинальный FAIL-отчёт выше, раунд 1 ревью, комментарий в тесте,
объясняющий контекст) — корректно, история не переписана.

**Проверка 2 — живая репродукция моего оригинального сценария, теперь на реальной файловой системе
(не мок).** Восстановила ровно ту коллизию, что нашла в первом проходе, но с текущим кодом:
1. Дважды реально вызвала `npx tsx scripts/issue-queue.ts metric 582 claude/issue-582-pipeline-metrics merged 1 2 47`
   и `metric 583 claude/issue-583-test parked 0 1 12` → `docs/pipeline-runs/next-issue.jsonl` создан
   с двумя валидными строками `NextIssueMetricEvent` (реальный вывод CLI, не мок).
2. Рядом создала синтетический per-run файл `pipeline.sh`-формата
   `docs/pipeline-runs/2026-08-15-qa-repro-test.metrics.jsonl` (2 события, стадии `po`+`qa`,
   `verdict: PASS`) — воспроизводит ровно то смешанное состояние директории, что сломало дашборд
   в первом проходе.
3. Прямым импортом (`npx tsx`, реальный процесс Node, реальная файловая система, БЕЗ моков)
   вызвала `listPipelineRuns()`, `aggregateRuns()`, `readNextIssueMetrics()`,
   `aggregateNextIssueRuns()` из `src/modules/pipeline-metrics/service.ts`.

Результат:
- `listPipelineRuns()` вернул **ровно один** прогон — `2026-08-15-qa-repro-test`
  (`status: "success"`, `finalVerdict: "PASS"`, `totalDurationSec: 210`) — корректные, не
  испорченные данные. `runs.some(r => r.runId === "next-issue")` → **`false`**.
- `aggregateRuns()` → `totalRuns: 1, successRate: 1, avgDurationSec: 210` — никакого `0%`/`NaN`,
  которые были в оригинальном баге.
- `readNextIssueMetrics()` корректно прочитал обе реально записанные строки из `next-issue.jsonl`.
- `aggregateNextIssueRuns()` корректно агрегировал их (`totalRuns: 2`, `outcomeCounts`,
  `medianDurationMin: 29.5` и т.д.).

Коллизия, заблокировавшая вердикт в первом проходе, структурно закрыта: `next-issue.jsonl`
и `*.metrics.jsonl` больше не пересекаются под одним glob'ом даже при реальном смешанном
листинге директории.

**Проверка 3 — уборка.** Удалила `docs/pipeline-runs/next-issue.jsonl`,
`docs/pipeline-runs/2026-08-15-qa-repro-test.metrics.jsonl` и временный скрипт репродукции.
`git status --short` — пусто, `git diff --stat` — пусто.

**Проверка 4 — регрессия и статика (перезапущено самостоятельно на `dfc90dd`).**
- `npm test -- --run`: **268 файлов, 3818/3818 тестов зелёные** (было 3817 — +1 регрессионный тест
  из фикса, `service.test.ts`: "does not pick up docs/pipeline-runs/next-issue.jsonl as a pipeline.sh
  run"). Прицельный прогон `service.test.ts` для `pipeline-metrics` отдельно — 22/22.
- `npx tsc --noEmit`: чисто, 0 ошибок.
- `npm run lint`: 0 errors, те же 16 pre-existing warnings (messenger, notifications, telephony) —
  не в изменённых этим PR файлах, не регрессия.

**Проверка 5 — AC не регрессировали.**
- AC1 (`next-issue.md` документирует точный формат JSONL): шаг 7 всё ещё содержит точную команду
  `metric` и путь `docs/pipeline-runs/next-issue.jsonl` (обновлён с фиксом) — PASS.
- AC2 (юнит-тесты на парсер/агрегат): не только сохранены, но и усилены новым regression-тестом —
  PASS.
- AC3 (дашборд без ошибок на пустых данных): не затронуто фиксом; логика пустого состояния не
  менялась в диффе `c3b7aef..2ec332a` — PASS (без повторной живой проверки, т.к. фикс не касался
  этого пути; ранее подтверждено в первом проходе).

## Итог (обновлённый)

Оригинальная критическая находка (коллизия имён файлов, портившая блок `pipeline.sh` на
`/admin/monitoring/pipelines`) устранена фиксом `2ec332a` и подтверждена моей собственной, отдельной
живой репродукцией на реальной файловой системе с реальным CLI-выводом и прямым вызовом продакшен-кода
модуля (не мок, не пересказ ревью). Регрессий нет: полный набор тестов, `tsc`, `lint` чисты.

**Финальный вердикт: PASS**
