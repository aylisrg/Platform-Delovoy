# QA Report: #534 — прогнать escapeHtml по parse_mode:"HTML" в bot/ (продолжение #471)

## Вердикт: PASS

---

## Источник правды

Issue #534 (P1, security, label `auto:wip`), полный текст получен через `curl` к
`api.github.com` (`gh` недоступен в окружении). Прямое продолжение #471, scoped
на `bot/` (отдельный Grammy-процесс, вне скоупа Next.js `src/`). Проверены
коммиты `c432449` (round 1) + `bde611f` (round 2), ветка
`claude/issue-534-bot-escapehtml`. `code-reviewer` дал PASS после 2 раундов —
эта проверка независимая (acceptance-верификация, не повтор код-ревью).

Acceptance criteria из тела issue («Что сделать»):
1. Пройти все `parse_mode: "HTML"` в `bot/` (issue перечисляет 8 файлов) — для каждой интерполяции: экранирована или доказуемо безопасна.
2. Импортировать канонический `escapeHtml` из `src/lib/telegram/escape.ts`, без новой локальной копии.
3. Тесты по образцу #471.

## AC — по пунктам

| # | AC | Статус | Доказательство |
|---|----|--------|-----------------|
| 1 | Все `parse_mode:"HTML"` в `bot/` закрыты | PASS | См. «Item 1 — независимый обход» ниже. |
| 2 | Канонический `escapeHtml`, без дублей | PASS | `grep -rn "function escapeHtml" bot/` → 0 хитов; единственная реализация в репозитории — `src/lib/telegram/escape.ts:17` (`grep -rln "function escapeHtml" src bot` → 1 файл). |
| 3 | Тесты по образцу #471 | PASS | См. «Item 3 — сопоставление ригора» ниже. |

### Item 1 — независимый обход `parse_mode` в `bot/`

Собственный (не доверяя описанию задачи) `grep -rn "parse_mode" bot/` по всем `.ts`-файлам (не только 8 из issue), минус тесты, даёт 7 продакшн-файлов: `cafe.ts`, `gazebos.ts`, `my-bookings.ts`, `ps-park.ts`, `welcome.ts`, `link.ts`, `index.ts`. Плюс проверены отдельно `team-settings.ts` и `unknown.ts` (входят в список issue, но не попали в grep выше на этот раз, т.к. их `parse_mode`-вызовы отдаются статическим текстом) — прочитаны целиком:

- `team-settings.ts:settingsText()` — строка полностью литеральная, никакой интерполяции.
- `unknown.ts:UNKNOWN_INPUT_TEXT` — та же картина, полностью статический текст.

