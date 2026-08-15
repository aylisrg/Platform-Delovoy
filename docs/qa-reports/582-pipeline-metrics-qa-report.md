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
