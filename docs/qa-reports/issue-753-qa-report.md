# QA-отчёт: #753 — конвертер dependabot-singles падает на npm ci содержимого PR — мажоры остаются без задач

**Issue**: https://github.com/aylisrg/Platform-Delovoy/issues/753
**Ветка**: `claude/issue-753-checkout-main-for-single-to-queue`, HEAD `dcc4c98`
**Коммит**: `dcc4c98` (единственный, `fix(ci): чекаутить main, а не merge-ref PR, в single-to-queue`)
**Ревью кода**: PASS (code-reviewer, `docs/qa-reports/issue-753-review.md`) — задача не повторное ревью, а независимая приёмка по AC issue.

Адаптация задачи: это `/next-issue` фикс из автоочереди, не `/feature`-пайплайн —
PRD/ADR под `docs/requirements/`/`docs/architecture/` не существует и не нужен;
источник истины — тело issue #753 (см. постановку задачи). Изменение
CI/YAML-only — нет живого GitHub Actions раннера для реального диспатча,
поэтому «тестирование» здесь — статическая/семантическая верификация YAML и
логики джобы, плюс обязательный репо-широкий regression (`npm test`, `tsc`,
`lint`), который должен остаться зелёным несмотря на то, что сам PR CI-only.

## Acceptance Criteria — независимая проверка по каждому пункту

### AC-1: checkout-шаг `single-to-queue` использует `ref: main` вместо PR merge-ref

`.github/workflows/dependabot-automerge.yml:66-69`:
```yaml
      - uses: actions/checkout@v7
        if: steps.metadata.outputs.dependency-group == ''
        with:
          ref: main
```
Раньше `with:` отсутствовал, значит `actions/checkout@v7` брал дефолт для
события `pull_request` — merge-ref самого PR. Теперь явный `ref: main`.
Подтверждено чтением полного файла и `git show HEAD`. PASS.

### AC-2: нет другой джобы с тем же паттерном (чекаут PR-контента + npm ci без надобности в этом контенте)

Структурный grep по файлу (`^  [a-zA-Z_-]+:$`) находит ровно два верхнеуровневых
блока: `pull_request:` (это `on:`-триггер, не джоба) и `single-to-queue:`
(единственная джоба). Второй grep по `- uses: actions/checkout` тоже даёт ровно
одно совпадение — та же строка 66. Других джоб в файле нет физически, значит
критерий выполняется тривиально, но я проверил это структурно, а не принял на
слово из отчёта reviewer'а. PASS.

### AC-3: изменение скоуп-ограничено — тронут только `dependabot-automerge.yml`

```
$ git diff main..HEAD --stat
 .github/workflows/dependabot-automerge.yml | 10 ++++++++++
 1 file changed, 10 insertions(+)
```
Один файл, только добавления (0 удалений). Из diff: 3 строки — `with:` +
`ref: main`, остальные 7 — объясняющий комментарий над тем же шагом (соответствует
уже сложившейся в файле конвенции комментирования решений прямо в workflow).
Ничего постороннего не тронуто. PASS.

### AC-4: YAML остаётся синтаксически валиден

```
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/dependabot-automerge.yml')); print('YAML OK')"
YAML OK
```
`with:` вложен на правильном уровне под тем же шагом, что и существующий `if:`.
PASS.

### AC-5: поведение для групповых dependabot-PR не меняется — `if:`-условия не тронуты

Прошёлся построчно по всем четырём шагам после `Fetch Dependabot metadata`:

| Шаг | `if:` |
|---|---|
| `actions/checkout@v7` | `steps.metadata.outputs.dependency-group == ''` |
| `./.github/actions/setup-node` | `steps.metadata.outputs.dependency-group == ''` |
| «Убедиться, что лейбл dependencies существует» | `steps.metadata.outputs.dependency-group == ''` |
| «Create queue issue for the update» | `steps.metadata.outputs.dependency-group == ''` |

Все четыре — байт-в-байт идентичное условие, ни одно не изменено диффом (diff
показывает только добавление `with: ref: main` и комментарий; ни одна строка
`if:` не входит в патч). Для группового PR (`dependency-group` непусто) все
четыре шага по-прежнему пропускаются целиком — чекаут/setup-node/создание
issue не выполняются, как и раньше. PASS.

### AC-6: метаданные PR (title, deps, update-type) по-прежнему корректно приходят из `dependabot/fetch-metadata`, несмотря на смену ref чекаута

Проследил порядок шагов и источник данных:
1. `Fetch Dependabot metadata` (`id: metadata`, `dependabot/fetch-metadata@v3`)
   — **первый** шаг джобы, идёт до `actions/checkout`. Экшен читает метаданные
   PR через GitHub API (по `github-token`), а не из файловой системы чекаута —
   на момент его выполнения чекаута ещё не было вообще (никакого `actions/checkout`
   раньше в файле нет). Значит смена `ref` у последующего чекаута физически не
   может повлиять на этот шаг — он завершается до того, как чекаут вообще
   начинается.
2. Все места использования метаданных — `if: steps.metadata.outputs.dependency-group == ''`
   (4 шага, см. AC-5) и `env:` блок шага «Create queue issue»:
   `DEPS: ${{ steps.metadata.outputs.dependency-names }}`,
   `UPDATE_TYPE: ${{ steps.metadata.outputs.update-type }}`. Это GitHub Actions
   expression-синтаксис (`${{ }}`), интерполируемый раннером из записанных
   аутпутов шага `metadata` — key-value store, который раннер ведёт независимо
   от файловой системы job'ы. Ни `if:`, ни `env:` не читают файлы из чекаута.
