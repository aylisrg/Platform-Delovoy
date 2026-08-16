# Review: Джиттер сужает окно гонки claim() (issue #647)

## Вердикт: PASS

## Acceptance Criteria
Формального PRD/ADR для этой задачи нет (небольшая мелкая задача автоочереди
бэклога, разобранная напрямую из issue #647 — так же, как #564/#626/#645, её
породившие). Источник правды — сам текст issue #647. Сверка по нему:

| AC (из issue #647) | Статус | Комментарий |
|----|--------|-------------|
| Джиттер/recheck перед claim снижает вероятность двойного захвата одной issue двумя сессиями, разбуженными одним триггером | PASS | `claimJitterSeconds()` (0.2–1.5с) вызывается через `execFileSync('sleep', [...])` **до** GET issue в `cmdClaim` (scripts/issue-queue.ts:307-316) — именно та позиция, которая даёт эффект (разносит во времени старт read-check-write окна двух параллельных вызовов). Сон после чтения был бы бесполезен — этого не сделано. |
| PR честно признаёт, что это mitigation, а не полный fix (issue сам говорит, что GitHub Issues API не даёт CAS/ETag) | PASS | Комментарии в коде (scripts/lib/issue-queue.ts:108-116, scripts/issue-queue.ts:308-311) и commit message явно говорят "не устраняя её полностью" / "настоящей атомарности здесь нет". Проверил заявление разработчика: `scripts/lib/gh-api.ts` — действительно голая curl-обёртка (`ghApi`), без `If-Match`/ETag/conditional headers — утверждение технически верно. |
| PR не трогает `.github/issue-queue.json`, workflow'ы очереди и прочий automation-config сверх двух HOLD_PATTERNS-файлов + их теста | PASS | `git diff main...HEAD --name-only` → ровно `scripts/__tests__/issue-queue.test.ts`, `scripts/issue-queue.ts`, `scripts/lib/issue-queue.ts`. Ничего лишнего. |
| Существующие тесты и типизация остаются зелёными, добавлены тесты на обе новые функции | PASS | См. раздел "Тесты" ниже. |

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет. Только: (1) `claimJitterSeconds` + `assertClaimable` в `scripts/lib/issue-queue.ts` (2) `cmdClaim` в `scripts/issue-queue.ts` использует обе (3) тесты на обе функции. Импорт `laneOf` в `scripts/issue-queue.ts` оставлен нетронутым — проверил: используется ещё в 6 местах файла (строки 254, 746, 831, 931, 942, 1060), так что удалять его было бы неверно.
- Оба тронутых source-файла (`scripts/issue-queue.ts`, `scripts/lib/issue-queue.ts`) — в `HOLD_PATTERNS` (scripts/lib/issue-queue.ts:461-469), значит PR гарантированно уйдёт в `hold` и потребует ручного мержа владельца независимо от корректности кода. Это ожидаемо и не является блокером (сам issue #647 это явно обозначил).

## Проверка эквивалентности рефакторинга (assertClaimable)
Сравнил построчно старую инлайновую логику из диффа и новую вынесенную функцию:

```
// было (в cmdClaim):
if (laneOf(labels) === 'wip') throw new Error(`#${num} уже auto:wip — лок занят`);
if (laneOf(labels) !== 'ready') throw new Error(`#${num} не в auto:ready (сейчас: ${laneOf(labels)})`);

// стало (assertClaimable, scripts/lib/issue-queue.ts:124-128):
const lane = laneOf(labels);
if (lane === 'wip') throw new Error(`#${num} уже auto:wip — лок занят`);
if (lane !== 'ready') throw new Error(`#${num} не в auto:ready (сейчас: ${lane})`);
```

Порядок проверок (`wip` раньше `not-ready`), тексты ошибок и вызов `laneOf` —
идентичны. `laneOf` — чистая функция без побочных эффектов и без внутреннего
состояния (простой lookup по массиву меток, scripts/lib/issue-queue.ts:81-94),
поэтому кэширование результата в одну локальную переменную вместо трёх
отдельных вызовов не меняет поведения для одного и того же `labels`. Семантика
claim для нормального (нерейсового) случая не изменилась.

## Проверка sleep/fractional seconds
`claimJitterSeconds().toFixed(3)` даёт строку вида `"0.734"`. Руками проверил:
`sleep "0.734"` и `sleep "0.200"` (GNU coreutils sleep, дробные секунды) —
отрабатывают корректно (`real 0m0.736s`). Совпадает с уже существующим
паттерном `execFileSync('sleep', ['30'])` в `pr-wait` (scripts/issue-queue.ts:600).

## Качество кода
- TypeScript strict: OK (`npx tsc --noEmit` — чисто, без ошибок)
- Чистые, тестируемые функции: OK — `claimJitterSeconds` и `assertClaimable`
  вынесены в `scripts/lib/issue-queue.ts` по тому же паттерну, что и соседние
  `isEligible`/`pickNext` — тестируются без сети и без мока `execFileSync`
- Комментарии: OK — честно описывают, что это mitigation, а не CAS-фикс, и
  почему (нет ETag/If-Match поддержки в `gh-api.ts`)
- Тесты: OK (см. ниже)

## Тесты
```
npx vitest run scripts/__tests__/issue-queue.test.ts → 133 passed
npm test -- --run (полный набор)                     → 282 files / 3951 tests passed
npx tsc --noEmit                                       → чисто
npm run lint                                           → 0 errors, 16 pre-existing warnings
                                                          (все в src/components/*, src/modules/messenger,
                                                          notifications, telephony — не в файлах диффа)
```
Новые тесты (`assertClaimable`, `claimJitterSeconds` в
`scripts/__tests__/issue-queue.test.ts`) покрывают: no-throw на `ready`,
throw с точным текстом на `wip`, throw с правильным именем lane для
`review`/`untriaged` (граница `assertClaimable`); нижнюю границу (`rand()=0`
→ `0.2`), середину (`rand()=0.5` → `0.85`), приближение к верхней границе без
превышения (`rand()=0.999999` → `< 1.5`) и то, что разные входы дают разные
выходы (джиттер действительно варьируется) — для `claimJitterSeconds`. Границы
и середина протестированы явными числовыми значениями, а не approximation —
хороший тест на чистую функцию.

## Безопасность

### Secrets leakage
`grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по
диффу — 0 совпадений. Функции не логируют и не возвращают ничего связанного
с auth/токенами; `execFileSync('sleep', ...)` не принимает пользовательский
ввод (аргумент — вычисленное локально число).

### RBAC / injection
Не применимо к этому PR — это internal automation-скрипт (issue-queue CLI),
не API endpoint. Нет новых HTTP-эндпоинтов, нет пользовательского ввода,
идущего в SQL/HTML. `execFileSync('sleep', [str])` — вызов с фиксированной
командой и одним числовым аргументом, без shell-интерполяции (execFileSync,
не exec/spawn с shell:true) — инъекция невозможна.

### Dangerous ops
Нет `rm -rf`, `git push --force`, `git reset --hard`, деструктивных миграций.
Единственная новая shell-команда — `sleep <N>`, безопасна.

### Supply chain
Новых зависимостей не добавлено (`package.json` не тронут).

**Вывод по Security: инцидентов не найдено.**

## Инженерная оценка величины джиттера (0.2–1.5с)
Разумно для P2 best-effort митигации, не требую доработки:
- Достаточно широко, чтобы развести вызовы, разбуженные одним и тем же
  событием (Routine-триггер раз в 2 часа — сессии стартуют не с наносекундной
  синхронностью, но именно такие "одновременные побудки" и есть целевой
  сценарий issue).
- Достаточно узко, чтобы не заметно замедлять `claim` в штатном (нерейсовом)
  случае — среднее ~0.85с на каждый вызов приемлемо для CLI-скрипта,
  вызываемого несколько раз в сессию, не в горячем пути пользовательского
  запроса.
- Как явно признано и в issue, и в коде: не спасает от двух вызовов, разнесённых
  на N секунд, где N всё ещё попадает в оба джиттер-окна плюс сетевую задержку
  GET/PATCH — это несократимая часть проблемы без CAS/ETag на стороне GitHub,
  и авторы это не скрывают.

## Что хорошо
- Честные комментарии и commit message: явно написано "не устраняя её
  полностью" — нет попытки выдать mitigation за полноценный fix.
- Джиттер физически размещён до read (единственное место, где он даёт эффект)
  — проверено по коду, не только со слов автора.
- Рефакторинг `assertClaimable` не меняет семантику — проверено построчным
  сравнением старого/нового кода и чистотой `laneOf`.
- Чистые функции с DI параметром (`rand: () => number = Math.random`) —
  тестируются детерминированно без мока `Math.random` или sleep.
- Диапазон изменений предельно узкий: ровно два HOLD_PATTERNS-файла + их тест,
  никакой автоматической config/workflow-правки — ожидаемый ручной мерж не
  является риском, вызванным этим PR.
