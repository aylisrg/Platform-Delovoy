# QA: chore(metrics) — телеметрия /next-issue для issue #753 (PR #769)

## Вердикт: PASS

## Контекст

Follow-up к PR #767 (код-фикс issue #753). Свипер `issue-queue-merge.yml`
смержил PR #767 раньше, чем сессия дошла до штатного шага телеметрии
(`.claude/commands/next-issue.md`, шаг 7), поэтому строка metric не могла
уехать в закрытую ветку. PR #769 добавляет ту же строку отдельным коммитом
на `main` — предусмотренный runbook'ом сценарий гонки со свипером.

Для этого изменения нет PRD (не фича, служебная запись наблюдаемости
пайплайна). Проверка ведётся по трём AC, сформулированным для этого
конкретного PR (см. задание), а не по стандартной AC-таблице PO.

## Замечания ревьюера

`docs/qa-reports/issue-753-telemetry-review.md` — вердикт PASS, замечаний
и рекомендаций к исправлению нет. Ревьюер уже перепроверил значения строки
против git-истории (ветка, таймстампы, review/CI-раунды) — не дублирую эту
проверку, беру за основу.

## AC-1: Ровно одна строка добавлена в `docs/pipeline-runs/next-issue.jsonl`, другие файлы не тронуты

**Статус: PASS**

- `git diff main...HEAD --stat`:
  ```
  docs/pipeline-runs/next-issue.jsonl | 1 +
  1 file changed, 1 insertion(+)
  ```
- `git show HEAD` (единственный коммит `5142854`) подтверждает: один файл,
  одна добавленная строка, без удалений/модификаций существующей строки #669.
- `git status --short` в рабочем дереве не показывает трекнутых изменений
  сверх этого коммита (единственный untracked-файл —
  `docs/qa-reports/issue-753-telemetry-review.md`, артефакт ревьюера, не
  часть диффа PR).

## AC-2: JSON-строка валидна и соответствует схеме

**Статус: PASS**

- `node -e "JSON.parse(...)"` по обеим строкам файла — валидный JSON, у
  обеих одинаковый набор ключей в одинаковом порядке:
  `ts,issue,branch,outcome,ci_fix_rounds,review_rounds,duration_min`.
- Добавленная строка:
  `{"ts":"2026-08-25T04:09:13.168Z","issue":753,"branch":"claude/issue-753-checkout-main-for-single-to-queue","outcome":"merged","ci_fix_rounds":0,"review_rounds":1,"duration_min":24}`
- `outcome: "merged"` — валидное значение `NEXT_ISSUE_OUTCOMES` в
  `scripts/issue-queue.ts:789` (`['merged','parked','blocked','released']`),
  подтверждено чтением `cmdMetric()` (строки 799–830) — та же функция, что
  генерирует существующую запись #669.
- `issue`, `ci_fix_rounds`, `review_rounds`, `duration_min` — целые числа,
  типы совпадают с первой строкой.

## AC-3: `npm test`, `npx tsc --noEmit`, `npm run lint` зелёные

**Статус: PASS**

- `npm test -- --run`: 314 test files passed, 4370 tests passed, 0 failed.
- `npx tsc --noEmit`: без вывода — типы проходят чисто.
- `npm run lint`: exit code 0; 21 warning (0 errors) — все в файлах,
  не относящихся к диффу (`messenger/ChatWindow.tsx`, `messenger/useChatList.ts`,
  `messenger/MessageBubble.tsx`, `modules/messenger/types.ts`,
  `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts`) —
  предсуществующие, этим PR не введены и не усугублены (PR не касается ни
  одного из этих файлов).

Ожидаемо: чисто-данные изменение в `.jsonl`-файле не затрагивает ни один из
трёх гейтов — подтверждено фактическим прогоном, а не предположением.

## Security

**Статус: N/A** — pure data-file change, не API/UI код.

- RBAC: N/A. Файл не является API endpoint'ом; читается офлайн-дашбордом
  `src/modules/pipeline-metrics/service.ts` (не менялся в этом PR, RBAC
  этого модуля данным PR не затрагивается).
- Rate limiting: N/A — не endpoint.
- Input validation: N/A — строка не принимает пользовательский ввод, это
  вывод детерминированного `JSON.stringify()` внутри `cmdMetric()`
  (параметры — issue/branch самого пайплайна, не untrusted input).
- Data leakage: строка содержит только номер issue, имя git-ветки, статус,
  числовые счётчики и ISO-таймстамп — ни email, ни телефон, ни ИНН, ни
  токены/секреты не встречаются (перепроверено grep'ом на
  `password|token|secret|nextauth|telegram.*token|api[_-]key` — совпадений
  нет).

Фабрикация security-кейсов (RBAC-таблица под ролями, rate-limit нагрузка и
т.п.) для чисто-данных PR была бы имитацией процесса без содержания —
явно отмечаю N/A вместо этого, как указано в задании.

## Edge cases

Не применимо в стандартном смысле (нет API/UI-поверхности для проверки
пустых/невалидных данных, конкуренции, превышения лимитов) — единственный
релевантный edge case для append-only лога это «не затёрта ли предыдущая
строка», проверено в AC-1 (`git show HEAD` — только insertion, 0 deletions).

## Регрессия

`npm test` (4370/4370), `tsc --noEmit`, `npm run lint` — все зелёные,
запущены после чекаута этой ветки, не унаследованы из кэша/предположения.

## Итог

| AC | Статус |
|----|--------|
| AC-1: ровно одна строка, другие файлы не тронуты | PASS |
| AC-2: JSON валиден и соответствует схеме | PASS |
| AC-3: test/tsc/lint зелёные | PASS |
| Security | N/A (обосновано) |

Все проверяемые AC — PASS, security-кейсы корректно помечены N/A без
фабрикации. Общий вердикт — **PASS**.
