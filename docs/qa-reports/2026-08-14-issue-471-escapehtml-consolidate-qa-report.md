# QA Report: #471 — собрать все escapeHtml-копии в `src/lib/telegram/escape.ts` и прогнать по всем `parse_mode:"HTML"` вызовам

## Вердикт: FAIL

## Источник правды

Issue #471 (P1, security, label `bug`), полный текст получен через GitHub API
(`gh` недоступен в окружении — использован `curl` к `api.github.com` с
`GITHUB_TOKEN`, см. тело issue ниже). Нет отдельного PRD — tech-debt/security
issue из бэклога, расширенный после код-ревью #428.

Acceptance criteria из тела issue:
1. Пройти все файлы с `parse_mode`, найти неэкранированные интерполяции, закрыть через `@/lib/telegram/escape`.
2. Заменить семь локальных объявлений `escapeHtml` импортом, дубликаты удалить.
3. `grep -rn "function escapeHtml" src/` находит одно объявление.
4. Для каждого `parse_mode: "HTML"` в репозитории интерполируемые значения либо экранированы, либо не могут содержать спецсимволы.
5. `npm test` зелёный.

Проверенные коммиты: `69d3ff5` (round 1) + `4e40d60` (round 2), ветка
`claude/issue-471-escapehtml-consolidate`. Reviewer дал финальный PASS после
двух раундов — эта проверка независимая (не повтор ревью кода, а
функциональная/acceptance-верификация).

## AC — по пунктам

| # | AC | Статус | Доказательство |
|---|----|--------|-----------------|
| 1 | Единственная реализация `escapeHtml` в кодовой базе | PASS | `grep -rn "function escapeHtml" src bot` → ровно один хит: `src/lib/telegram/escape.ts:17`. |
| 2 | 7 локальных копий заменены импортом, дубликаты удалены | PASS | Прочитан `git show 69d3ff5` целиком по всем 7 файлам (`test-message.ts`, `avito/reviews.ts`, `dispatch/channels/telegram.ts`, `module-channel.ts`, `feedback/telegram.ts`, `rental/scheduler.ts`, `backups/notify.ts`) — каждый теряет свою локальную `function escapeHtml` и получает `import { escapeHtml } from "@/lib/telegram/escape"` (или относительный `"./escape"`). Никакого мёртвого кода не осталось — `grep -rln "escapeHtml"` показывает только реальные call-сайты. |
| 3 | Все ранее неэкранированные call-сайты из issue закрыты | PASS для перечисленных в issue сайтов (`ps-park/settings/test`, `waitlist`, `gazebos/settings/test`, `admin/telegram/test`, `admin/telegram/test-owner`, `admin/notifications/routing/test`, `inventory/alerts.ts`), **плюс** `notifications/templates.ts` (round 2, включая самый серьёзный публичный вектор — `rental`/`rental-inquiry` `inquiry.created`, доступный анонимно через `POST /api/rental/inquiries` и `POST /api/nedelovoy/inquiries`). Прочитан весь диапазон интерполяций в `templates.ts` — каждое `${d.xxx}` обёрнуто в `e(...)`. | Round 2 diff + чтение `src/modules/notifications/templates.ts` целиком. |
| 4 | **Для каждого `parse_mode:"HTML"`/HTML-канала интерполяция экранирована или доказуемо безопасна — по всей кодовой базе, не только по перечисленным в issue местам** | **FAIL** | См. «Найденный баг» ниже: `src/modules/inventory/notifications.ts` строит HTML-сообщения (`buildReceiptCreatedMessage`, `buildReceiptProblemMessage`, `buildReceiptConfirmedMessage`, `buildReceiptCorrectedMessage`) с неэкранированными `${data.managerName}`/`${data.adminName}`/`${data.problemNote}` и отправляет их через `telegramAdapter.send(...)`, который **всегда** ставит `parse_mode: "HTML"` (`src/modules/notifications/channels/telegram.ts:20`). Этот файл не был затронут ни одним из двух коммитов и не содержит буквальной строки `parse_mode` — тот же класс промаха, который round 2 уже один раз ловил на `templates.ts`, но здесь пропущен. |
| 5 | `npm test` зелёный | PASS | `npm test -- --run` → 239/239 файлов, 3544/3544 тестов passed (см. ниже). |

## Найденный баг (блокирует PASS)

### BUG: Неэкранированные `managerName`/`adminName`/`problemNote` в Telegram-уведомлениях модуля `inventory`