3. Значит переупорядочивание/смена `ref` чекаута, идущего **после**
   `metadata`, не может сломать то, что уже зафиксировано в
   `steps.metadata.outputs.*` — эти данные читаются GitHub Actions runtime, а
   не кодом, который сам зависит от checked-out содержимого.

PASS.

## Регрессия (репо-широкая, обязательна даже для CI-only диффа)

| Проверка | Результат |
|---|---|
| `npm test` | `Test Files 314 passed (314)`, `Tests 4370 passed (4370)`, 58.68s — зелёный, без флейков |
| `npx tsc --noEmit` | чисто, без вывода, exit 0 |
| `npm run lint` | `0 errors, 21 warnings` — все 21 в файлах, не тронутых этим диффом (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts` — `react-hooks/set-state-in-effect`, неиспользуемые импорты). Пред-существующий долг, не внесён этим PR |

## Security

Функциональные security-кейсы из `agents/qa.md` (RBAC/rate limiting/input
validation/data leakage) **не применимы** — это CI-workflow-конфигурация, не
API-эндпоинт: нет ролей пользователей, нет HTTP-запросов от клиента, нет
пользовательского ввода, обрабатываемого этим диффом (единственный
пользовательский ввод в джобе — тело/метаданные PR от `dependabot[bot]`, и
диффом их обработка не тронута). Явно фиксирую это, а не подгоняю
фиктивные тест-кейсы под чеклист, которому этот PR не соответствует по типу
изменения.

Дополнительно проверено:
- `git diff main..HEAD -- .github/workflows/dependabot-automerge.yml | grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — **ноль совпадений** в самом диффе (более строгая проверка, чем full-file grep у reviewer'а, который закономерно находит уже существующий `${{ secrets.GITHUB_TOKEN }}`, не тронутый этим PR). Новых секретов/токенов диффом не добавлено.
- `permissions:` блок джобы (`contents: read`, `pull-requests: read`, `issues: write`) диффом не изменён. `ref: main` при `contents: read` — только чтение, ничего не пушится и не мутирует `main`.
- Инъекционная поверхность не расширена: изменение — статический YAML-литерал `ref: main`, пользовательский ввод (данные из PR/dependabot) в этот шаг не подставляется.

## Edge cases

- **Что если `main` не существует под этим именем** (например, переименование
  ветки при смене политики branch protection) — тогда `actions/checkout@v7`
  упадёт на разрешении рефа, и джоба сломается на самом первом шаге вместо
  того, чтобы сработать против чужого дефолта. Это не новый риск, вносимый
  этим PR: `CLAUDE.md` и весь остальной корпус workflow'ов в репозитории
  (`issue-queue-merge.yml`, `auto-rebase.yml`, `release.yml` и др.) уже
  повсеместно жёстко полагаются на то, что продакшн-ветка называется именно
  `main` — жёсткая привязка к имени `main` не специфична для этого диффа.
  Фиксирую как non-blocking наблюдение, не как баг этого PR.
- **Групповые PR (`dependency-group` непусто)** — явно проверено в AC-5:
  поведение не изменилось, все 4 шага после метаданных по-прежнему пропускаются
  целиком.
- **Дрейф `main`-лока и лока самого PR** — фикс намеренно меняет источник
  зависимостей для `npm ci` внутри джобы с package.json/lockfile PR на
  package.json/lockfile `main`. Это ожидаемое и корректное поведение по
  постановке issue: `issue-queue.ts create` (единственное, что реально
  использует зависимости в этой джобе) работает с `scripts/`/зависимостями
  `main`, содержимое PR ему не нужно вовсе — резюмировано в комментарии,
  добавленном самим фиксом, и подтверждено чтением остального файла джобы
  (единственный потребитель зависимостей после setup-node — `npx tsx
  scripts/issue-queue.ts create`, читающий `scripts/issue-queue.ts` с чекнутого
  дерева, то есть теперь гарантированно с `main`).

## Вердикт: PASS

Все шесть AC из issue #753 выполнены и перепроверены независимо от
code-reviewer: `ref: main` действительно заменил дефолтный PR merge-ref
(AC-1); в файле объективно только одна джоба, паттерн не повторяется нигде
(AC-2); дифф — 1 файл, 10 добавлений, 0 удалений (AC-3); YAML валиден
(AC-4); все четыре `if:`-условия джобы байт-в-байт не тронуты, групповые PR
по-прежнему полностью пропускают чекаут/setup-node/создание issue (AC-5);
`dependabot/fetch-metadata` выполняется до чекаута и его аутпуты читаются
через GitHub Actions expression-синтаксис, не через файлы чекаута, поэтому
смена `ref` не может их сломать (AC-6). Репо-широкая регрессия зелёная —
`npm test` 4370/4370, `tsc --noEmit` чисто, `lint` 0 ошибок (только
пред-существующие несвязанные warning'и). Security-чеклист функционально
не применим для CI-конфигурации, явно отмечено как N/A; отдельно
подтверждено отсутствие новых секретов/токенов в диффе. Единственное
замечание — non-blocking наблюдение про жёсткую привязку к имени ветки
`main`, не специфичное для этого PR и не вносимое им.