Все 7 продакшн-файлов из фактического grep — интерполяции обёрнуты в `escapeHtml(...)` (подтверждено чтением каждого построчно): `cafe.ts` (`category`/`item.name`/`item.description`), `gazebos.ts`/`ps-park.ts` (`resource.name`), `my-bookings.ts` (`resourceName`), `welcome.ts` (`firstName`), `link.ts` (`userName`), `index.ts` (`sendAlert`'s `source`/`message`/`details`).

Проверен потенциальный «10-й вектор» отдельно: `bot/handlers/alerts.ts` (не путать с `bot/index.ts`) не содержит `parse_mode` — это чистый роутер уровней (`routeAlert`), который лишь вызывает уже пропатченный `sendAlert` из `index.ts`; `bot/handlers/auth-deeplink.ts`, `bot/lib/api.ts`, `bot/lib/bot-login.ts`, `bot/keyboards/gazebos.ts` — ни одного `parse_mode` не найдено. Новых незакрытых мест сверх уже найденных двумя раундами не обнаружено.

### Item 2 — `welcome.ts` first_name: трассировка reachability

Прочитан `bot/index.ts:130-212` (обработчик `/start`) целиком. Путь до строки 208 (`buildWelcomeText(ctx.from?.first_name, isReturning)`) не проходит ни через один auth/role-гейт: единственные ветвления выше — на deep-link префиксы (`AUTH_DEEPLINK_PREFIX`, `link_`, `gazebos`, `ps-park`/`ps`, `webapp`), после которых идёт `return`; ветка по умолчанию (обычный `/start` без параметров) достижима любым пользователем Telegram без какой-либо авторизации. `ctx.from?.first_name` — поле объекта `from`, которое Grammy заполняет из `Update.message.from`, присланного самим Telegram API на основе профиля отправителя; это имя полностью управляется владельцем аккаунта (может быть переименован в `<script>...</script>` через настройки Telegram) и не проходит никакой санитизации на стороне Telegram. `buildWelcomeText` (`bot/handlers/welcome.ts:41`) оборачивает его в `escapeHtml(firstName?.trim() || "друг")` до подстановки в текст, который уходит с `parse_mode:"HTML"` (`index.ts:209`). Вектор подтверждён как реальный и максимально широкодоступный (любой пользователь Telegram, ноль привилегий) — заявленная в PR серьёзность соответствует действительности.

### Item 3 — сопоставление ригора тестов с #471

Прочитаны все 7 новых/расширенных тестовых файлов (`bot/__tests__/alerts.test.ts`, `bot/__tests__/welcome.test.ts` (расширение), `bot/handlers/__tests__/{cafe,gazebos,link,my-bookings,ps-park}.test.ts`). Во всех случаях — конкретный HTML/script-инъекционный payload (`<b>evil</b>`, `<script>alert(1)</script>`, `<img src=x onerror=...>`-класс) и парный ассерт `toContain("&lt;...&gt;")` + `not.toContain("<...>")`, идентично паттерну `src/modules/inventory/__tests__/notifications.test.ts` из #471 (см. `docs/qa-reports/2026-08-14-issue-471-escapehtml-consolidate-qa-report.md`, раздел «Ре-верификация раунда 3», п.2). Round 2 закрыл единственный пробел, который был бы отклонением от ригора #471 — отсутствие тестов на 4 из 7 фиксов; теперь 7/7 покрыты. Дополнительно 4 новых теста (`cafe`, `gazebos`, `ps-park`, `my-bookings`) используют `collectHandlers()` fake-bot паттерн, независимо подтверждённый существовавшим до этого PR прецедентом (`team-settings.test.ts`, коммит `ef23b24`, #517) — не новодел «под тест», а переиспользование устоявшегося подхода. Ригор соответствует #471, пробелов не осталось.

## Независимая верификация (технические пункты задания)

1. **`npx tsc --noEmit`** — чисто, exit 0 (примечание: `bot/` исключён из `tsc` в `tsconfig.json`, но проверка гарантирует отсутствие регрессий в `src/`).
2. **`npx vitest run bot/`** — `13 passed (13)` файлов, `79 passed (79)` тестов.
3. **`npm test -- --run`** (полный прогон) — `Test Files 247 passed (247)`, `Tests 3569 passed (3569)`.
4. **`npm run lint`** — `0 errors`, 16 pre-existing warnings, ни один не в `bot/` или в файлах диффа этого PR (те же 16, что фигурировали в отчёте #471 — `messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`, `modules/messenger/types.ts`).
5. **`grep -rn "function escapeHtml" bot/`** — 0 хитов, лично проверено.
6. **Runtime-резолвинг `@/lib/telegram/escape`** — issue предлагал относительный импорт (`../src/lib/telegram/escape`) для всех 8 файлов; фактически 6 из 7 файлов (`cafe.ts`, `welcome.ts`, `link.ts`, `gazebos.ts`, `my-bookings.ts`, `ps-park.ts`) используют алиас `@/lib/telegram/escape`, и только `index.ts` — относительный путь (следуя стилю остальных импортов того же файла: `../src/lib/db`, `../src/lib/logger`). Это отклонение от буквальной формулировки issue, но не от её цели («канонический хелпер, без дублей»). Независимо проверено: (а) `@/lib/db`-алиас в `bot/` — не новодел этого PR, использовался в `team-settings.ts` уже в коммите `ef23b24` (#517, до #534); (б) реальный runtime-резолвинг подтверждён напрямую — `npx tsx -e "import('./bot/handlers/cafe.ts')..."` из корня репозитория (тот же cwd, что и продакшн-команда `npx tsx bot/index.ts` в `docker-compose.yml:90-94`) успешно загрузил модуль и вызвал `escapeHtml` без ошибок резолва. Не декларативная, а фактически исполненная проверка.
7. **Расположение тестовых файлов** — `bot/__tests__/` содержит тесты для файлов из корня `bot/` (`index.ts` → `alerts.test.ts`, `index-wiring.test.ts`) плюс два pre-existing исключения (`welcome.test.ts`, `unknown.test.ts` — тестируют `bot/handlers/*.ts`, но лежат в `bot/__tests__/` до этого PR); `bot/handlers/__tests__/` содержит тесты остальных `bot/handlers/*.ts`. Новые файлы этого PR (`cafe.test.ts`, `gazebos.test.ts`, `link.test.ts`, `ps-park.test.ts`) корректно легли в `bot/handlers/__tests__/` рядом с тестируемым хендлером; `alerts.test.ts` (новый, тестирует `sendAlert` из `index.ts`) корректно лёг в `bot/__tests__/`. Расширение существующих `welcome.test.ts`/`my-bookings.test.ts` не меняло расположение — соответствует конвенции.

## Независимый мутационный тест (новый вектор, не повторяющий раунды 1–2)

Оба раунда уже провели мутационное тестирование каждого из 7 фиксов методом полного отката экранирования (реверт `escapeHtml(...)` → сырое значение). Для независимой проверки выбран другой угол — **частичная регрессия** (не весь файл лишается экранирования, а только одно поле из нескольких в одном файле), которую предыдущие раунды не пробовали:

- В `bot/handlers/cafe.ts` временно заменена строка `` `☕ <b>${escapeHtml(category)}</b>\n\n` `` на `` `☕ <b>${category}</b>\n\n` ``, оставив `item.name`/`item.description` экранированными.
- `npx vitest run bot/handlers/__tests__/cafe.test.ts` → **1 failed**, тест `экранирует category/name/description перед подстановкой в HTML` упал именно на ассерте `toContain("&lt;i&gt;Напитки&lt;/i&gt;")` — тест ловит регрессию даже в одном конкретном поле среди нескольких, а не только полный откат.
- Мутация откачена (`cp` бэкапа), `git diff --stat bot/handlers/cafe.ts` → пусто, тест снова зелёный (`1 passed`). Рабочее дерево чистое (`git status --porcelain` → пусто) на момент завершения проверки.

## Security (обязательные функциональные кейсы, `agents/qa.md`)

- **Input validation / injection (основной кейс этого issue):** PASS — все 7 продакшн-файлов с `parse_mode:"HTML"` в `bot/` экранируют пользовательский/внешний ввод перед подстановкой; независимо подтверждено чтением, трассировкой reachability для самого severe вектора (`welcome.ts`) и собственным мутационным тестом на новом угле.
- **RBAC:** новых endpoint'ов/команд фикс не создаёт; `/start` как был доступен анонимно любому Telegram-пользователю (по дизайну бота), так и остаётся — экранирование не меняет модель доступа.
- **Data leakage:** `git diff main...HEAD -- bot/ | grep -iE "password|token|secret"` → чисто.
- **Rate limiting:** вне скоупа фикса, не затронуто.

## Регрессия

- `npm test -- --run` — 247/247 файлов, 3569/3569 тестов, включая весь остальной репозиторий (Next.js `src/`), не только `bot/`.
- `npx tsc --noEmit` — чисто.
- `npm run lint` — 0 errors, warnings те же pre-existing 16, вне диффа.
- Рабочее дерево чистое после всех временных проверок (мутационный тест + резолв-скрипт в scratchpad, не в репозитории).

## Итог

Все 3 пункта «Что сделать» из issue #534 закрыты и независимо перепроверены: (1) сплошной обход `parse_mode` в `bot/` — 7 продакшн-файлов с интерполяциями закрыты, 2 файла (`team-settings.ts`, `unknown.ts`) корректно не тронуты (только статический текст), десятого вектора не найдено; (2) единственная реализация `escapeHtml`, импортируемая из канонического `src/lib/telegram/escape.ts` (алиас `@/` подтверждён рабочим в runtime через `tsx`, тот же способ запуска, что и в проде); (3) тестовое покрытие 7/7 фиксов, ригор соответствует #471 (конкретные exploit-payload'ы, парные `toContain`/`not.toContain`). Наиболее серьёзный вектор (`welcome.ts`, `ctx.from?.first_name`, достижим любым пользователем Telegram без авторизации) независимо прослежен и подтверждён. Собственный мутационный тест на независимом угле (частичная регрессия одного поля) подтвердил, что тесты действительно ловят регрессию, а не просто не падают. `npm test`, `npx tsc --noEmit`, `npm run lint` — все зелёные. Security-кейс «input validation / injection» — PASS, блокирующих проблем не найдено.

**Вердикт: PASS**