**Серьёзность:** Major (тот же класс уязвимости, что и главный фикс issue #471 — HTML/markup-инъекция в `parse_mode:"HTML"` Telegram-сообщение; в отличие от заявки на аренду не анонимный, но доступен любому MANAGER с доступом к модулю inventory, что ровно совпадает с формулировкой угрозы из самого issue: «в мультиадминной установке один менеджер может подставить разметку в сообщение, которое читает другой»).

**Модуль:** inventory

**Шаги для воспроизведения:**
1. Авторизоваться пользователем с ролью MANAGER, назначенным на модуль `inventory` (или `cafe`/`ps-park`, у которых есть inventory-доступ).
2. `PATCH /api/profile` (или соответствующий endpoint смены имени, схема `updateNameSchema` в `src/modules/profile/validation.ts` — только `min(2).max(100)`, без ограничения на HTML-метасимволы) → сменить `name` на `<b>Хакер</b><a href="https://evil.example">клик</a>`.
3. Создать приход товара (или подтвердить/скорректировать приход) — вызывается `buildReceiptCreatedMessage({ managerName: performer?.name, ... })` (`src/modules/inventory/service-v2.ts:157-158`).
4. Либо: `POST /api/inventory/receipts-v2/[id]/problem` с телом `{ "problemNote": "<a href=\"https://evil.example\">click</a> текст проблемы длиной от 10 символов" }` (валидация `flagProblemSchema` — только `min(10).max(2000)`, никакой санитизации) → вызывается `buildReceiptProblemMessage({ managerName, problemNote, ... })` (`service-v2.ts:311-321`).
5. Сообщение уходит через `notifyModuleAdmins(...)` → `telegramAdapter.send(admin.telegramId, message, ...)` → Telegram API с `parse_mode: "HTML"` (`src/modules/notifications/channels/telegram.ts:12-22`).

**Ожидаемый результат:** `<`, `&`, `>` в `managerName`/`adminName`/`problemNote` экранированы (`&lt;`, `&amp;`, `&gt;`) до попадания в текст сообщения — как это теперь сделано во всех остальных перечисленных в issue местах.

**Фактический результат:** `src/modules/inventory/notifications.ts:98-154` (`buildReceiptCreatedMessage`, `buildReceiptConfirmedMessage`, `buildReceiptProblemMessage`, `buildReceiptCorrectedMessage`) интерполирует `data.managerName`, `data.adminName`, `data.problemNote`, `data.receivedAt`, `data.totalAmount`, `data.itemCount` без `escapeHtml` напрямую в HTML-разметку (`` `Менеджер: <b>${data.managerName}</b>` `` и т. п.). Файл не импортирует `escapeHtml` и не был затронут ни одним из двух коммитов фикса. Никакой другой уровень системы (Zod-схема `flagProblemSchema`, схема `updateNameSchema` для имени пользователя) не ограничивает содержимое этих полей символами, безопасными для HTML.

**Окружение:**
- API endpoint: `POST /api/inventory/receipts-v2/[id]/problem` (роль MANAGER/ADMIN/SUPERADMIN с правом `canFlagProblem`), а также любой путь создания/подтверждения/коррекции прихода в `service-v2.ts`, где `performer?.name`/`confirmer?.name`/`reporter?.name`/`corrector?.name` берутся из `prisma.user.findUnique(...).name` без санитизации.
- Роль пользователя: MANAGER (или ADMIN/SUPERADMIN), назначенный на модуль с inventory-доступом.
- Данные запроса: `{ "problemNote": "<a href=\"...\">...</a> ..." }` (10–2000 символов, только длина валидируется) или произвольное `User.name`.

**Почему это входит в скоуп #471, а не отдельная задача:** issue формулирует критерий готовности как «для каждого `parse_mode: "HTML"` в репозитории интерполируемые значения либо экранированы, либо не могут содержать спецсимволы» — без ограничения «только там, где буквально написано `parse_mode`». Round 2 коммит (`4e40d60`) существует именно потому, что `templates.ts` не содержит буквальной строки `parse_mode` (она выставляется на уровень выше, в канале), и это было explicitly признано пропуском round 1. `src/modules/inventory/notifications.ts` — структурно идентичный случай (constructs message text, `parse_mode:"HTML"` выставляется в канале-получателе на уровень ниже), просто не пойманный тем же грепом по буквальной строке `parse_mode`.

## Независимая верификация (тех. пункты задания)

1. **`npx tsc --noEmit`** — чисто, exit 0, без вывода.
2. **`npm test -- --run`** — `Test Files 239 passed (239)`, `Tests 3544 passed (3544)`.
3. **`npm run lint`** — `0 errors`, 16 pre-existing warnings, все вне файлов, изменённых этим PR (`messenger/ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts` — не тронут этим PR, подтверждено `git log -- src/modules/notifications/service.ts` последним коммитом `ef23b24`, не связан с #471, `telephony/novofon-client.ts`).
4. **`grep -rn "function escapeHtml" src bot`** — ровно один хит (`src/lib/telegram/escape.ts:17`), подтверждено лично, не только со слов review.
5. **Трассировка `renderAdminMessage("rental-inquiry", "inquiry.created", {...})`** — прочитан `templates.ts:111-114`: `` `<b>🏢 Новая заявка на офис!</b>\n\nИмя: ${e(d.name)}\nТелефон: ${e(d.phone)}\nEmail: ${e(d.email)}\nКомпания: ${e(d.companyName)}\nОфис: ${e(d.officeNumber)}\n\nСообщение: ${e(d.message)}` ``. Для `d.name = "<b>Хакер</b>"` результат содержит `&lt;b&gt;Хакер&lt;/b&gt;`, литеральный `<b>🏢 Новая заявка на офис!</b>` (заголовок шаблона, не обёрнут в `e()`) остаётся нетронутым тегом. Совпадает с тестом `src/modules/notifications/__tests__/templates.test.ts:102-115` — тест подтверждён чтением, не только запуском.
6. **Проверка отсутствия двойного экранирования структурных тегов** — во всех шаблонах `adminTemplates`/`clientTemplates`/`paymentAdminTemplates` литеральные `<b>`, `<i>` вокруг статичного текста (например, `` `<b>Новое бронирование!</b>` `` в `adminTemplates.gazebos["booking.created"]`) не обёрнуты в `e(...)`, тогда как соседние `${e(d.resourceName)}`, `${e(d.userName)}` — обёрнуты. Прочитано построчно по всему файлу `templates.ts` (115 строк) — расхождений не найдено.
7. **Тестовое покрытие фикса** — по каждому исправленному в round 1 call-сайту (`waitlist`, `gazebos/settings/test`, `ps-park/settings/test`, `admin/telegram/test`, `admin/telegram/test-owner`, `admin/notifications/routing/test`, `inventory/alerts.ts`) прочитан добавленный тест: все проверяют не только «не падает», а **конкретно** `expect(text).toContain("&lt;...&gt;")` + `expect(text).not.toContain("<...>")` на злонамеренном payload (`<a href="evil">`, `<script>`, `<b>bad</b>` и т.п.) — адекватно. Аналогично 5 новых тестов в `templates.test.ts` (round 2) — проверяют экранированный вывод и отсутствие сырого HTML для `rental["inquiry.created"]`, `rental-inquiry["inquiry.created"]`, `gazebos["booking.created"].userName`, `payment.succeeded.description`.
8. **Полный обход файлов с `parse_mode`** — `grep -rl "parse_mode" src bot`, минус тесты → 25 файлов (bot/ вынесен в отдельный issue #534, явно указано в commit message round 1 — корректно, т.к. `bot/` вне `src/`, отдельный Grammy-процесс, issue формулировал скоуп только про `src/`). Из оставшихся не-`bot/` файлов лично проверены все, не входившие в диф: `session-ending-alert/route.ts` (уже безопасен, предшествующий фикс), `admin/notifications/channel-test/route.ts` → `buildChannelTestMessage` из `test-message.ts` (экранирует, часть round 1 diff), `providers-status/route.ts` (сообщение из статичных строк, без пользовательского ввода — безопасно). Дополнительно проверены все не-`parse_mode`-грепящиеся, но фактически HTML-каналы: `notifications/service.ts` (использует `renderClientMessage`/`renderAdminMessage` — фикс round 2 покрывает), `notifications/channels/telegram.ts` (легаси-адаптер, `message` — параметр, экранирование обязано быть на стороне вызывающего) → его единственный вызывающий, `src/modules/inventory/notifications.ts`, **не экранирует** — см. баг выше.

## Регрессия / побочные проверки

- Никаких изменений `package.json`/миграций/RBAC-эндпоинтов — фикс чисто в построении текста сообщений, `git diff main...HEAD --stat` подтверждает: только `route.ts`/`service.ts`/`__tests__` файлы notifications-инфраструктуры.
- Литеральные структурные HTML-теги (`<b>`, `<i>`) в шаблонах не задвоены в экранировании — проверено построчным чтением `templates.ts` (см. п.6 выше).
- Существующие тесты `module-channel.test.ts`, `feedback/telegram.test.ts` (упомянутые в issue как «уже покрывают часть вызывающих») зелёные в общем прогоне.

## Security (обязательные функциональные кейсы)

- **RBAC:** новых endpoint'ов фикс не создаёт; затронутые роуты (`admin/telegram/test*`, `admin/notifications/routing/test`, `gazebos|ps-park/settings/test`) сохраняют существующий `requireAdminSection`-гейт — не менялся этим PR.
- **Data leakage:** `git diff main...HEAD | grep -iE "password|token|secret"` → чисто.
- **Input validation / injection:** основная цель issue — экранирование HTML-инъекции в Telegram-сообщениях. **FAIL** по этому кейсу для `src/modules/inventory/notifications.ts` (см. баг выше) — по правилу `agents/qa.md` («если хотя бы один security-кейс FAIL → вердикт FAIL, даже если всё остальное PASS») это блокирует общий вердикт независимо от того, что все AC, буквально перечисленные в issue, закрыты.
- **Rate limiting:** вне скоупа фикса; отмечено как наблюдение — `POST /api/waitlist` (публичный, неаутентифицированный, один из исправленных в этом PR call-сайтов) не вызывает `rateLimit()` явно в самом route-хендлере, в отличие от `POST /api/rental/inquiries`, где `rateLimit(request, "public")` вызывается явно. Не проверено, покрыт ли `/api/waitlist` глобальным middleware (в `src/` нет файла `middleware.ts` на верхнем уровне — не найден при поиске). Это **не регрессия** этого PR (existing endpoint, не создан и не изменён по этой части фиксом) и не входит в AC issue #471, поэтому не блокирует вердикт, но стоит завести отдельным issue, если действительно отсутствует.

## Регрессия/тесты — сводка

- `npm test -- --run`: **3544/3544 passed**, 239/239 файлов.
- `npx tsc --noEmit`: чисто.
- `npm run lint`: 0 errors, 16 pre-existing warnings вне скоупа PR.

## Итог

Оба раунда фикса качественно закрывают всё, что было явно перечислено в issue
#471: единственная реализация `escapeHtml`, все 7 дублирующих объявлений
заменены импортом, все прямо названные call-сайты (включая самый серьёзный —
`rental-inquiry.inquiry.created`, публичный неаутентифицированный вектор,
пойманный только во втором раунде) экранированы и покрыты тестами,
проверяющими именно экранированный вывод, а не просто «не падает». Структурные
HTML-теги шаблонов не задвоены. `npm test`, `npx tsc --noEmit`, `npm run lint`
— все зелёные независимо перепрогнаны.

Однако критерий готовности issue сформулирован шире, чем «перечисленные в
issue места» — «для каждого `parse_mode: "HTML"` в репозитории». Сплошной
обход всех файлов, реально строящих текст для HTML-канала Telegram (не только
грепом по буквальной строке `parse_mode`, а по фактическим потребителям
`telegramAdapter`/`sendTelegramAlert`/`telegramApi`), обнаружил не
затронутый ни одним из двух коммитов `src/modules/inventory/notifications.ts`
— тот же класс уязвимости (неэкранированные `managerName`/`adminName`/
`problemNote` в `parse_mode:"HTML"`-сообщении), доступный аутентифицированному
MANAGER модуля inventory. Это ровно тот тип пропуска («не содержит буквальной
строки `parse_mode`, потому что она на уровень ниже, в канале»), который сам
round 2 был призван закрыть для `templates.ts`, — здесь остался незакрытым.

По правилу security-кейсов (`agents/SECURITY.md` + `agents/qa.md`: «security-
кейс FAIL → вердикт FAIL, независимо от остального») — общий вердикт **FAIL**.

**Рекомендация Developer'у:** добавить `escapeHtml` (алиас `e`, как в
`templates.ts`) вокруг `data.managerName`/`data.adminName`/`data.problemNote`/
`data.receivedAt`/`data.totalAmount`/`data.itemCount` в четырёх билдерах
`src/modules/inventory/notifications.ts` (`buildReceiptCreatedMessage`,
`buildReceiptConfirmedMessage`, `buildReceiptProblemMessage`,
`buildReceiptCorrectedMessage`), добавить регресс-тест по аналогии с
`inventory/__tests__/alerts.test.ts`, затем перезапросить QA.

## Вердикт: FAIL
