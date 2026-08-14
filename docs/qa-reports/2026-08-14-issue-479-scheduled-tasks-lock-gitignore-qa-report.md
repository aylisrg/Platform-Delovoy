# QA-отчёт: issue #479 — убрать `.claude/scheduled_tasks.lock` из git-трекинга

## Скоуп
`git rm --cached .claude/scheduled_tasks.lock` (файл остаётся на диске) +
запись в `.gitignore`. Diff: 2 файла, `.claude/scheduled_tasks.lock` (1 удаление
из индекса), `.gitignore` (+5 строк). code-reviewer уже вернул PASS —
здесь независимая приёмочная проверка критерия приёмки issue.

## Критерий приёмки
«`git status` чист после работы сессии с планировщиком; свежий клон не
содержит lock-файла.»

## Проверки

### AC1: `git status` чист после мутации файла живой сессией
Перезаписал `.claude/scheduled_tasks.lock` другим `sessionId`/`pid`/timestamp
(симуляция live-сессии/scheduler stop-hook) → `git status --porcelain`
пустой. **PASS.**

### AC2: свежий клон не содержит lock-файла
- `git show badb2a6:.claude/scheduled_tasks.lock` → `fatal: path ... exists on
  disk, but not in 'badb2a6'` — прямое доказательство, что дерево коммита файл
  не содержит.
- `git ls-tree -r HEAD --name-only | grep scheduled_tasks` → пусто.
- Реальный `git clone --branch claude/issue-479-... file:///.../Platform-Delovoy`
  во временную директорию → `.claude/` в клоне содержит `agents/`, `commands/`,
  `feedback/`, `settings.json`, **но не** `scheduled_tasks.lock`.
**PASS.**

### AC3: файл реально остался на диске в этом чекауте (не удалён)
После обеих мутаций файл присутствует, читается, git считает его untracked
+ ignored (`!! .claude/scheduled_tasks.lock` в `git status --ignored`).
**PASS.**

### Независимая проверка `.claude/feedback/qa-patterns.md`
`git log` по файлу: 23 коммита за всю историю, 8 сегодня. Проверил diff
нескольких сегодняшних коммитов (`9b5aa0b`, `d775c42`, `4babe12`, `75fbe5d`) —
каждый добавляет ровно **одну строку** с уникальным именем реального
qa-report-файла (issue #502, #534, #471, #464 и т.д.), 1:1 соответствие
количеству смерженных PR с QA-вердиктом в этой сессии. Не session-churn:
никаких перезаписей одной и той же строки, никаких «пустых» коммитов только
с этим файлом. Вывод code-reviewer подтверждаю независимо — это легитимный
накопительный лог, не runtime-артефакт.

### Документация / упоминания в других местах
`grep -rn "scheduled_tasks.lock"` по всему репозиторию → единственное
совпадение — новая запись в `.gitignore`. README/CONTRIBUTING/онбординг-скрипты
файл нигде не упоминают как ожидаемый к коммиту — документационного долга
фикс не оставляет.

### Регрессия
- `npx tsc --noEmit` — чисто, без ошибок.
- `npm run lint` — 0 errors, 16 pre-existing warnings (не в изменённых файлах).
- `npm test -- --run` — 247 test files / 3569 tests passed.

## Итог
- Всего кейсов: 4 (AC1, AC2, AC3 + doc-gap check) + регрессия
- Пройдено: 4/4 + регрессия зелёная
- Провалено: 0

## Вердикт: PASS
