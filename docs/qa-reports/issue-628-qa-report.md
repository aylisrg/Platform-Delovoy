# QA-отчёт: Issue #628 — уточнить `description` playwright-сервера в `.mcp.json`

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-628-mcp-playwright-description`, единственный коммит `a01b857` поверх
  `main` (`git log main..HEAD --oneline` → 1 коммит, `git diff main...HEAD --stat` → 1 файл).
- Та же формулировочная путаница, что уже была исправлена в `docs/mcp-servers.md` для issue
  #574: поле `description` секции `playwright` в `.mcp.json` смешивало интерактивный браузерный
  MCP-инструмент (агент открывает страницу, заполняет форму, сверяется визуально внутри сессии)
  с полностью отдельным автоматическим E2E regression suite'ом (`e2e/*.spec.ts`, `npm run e2e`,
  CI-job `E2E (Playwright)` из `.github/workflows/ci.yml`, добавлен в #592) — этот CI-job MCP-
  сервер не использует вообще.
- Code Reviewer уже вынес PASS (`docs/qa-reports/issue-628-review.md`, на диске присутствует).
  Ниже — независимая проверка, не переповторение его выводов: сам распарсил JSON, сам сверил
  каждую фактическую ссылку в новом тексте с первоисточником в коде/истории git.
- PRD/ADR под эту задачу не заводились — точечный docs/config-фикс одного поля, эталон — уже
  одобренная (issue #574) формулировка в `docs/mcp-servers.md`, не новая архитектура.

## Диф
```diff
-      "description": "Browser automation for QA agent — E2E smoke tests, visual regressions."
+      "description": "Interactive browser checks during an agent session (open a page, fill a
+       form, visually verify) — not the automated E2E regression suite, which lives in
+       e2e/*.spec.ts (npm run e2e) and runs in CI as the separate \"E2E (Playwright)\" job
+       (.github/workflows/ci.yml, added in #592) without this MCP server."
```
`git diff main...HEAD --stat`: **`.mcp.json | 2 +-`, 1 файл, 1 insertion, 1 deletion.** Текст
диффа дословно совпадает с формулировкой, заданной в issue #628 (сверил посимвольно).

## Регрессия
- `npm test -- --run` (полный набор): **282 test files passed (282), 3946 tests passed (3946)**,
  0 failed.
- `npx tsc --noEmit`: чисто, пустой вывод.
- Doc/config-only диф не меняет тестируемый код — ожидаемо без регрессий; прогнал явно как
  sanity-check поверх требований AC (AC явно не требует тестов для строки описания в конфиге).

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `.mcp.json` playwright-description больше не путает интерактивный MCP-инструмент с CI E2E-сьютом | PASS | Новый текст явно разводит обе стороны и даёт конкретные проверяемые якоря: `e2e/*.spec.ts`, `npm run e2e`, точное имя job'ы `"E2E (Playwright)"`, файл `.github/workflows/ci.yml`, ссылка на `#592`, плюс явная оговорка «without this MCP server». Старый текст («Browser automation for QA agent — E2E smoke tests, visual regressions.») такой путаницы не устранял — полностью заменён. |
| 2 | `.mcp.json` остаётся валидным JSON | PASS | Независимо распарсил файл: `node -e "JSON.parse(fs.readFileSync('.mcp.json'))"` — без ошибок. Полный файл прочитан целиком (`Read` tool): структура не повреждена — `$schema` + 4 сервера (`postgres`, `filesystem`, `playwright`, `github-actions`) на месте, кавычки внутри нового `description` (`\"E2E (Playwright)\"`) корректно экранированы, JSON синтаксически валиден. |
| 3 | Другие поля/сервера в `.mcp.json` не тронуты, скоуп-крипа нет | PASS | `git diff main...HEAD --name-only` → ровно `.mcp.json`. Полный `git diff` (не только `--stat`) показывает единственный hunk — одна строка внутри блока `playwright`. `postgres`, `filesystem`, `github-actions`, `$schema`, `command`/`args` секции `playwright` — байт в байт как на `main`. |

## Фактчек ссылок внутри нового текста (независимо от reviewer'а)
Новый `description` делает 4 проверяемых утверждения — каждое перепроверено напрямую, не по
словам reviewer'а:

1. **`e2e/*.spec.ts` существует как реальный glob файлов** — PASS. `ls e2e/*.spec.ts` → 6 файлов:
   `admin-rbac.spec.ts`, `cafe-checkout.spec.ts`, `gazebo-booking.spec.ts`, `homepage.spec.ts`,
   `ps-park-booking.spec.ts`, `visual-regression.spec.ts` (последний добавлен позже #574, глоб
   `e2e/*.spec.ts` остаётся корректным описанием — текст не называет конкретное число файлов).
2. **`package.json` имеет скрипт `e2e`, запускающий Playwright** — PASS. `package.json:17` →
   `"e2e": "playwright test"`.
3. **`.github/workflows/ci.yml` содержит job с именем ровно `"E2E (Playwright)"`** — PASS.
   `ci.yml:114` → `name: E2E (Playwright)`, job `e2e:` (условие `if: github.event_name ==
   'pull_request'`, отдельный от unit-тестов/tsc/lint/security jobs).
4. **Job действительно добавлен в #592** — PASS. `git log --diff-filter=A -p -- ci.yml | grep
   "E2E (Playwright)"` → коммит `c5acfbb`, сообщение дословно: `feat(ci): Playwright E2E job —
   критические флоу против живого стека (#592)`, автор `claude[bot]`, дата 2026-08-14. Ссылка на
   `#592` в новом `description` — не выдумана, номер issue верный.
5. **Этот CI-job не использует playwright MCP-сервер** — PASS (косвенно, но проверено). `grep -in
   "mcp" .github/workflows/ci.yml` → 0 совпадений во всём файле. Job `e2e` запускает `npx
   playwright test` напрямую против собранного standalone-сервера (см. коммит-сообщение #592) —
   MCP-протокол там не задействован ни явно, ни неявно.

Все пять фактических якорей в новой формулировке подтверждены первоисточником (файл/строка/
коммит), ни один номер issue или путь не оказался неверным.

## Кросс-сверка с уже одобренной формулировкой (issue #574)
Английский текст в `.mcp.json` — по существу перевод уже одобренной русской формулировки в
`docs/mcp-servers.md:63` (issue #574): «Интерактивная проверка в браузере во время сессии
агента... Не путать с автоматическим regression-сьютом — тот живёт в `e2e/*.spec.ts` (`npm run
e2e`) и гоняется в CI отдельной job'ой `E2E (Playwright)` (`.github/workflows/ci.yml`, добавлено
#592), без участия этого MCP-сервера.» Оба текста называют одни и те же файлы/команды/номер
issue — расхождения между двумя источниками истины про этот MCP-сервер (`docs/mcp-servers.md` и
`.mcp.json`) больше нет, что и было целью #628 (этот же разрыв был явно отмечен как известный
оставшийся пункт дрейфа в QA-отчёте #574).

## Security-чеклист (функциональный, из agents/qa.md / SECURITY.md)
- [x] Секретов/токенов/PII в диффе нет — `grep -rniE
  '(password|token|secret|nextauth|telegram_.*token|api[_-]key)' .mcp.json` находит только
  `GITHUB_PERSONAL_ACCESS_TOKEN` в секции `github-actions.env` (плейсхолдер переменной окружения
  `${GITHUB_PERSONAL_ACCESS_TOKEN}`, не литеральный секрет) — эта секция диффом не тронута,
  идентична версии на `main`.
- [x] Изменение не затрагивает API/RBAC/rate limiting/пользовательские данные — правка одной
  строки текста в MCP-конфиге, нет кода, нет эндпоинтов, нет мутаций данных. Функциональные
  security-кейсы (RBAC под ролями, rate limiting, input validation, data leakage) к этому диффу
  неприменимы.
- [x] Новый текст `description` — статическая строка метаданных для Claude Code, не выполняется
  и не рендерится как HTML/SQL/shell — риска инъекции нет.
- [x] Итоговый JSON синтаксически валиден (проверено независимым парсером, см. AC #2) — единственный
  реальный риск для конфиг-файла такого рода («сломанный `.mcp.json` тихо ломает загрузку MCP-
  серверов для всех будущих сессий», как прямо указано в задаче) закрыт.

Security-блокеров нет.

## Edge cases
- Экранирование вложенных кавычек `\"E2E (Playwright)\"` внутри JSON-строки — проверено парсером,
  корректно.
- Многострочность нового текста (описание длиннее прежнего) — JSON не чувствителен к длине
  строки, парсинг прошёл без ошибок.
- Тест на строку описания в конфиге отсутствует и не требуется: это не исполняемый код, а
  human/agent-readable метаданные для MCP-загрузчика Claude Code; `grep -r "mcp.json"
  **/*.test.ts` → 0 файлов, автотеста для этого поля в кодовой базе нет и логично не может быть —
  аналогично принятому сиблинг-фиксу #627 (CODEOWNERS docs) и #574 (mcp-servers.md) в этом же
  цикле. Приёмочный критерий здесь — чтение + фактчек, а не unit-тест, как и указано в задаче.

## Scope check
- Изменён ровно один файл (`.mcp.json`), ровно одно поле (`description` секции `playwright`).
- `docs/mcp-servers.md`, `package.json`, `.github/workflows/`, остальные секции `.mcp.json`
  (`postgres`, `filesystem`, `github-actions`, `$schema`) — не тронуты.
- Ветка содержит ровно 1 коммит поверх `main` (`git log main..HEAD --oneline`).

## Итог
- Всего AC: 3
- PASS: 3
- FAIL: 0
- Security-кейсы: неприменимы к этому диффу (не код, не API), нарушений не найдено
- `npm test` (282/282 файлов, 3946/3946 тестов), `tsc --noEmit` — чисто
- JSON независимо распарсен (`node -e "JSON.parse(...)"`) — валиден
- Все 5 фактических якорей в новом тексте (`e2e/*.spec.ts`, `npm run e2e`, имя CI-job'ы, файл
  workflow'а, номер issue #592) сверены напрямую с кодом/git-историей, ни один не выдуман
- Формулировка синхронизирована с уже одобренным текстом в `docs/mcp-servers.md` (issue #574) —
  устраняет ранее отмеченный разрыв между двумя источниками истины

**Вердикт: PASS.** Диф хирургический (1 файл, 1 поле, 1 insertion/1 deletion), в точности
соответствует формулировке из issue #628. `.mcp.json` остаётся валидным JSON — подтверждено
независимым парсером, а не доверием к заявлению code-reviewer'а. Каждая фактическая ссылка в
новом тексте (пути, команда, имя CI-job'ы, номер issue) проверена против реального кода и
git-истории и оказалась верной. Скоуп-крипа нет. Security-кейсы неприменимы и не нарушены.
Регрессий нет. Замечаний нет.
