# QA-отчёт: issue #573 — watchdog автономии (liveness AUTOMATION_TOKEN + дайджест needs-owner)

**Ветка:** `claude/issue-573-queue-watchdog` (1 коммит `6d89b188` поверх merge-base `35e2bf12`, origin/main с тех пор ушёл на 1 несвязанный коммит `c5acfbb5` — Playwright E2E job #592, не влияет на скоуп этой проверки).

**Reviewer:** PASS (не пересказываю, верифицировано независимо ниже).

---

## 1. Diff — независимый просмотр

`git log -1 -p 6d89b188` — 4 файла, 418 insertions(+), 0 deletions:
- `scripts/lib/queue-watch.ts` (новый, 92 строки) — чистые функции `isTokenDead`, `shouldRemindRotation`, `buildNeedsOwnerDigest` + маркеры.
- `scripts/lib/__tests__/queue-watch.test.ts` (новый, 128 строк, 14 тестов).
- `scripts/issue-queue.ts` — команда `ops-watch`, хелперы `needsOwnerLabeledAt`, `checkTokenStatus`, `escapeHtml`.
- `.github/workflows/issue-queue.yml` — 3 новых шага (`id: ops` + два Telegram-шага).

Соответствует описанию issue #573 дословно.

## 2. Юнит-тесты — свои и существующие

`npx vitest run scripts/lib/__tests__/queue-watch.test.ts` → **14/14 passed**.

Разобрал покрытие веток по AC:
- мок 401 (`isTokenDead(401) === true`) — есть, плюс 403/500/301 живые.
- дедуп дайджеста (интервал не пройден → `send:false`, пройден → `send:true`) — есть.
- пустой список → `send:false` — есть.
- повтор после интервала (24ч/29д/30д/31д) — есть, включая границу "ровно 30 дней".

Написал и прогнал **свой** временный файл тестов (`scripts/lib/__tests__/qa-573-edge-QATEMP.test.ts`, удалён после прогона, не коммитился) с кейсами, которых не было в исходном наборе:
- `isTokenDead`: границы 199/200/299/300, а также `0` (сетевой сбой) — все корректны.
- `isTokenDead(NaN)` — **обнаружил реальную дыру в чистоте функции**: `NaN < 200` и `NaN >= 300` оба `false`, значит `isTokenDead(NaN)` возвращает `false` ("жив"), хотя ожидалось `true`. См. раздел «Находки» ниже — не блокер, но задокументировал причину.
- `shouldRemindRotation` с `lastReminderAt` в будущем (рассинхрон часов) — не падает, корректно возвращает `false` (не спамит).
- `shouldRemindRotation` с некорректной датной строкой — `NaN`-сравнение молча даёт `false`, не кидает исключение.
- `buildNeedsOwnerDigest` на точной границе `minAgeHours` — 48.00ч включается (`>=`), 47.99ч — нет. Поведение соответствует объявленному контракту `>=`.
- `buildNeedsOwnerDigest` с `lastDigestAt` в будущем — корректно подавляет отправку (не даёт ложного повторного дайджеста).
- Пустой список PR при "протухшем" `lastDigestAt` — по-прежнему `send:false` (пустой список не отправляет, независимо от дедупа).

Итог: 15/16 моих кейсов прошли как ожидалось; один (`NaN`) выявил не 100%-чистоту функции, см. ниже — не расценил как блокер, обоснование там же.

## 3. `ops-watch --dry-run` против реального репозитория

```
$ npx tsx scripts/issue-queue.ts ops-watch --dry-run
{
  "token": { "checked": false, "reason": "AUTOMATION_TOKEN не задан" },
  "digest": { "send": false, "stalePrs": [], "reason": "нет needs-owner PR старше порога" }
}
```

Корректно: секрет не задан в этой сессии → не поднимает ложную тревогу (правильно отличает «токена нет» от «токен мёртв», как и задумано в CLAUDE.md).

Проверил дашборд-issue `#462` («📋 Автоочередь разгрузки бэклога — состояние») через `scripts/lib/gh-api.ts` (тот же прокси, что описан в контексте задачи): 3 комментария, все — старые `<!-- issue-queue-heartbeat -->`. **Ни одного нового комментария с `TOKEN_ROTATION_MARKER`/`NEEDS_OWNER_DIGEST_MARKER` после прогона не появилось** — `--dry-run` не постит на GitHub, подтверждено фактическим состоянием issue, а не только чтением кода.

## 4. Скоуп диффа — жёсткое требование AC

```
$ git diff origin/main...HEAD -- scripts/lib/issue-queue.ts .github/issue-queue.json
(пусто)
```

Подтверждено — оба файла нетронуты. `git diff origin/main...HEAD --stat` — ровно 4 файла (список выше), без побочных правок.

## 5. `.github/workflows/issue-queue.yml`

`python3 -c "import yaml; yaml.safe_load(...)"` — парсится без ошибок.

Логика шагов вручную прослежена:
- `id: ops` пишет `token_alert`, `token_status`, `digest_send`, `digest_text` в `$GITHUB_OUTPUT`.
- `if: steps.ops.outputs.token_alert == 'true'` и `if: steps.ops.outputs.digest_send == 'true'` — id `ops` совпадает с id шага, ссылки корректны.
- Multiline-heredoc для `digest_text` (`<<QUEUEWATCH_EOF ... QUEUEWATCH_EOF`) — синтаксис `$GITHUB_OUTPUT` соблюдён.
- `escapeHtml` в `queue-watch`-пути применяется к заголовкам PR перед вставкой в `<b>` для Telegram HTML — экранирует именно `&`, `<`, `>`, что достаточно для Telegram `parse_mode: HTML` (кавычки вне атрибутов не требуют экранирования — контекст здесь исключительно текстовый, не атрибутный). Plain-текст версия для GitHub-комментария (`digestText`) намеренно не экранирована — это markdown-комментарий, а не HTML-синк, корректно.
- Секрет `AUTOMATION_TOKEN` в `checkTokenStatus()` передаётся через `execFileSync` argv (`-H "Authorization: Bearer ${token}"`), не через шелл-интерполяцию — паттерн идентичен уже существующему `ghApi()` в `scripts/lib/gh-api.ts`. Сам токен в `ops.json`/логи не попадает (`result.token` содержит только `checked/dead/status`, не значение).

## 6. `npm test`, `npx tsc --noEmit`, `npm run lint`

- `npm test -- --run` → **256 test files / 3640 tests passed**, регрессий нет.
- `npx tsc --noEmit` (корневой) → чисто, но **`scripts/` исключён из `tsconfig.json`** (`"exclude": ["node_modules", "scripts", "bot", ...]`) — формально не типчекает новые файлы. Прогнал вручную с временным `tsconfig` (`target/lib: ES2022`, чтобы совпасть с эффективными настройками проекта — корневой `tsconfig` использует `lib: ["esnext"]`) через `-p`, отфильтровав вывод на 3 целевых файла (`scripts/issue-queue.ts`, `scripts/lib/queue-watch.ts`, `scripts/lib/__tests__/queue-watch.test.ts`) — **0 ошибок** в этих файлах. (С ES2020-lib по умолчанию всплывали ложные `.at()`-ошибки на *существующих*, не относящихся к PR строках 984/1009 — артефакт моего temp-конфига, не проекта; при ES2022-lib исчезли.) Прочий шум от `tsc -p` (десятки ошибок в старых одноразовых скриптах типа `update-pspark-prices.ts`, `bot/*`) — существующий технический долг вне скоупа этого PR, не потрогано этим коммитом.
- `npm run lint` → 0 errors, 16 warnings — все в несвязанных файлах (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`), ни одного в файлах этого PR.

## 7. Commit message

`feat(queue): watchdog автономии — liveness AUTOMATION_TOKEN + суточный дайджест needs-owner` — conventional commits, тело объясняет мотивацию (SPOF B2/B3), решения по дизайну, ограничение песочницы, `Closes #573`, `Co-Authored-By` — соответствует конвенции репозитория (сверено с соседними коммитами в `git log`).

## 8. «Без кулдауна на token-dead алерт» — независимая проверка обоснования

Проверил прецедент `site-watchdog.yml` сам: `notify-site-down`/`notify-notifications-down` шлют Telegram-сообщение (`curl ... sendMessage`) на **каждом** прогоне (cron `*/5 * * * *`), пока сайт лежит — дедуп там только на уровне GitHub issue (комментарий вместо нового issue), не на уровне самого Telegram-алерта. Это ровно то же обоснование, что в commit message. Своё согласие подтверждаю — паттерн действительно уже существует в проекте, не выдумка задним числом.

## 9. Находки (не блокеры, для трекинга)

1. **`isTokenDead(NaN)` возвращает `false` вместо `true`.** Проверил дотягивается ли это до продакшна: `checkTokenStatus()` вызывает `curl -w '%{http_code}'` через `execFileSync`; сам проверил эмпирически (`curl` на несуществующий домен через этот же прокси) — при сетевом сбое curl завершается с ненулевым exit-кодом (`56` в моём тесте), из-за чего `execFileSync` бросает исключение **до** того, как `Number(out.trim())` вообще мог бы получить нечисловую строку. Верхнеуровневый `try/catch` в `issue-queue.ts` ловит это, печатает ошибку и делает `process.exitCode = 1` — то есть весь шаг `ops-watch` в workflow упадёт красным (шаг `id: ops` без `continue-on-error`, в отличие от двух Telegram-шагов ниже), и в этом случае Telegram-алерта **не будет** — рабочий процесс просто зафейлится тихо в Actions-логе. Это отдельный failure mode от «токен реально мёртв» (HTTP 401, который curl отдаёт с exit 0 и корректно триггерит алерт) — сетевой сбой при обращении к api.github.com. Не противоречит заявленному AC (который требует конкретно мок 401), совпадает по риск-профилю с уже существующим `heartbeat`-шагом (тот тоже без `continue-on-error`) — не новый регресс, а существующий паттерн в этом workflow. Рекомендую отдельным тикетом: обернуть `checkTokenStatus` в try/catch с явным «не удалось проверить» статусом вместо падения всего шага, но это улучшение, не блокер AC #573.
2. Стилистика: в шаге «Telegram — needs-owner digest» весь текст дайджеста (все строки со списком PR) обёрнут в один `<b>...</b>` — визуально жирным будет весь список, а не только заголовок. Косметика, не функциональный баг.

Обе находки не относятся ни к одному из заявленных acceptance criteria и не создают security- или data-loss-риска — не понижают вердикт.

## Acceptance criteria — по одному

| # | AC | Результат |
|---|----|-----------|
| 1 | Невалидный токен → Telegram-алерт на ближайшем часовом прогоне (юнит: мок 401) | **PASS** — `isTokenDead(401)===true` подтверждено юнит-тестом; wiring `token_alert` → `if:` в workflow прослежен и корректен |
| 2 | Дайджест needs-owner — не чаще раза в сутки, только при непустом списке, дедуп маркером | **PASS** — покрыто тестами (свои + существующие), маркер `NEEDS_OWNER_DIGEST_MARKER` подтверждён в коде и логике дедупа |
| 3 | `scripts/lib/issue-queue.ts` и `.github/issue-queue.json` не изменены | **PASS** — `git diff origin/main...HEAD -- ...` пуст |
| 4 | PR уйдёт в `hold` (правит `issue-queue.yml`, файл из HOLD_PATTERNS) | **PASS** — `HOLD_PATTERNS` в `scripts/lib/issue-queue.ts` содержит `^\.github\/workflows\/issue-queue\.yml$` и `^scripts\/issue-queue\.ts$`, оба файла PR их триггерят; открытого PR на момент проверки на GitHub не найдено (`pulls?head=...` — пусто), логика гейта проверена по коду, детерминированно даст `hold` |

## Security-чеклист (функциональный, применительно к infra-скрипту)

- RBAC/rate limiting/data leakage в классическом API-смысле не применимы — это CI-скрипт без публичного API.
- Секрет `AUTOMATION_TOKEN` не попадает в вывод/логи (`result.token` — только статус, не значение) — проверено чтением кода.
- HTML-инъекция в Telegram-сообщение через заголовок PR — предотвращена `escapeHtml`, проверено вручную (только текстовый контекст `<b>`, не атрибуты — экранирования `&/</>` достаточно).
- Ничего не постится на GitHub при `--dry-run` — подтверждено фактическим состоянием дашборд-issue #462 до/после прогона.

## Регрессия

`npm test -- --run` — 256/256 файлов, 3640/3640 тестов зелёные.

---

## Вердикт: PASS

Все 4 acceptance criteria issue #573 подтверждены независимыми прогонами (не пересказ отчёта Reviewer'а): юнит-тесты (существующие + мои дополнительные edge-кейсы), реальный `ops-watch --dry-run` против живого репозитория с проверкой отсутствия побочных комментариев на GitHub, пустой `git diff` по защищённым файлам, синтаксически валидный и логически прослеженный workflow YAML, зелёные `npm test`/lint, вручную протипчеканные новые файлы (root `tsc` их не покрывает). Две находки (`isTokenDead(NaN)`, косметика Telegram-форматирования) задокументированы для трекинга, но не относятся к заявленным AC и не создают security/data-loss риска — не блокируют PASS.
