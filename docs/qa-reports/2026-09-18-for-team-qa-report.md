# QA-отчёт: раздел FOR TEAM (меню/подвал → /for-team) — PR #916

Ветка `claude/vigilant-maxwell-2u6fb3`. На момент проверки в ветке два коммита
поверх `origin/main` (`5bc69b7`):

- `8aa8510` — feat(team): раздел FOR TEAM в меню и подвале — витрена внутренних сервисов
- `9fde46e` — test(e2e): обновить эталон cafe-mobile под ссылку FOR TEAM в подвале

Бриф в задаче называл только `8aa8510`; второй коммит уже был запушен в
`origin/claude/vigilant-maxwell-2u6fb3` на момент проверки. Проверка идёт по
факту HEAD (`9fde46e`) — второй коммит только обновляет PNG-эталон
скриншот-теста под +32px высоты подвала `/cafe` (mobile), новой функциональности
не добавляет.

PRD нет — acceptance criteria сформулированы владельцем в чате и развёрнуты
постановщиком задачи в AC-1..AC-6 (см. ниже).

**Учтён существующий ревью-артефакт** `docs/qa-reports/2026-09-18-for-team-code-review.md`
(untracked, лежит в рабочем дереве) — это отчёт code-reviewer по этому же PR,
вердикт `NEEDS_CHANGES` по той же причине (бинарные control-байты в
`safe-callback-url.ts`), см. раздел «Совпадение с Reviewer» ниже.

## Вердикт: FAIL

Два блокера: security-релевантный дефект хранения файла (совпадает с находкой
Reviewer, независимо подтверждён) и функциональный баг, нарушающий явный
AC-3 (magic-link не возвращает на `/for-team`), которого Reviewer не поймал.

---

## 1. Прогон обязательных команд

| Команда | Результат |
|---|---|
| `npm test -- --run` | **335 файлов / 4680 тестов — все зелёные.** Совпадает с ожиданием из задачи. Duration ~60s. |
| `npx tsc --noEmit` | Чисто, 0 ошибок. |
| `npx eslint .` | **0 errors, 21 warnings.** Все 21 — pre-existing паттерны в файлах вне диффа (`react-hooks/set-state-in-effect`, unused-eslint-disable, unused vars), **кроме 3**, которые физически лежат в двух тронутых диффом файлах: `src/app/auth/redirect/page.tsx:14` и `src/app/auth/signin/page.tsx:52,54` (правило `@next/next/no-location-assign-relative-destination` на `window.location.href = "/admin/dashboard"` и т.п.). Все три — **на строках, не изменённых этим PR** (сверено построчно с `git diff`): это существующий паттерн `window.location.href` для редиректов после логина, использовавшийся в этих файлах и раньше. Новая строка `window.location.href = target` (signin/page.tsx:45, `target` — переменная, не литерал) правило **не флагает** — оно матчит только литералы. Не дефект этого PR. *(Важно: `npx eslint . \| tail -100` в первом проходе обрезал начало вывода — 132 строки всего; полный лог без `tail` даёт полную картину, см. выше.)* |
| `SKIP_ENV_VALIDATION=1 npx next build` | Успешно, exit 0. `/for-team` собран как `ƒ` (dynamic), соответствует `export const dynamic = "force-dynamic"`. Несвязанные pre-existing build-warnings про `instrumentation.ts` (`Ecmascript file had an error`) — не в файлах диффа. |

---

## 2. Acceptance Criteria

| AC | Вердикт | Как проверено |
|---|---|---|
| **AC-1** — FOR TEAM в десктоп-навигации и мобильном бургер-меню, обе темы | PASS (чтение кода) | `landing-delovoy-park.ru/components/navbar.tsx:19,39-44,108-110,208-214`. `TEAM_LINK` рендерится и в `<nav>` (десктоп), и в `open && <div>` (мобильный оверлей); `teamLinkCls`/`mobileTeamLinkCls` считаются от пропа `dark`, обе ветки реально используются в приложении (`<Navbar dark />` на `/ps-park`, `<Navbar />` везде ещё). **Не покрыто автотестом** — ни у `navbar.tsx`, ни у `footer.tsx` нет `__tests__`; браузера в сессии нет, визуально не проверено. |
| **AC-2** — FOR TEAM в подвале, включая инлайновые подвалы `ps-park`/`dashboard`, вёрстка не ломается | PASS (чтение кода) | `footer.tsx:15-22` (общий `Footer`, используется большинством публичных страниц); `ps-park/page.tsx:449-459` (тёмная тема, добавлен `flex items-center gap-5` внутри уже `flex-wrap`-контейнера); `dashboard/page.tsx:384-391` (переход `justify-center` → `md:flex-row md:justify-between`). Структурно консистентно с окружающей вёрсткой. **Не покрыто тестом, визуально не проверено** — как и для AC-1, браузера нет. |
| **AC-3** — гость → `/auth/signin?callbackUrl=/for-team` → после логина именно `/for-team`, для всех 4 способов входа | **PASS для email+пароль / Telegram / VK, FAIL для magic-link** | См. блокер BUG-2 ниже. Password и Telegram/VK корректны (прослежено по коду, ниже). Magic-link молча теряет `callbackUrl` — пользователь после входа по ссылке из письма попадает на `/admin/dashboard`/`/dashboard`, а не на `/for-team`. Это специально названный в AC способ входа, значит AC-3 в целом **не выполнен**. |
| **AC-4** — авторизованный сотрудник сразу видит `/for-team` | PASS | `for-team/page.tsx:35-42` — редирект только при `!session?.user`; для team-ролей рендер идёт сразу. Покрыто тестами (`page.test.tsx` — все ролевые кейсы вызывают `ForTeamPage()` напрямую и не ожидают `mockRedirect`). |
| **AC-5** — показаны только реально работающие сервисы + доступные роли; ссылка не ведёт на `/admin/forbidden`/404 | PASS | Каталог `TEAM_SERVICES` (`src/lib/team-services.ts`) сверен и с `ADMIN_SECTION_SLUGS` (`permissions.ts`), и с файловой системой — см. раздел 4. `visibleTeamServices()` не изобретает свою RBAC-логику, целиком опирается на `getUserAdminSections()`/`isTeamRole()`. Хорошо продуманный инвариантный тест `superadminOnly стоит ровно на секциях вне грида прав` (`team-services.test.ts:50-57`) сверяется с живым источником правды, а не с копией списка — не даст будущему дрейфу (например, закрытию issue #914) пройти незамеченным. Нашёл на что обратить внимание, но не бага — см. раздел 3. |
| **AC-6** — USER не получает ссылок в `/admin/*`, видит объяснение | PASS | `for-team/page.tsx:73-74,124-143` (`NoTeamAccess()`), тест `page.test.tsx:63-72` рендерит реальное DOM-дерево и проверяет `href`, а не пропсы — ловит именно то, что дойдёт до пользователя. |
| **Не индексируется** | PASS | `metadata.robots = { index: false, follow: false }` (`for-team/page.tsx:17-22`) + `Disallow: /for-team` (`public/robots.txt:7`) + отсутствие в `src/app/sitemap.ts`. Все три поверхности проверены. |

---

## 3. Баг-репорты

### BUG-1 (Blocker, Security/Process) — `safe-callback-url.ts` хранит буквальные control-байты вместо escape-последовательностей

**Совпадает с находкой Reviewer** (`docs/qa-reports/2026-09-18-for-team-code-review.md`,
раздел Security) — нашёл независимо, до чтения ревью-отчёта, побайтовым дампом.

**Модуль:** auth / инфраструктура review-тулинга.

**Файл:** `src/lib/safe-callback-url.ts:45`

**Шаги воспроизведения:**
1. `git diff origin/main...HEAD -- src/lib/safe-callback-url.ts`
2. `grep -rE "callback" src/lib/safe-callback-url.ts`

**Ожидаемый результат:**
1. Построчный текстовый diff, как для любого нового `.ts`-файла.
2. Строки с совпадением `callback` выводятся построчно (файл — обычный UTF-8 текст, security-греп из `agents/SECURITY.md` обязан видеть его содержимое).

**Фактический результат:**
1. `Binary files /dev/null and b/src/lib/safe-callback-url.ts differ` — GitHub PR UI покажет «This file is binary and could not be displayed», содержимое файла человеку-ревьюеру физически не видно через штатный diff.
2. `grep: src/lib/safe-callback-url.ts: binary file matches` — контент не выводится вообще (нужен `-a`, о котором штатный аудит-чеклист не упоминает).

**Причина (побайтовый дамп):** строка 45 (`if (/[<X>-<Y><Z>]/.test(raw)) return null;`) содержит НАСТОЯЩИЕ байты `0x00` (NUL), `0x1F` (US) и `0x7F` (DEL) внутри символьного класса регулярного выражения — а не текст `\x00`/`\x1f`/`\x7f` (4 печатных символа каждый: `\`, `x`, две цифры). Подтверждено `od -An -tx1` на конкретной строке — единственная аномалия во всём файле (проверено побайтовым сканом всех 2602 байт).

**Почему это блокер, а не косметика:**
- Функционально регэксп работает правильно (V8/esbuild/SWC едят control-байты в UTF-8 корректно — `npm test`, `tsc`, `eslint`, `next build` зелёные, поведение проверено отдельно, см. ниже).
- Но это ИМЕННО файл с ядром security-фикса этого PR (open redirect). Два независимых защитных механизма конвейера ослепли на него одновременно: обычный `git diff`/GitHub PR review (человек или ИИ-ревьюер, читающий диф как текст) и мандатный `grep`-аудит секретов из `agents/SECURITY.md` («Reviewer обязательно проверяет: `grep -rE '(password|token|secret|...)'`») — оба молча пропускают контент, не давая никакого сигнала о том, что что-то пропущено.
- Хрупко: любой будущий текстовый тул (патчер, другой линтер, IDE), который иначе обработает NUL-байт, может тихо сломать сам файл.
- Дешёво чинится: заменить 3 байта на текстовые escape-последовательности, поведение теста не меняется (проверил сам — не только поверил Reviewer'у, см. `/tmp/.../test-safe-cb.ts` прогон ниже).

**Проверка, что сама логика санитайзера корректна (это НЕ довод против блокера, а отдельная, хорошая новость):**
Прогнал `safeCallbackUrl()` напрямую (`npx tsx`) против кросс-проверки через `new URL(result, origin).origin` (реальная семантика браузера/Node) на полном наборе адверсариальных input'ов, которые не покрыты юнит-тестами: пробел вместо второго символа (`"/ /evil.com"`), TAB/LF/CR/VT/FF/DEL/US-байты, юникод-пробелы (NBSP, ideographic space, BOM, LINE/PARAGRAPH SEPARATOR), обратный слэш не на второй позиции (`"/foo\@evil.com"`), `javascript://alert(1)` (проходит regex схемы с `://`, но `new URL(...).origin` для non-special схемы — строка `"null"`, никогда не равна реальному origin), `https://delovoy-park.ru.evil.com/`, `https://delovoy-park.ru@evil.com/`. **Обхода не нашёл** — control-char класс (даже в текущем виде, битово идентичный `\x00-\x1f\x7f`) корректно ловит TAB/LF/CR, из-за которых WHATWG URL parser схлопывает `/\r/evil.com` в `//evil.com` (проверено `new URL()` в Node — это реальный, не гипотетический вектор для наивных реализаций, но здесь он закрыт). Origin сравнивается через `new URL(...).origin`, а не строковым `startsWith`/`includes`, поэтому похожие домены не проходят.

**Что исправить:** переписать строку 45, набрав `\x00`, `\x1f`, `\x7f` как текст (4 печатных ASCII-символа каждый), пересохранить файл как обычный UTF-8-текст без control-символов. После фикса `git diff -- src/lib/safe-callback-url.ts` должен быть построчным, не `Binary files ... differ`. Поведение теста не меняется — `safe-callback-url.test.ts` должен остаться 9/9 зелёным без изменений.

---

### BUG-2 (Blocker, нарушает явный AC-3) — magic-link login теряет `callbackUrl`, после входа по ссылке из письма уводит на дефолтный дашборд вместо `/for-team`

**Не найден Reviewer'ом** (его отчёт трактует «email/password» как единый способ входа и не разбирает magic-link отдельно; его же собственный `.verify-temp.mjs` live-браузерный скрипт тоже проверяет только режим "Войти по Email" → пароль, ни разу не переключаясь на вкладку "Ссылка на почту").

**Модуль:** auth (`email-magic-link`).

**Шаги воспроизведения (прослежено по коду сквозь всю цепочку, см. файлы ниже):**
1. Неавторизованный гость открывает `/for-team` → редирект на `/auth/signin?callbackUrl=%2Ffor-team`.
2. На странице входа выбирает Email → вкладку «Ссылка на почту» (magic-link), вводит email, жмёт «Отправить ссылку».
3. Кликает по ссылке в письме.
4. Успешно логинится (магик-линк валиден).

**Ожидаемый результат:** пользователь оказывается на `/for-team` (это и есть цель всего PR, явно указана в AC-3: «работает для... magic-link»).

**Фактический результат:** пользователь оказывается на `/admin/dashboard` (для сотрудника) или `/dashboard` (для обычного USER) — `callbackUrl` теряется безвозвратно на шаге 2→3.

**Разбор причины по коду:**
- `src/app/auth/signin/page.tsx:142-167` (`handleMagicLinkRequest`) отправляет в `POST /api/auth/email/send` **только** `{ email }` — текущий `rawCallbackUrl` (`/for-team`, ещё доступный на этой странице через `searchParams`) никогда не попадает в тело запроса.
- `src/modules/auth/validation.ts:3-6` (`sendMagicLinkSchema`) не имеет поля `callbackUrl` вообще.
- `src/modules/auth/email-magic-link.service.ts:110-111` (`sendMagicLinkEmail`) строит ссылку в письме как `${appUrl}/api/auth/verify-email?token=...&email=...` — без `callbackUrl`.
- `src/app/api/auth/verify-email/route.ts:33-35` после успешной проверки токена делает **серверный** redirect на `${appUrl}/auth/signin?magic=${nonce}` — тоже без `callbackUrl`.
- Когда пользователь кликает по ссылке из письма, это **новая загрузка страницы** (`/api/auth/verify-email` → 302 → `/auth/signin?magic=<nonce>`), у которой `useSearchParams()` содержит только `magic`, а исходный `callbackUrl=/for-team` со шага 1 давно недостижим (это был отдельный, уже закрытый заход на `/auth/signin`, состояние React в `rawCallbackUrl` из того захода не переживает навигацию).
- В `signin/page.tsx:89-106` (`useEffect` на `?magic=`) после успешного `signIn("magic-link", ...)` вызывается `redirectAfterLogin()`, где `rawCallbackUrl = searchParams.get("callbackUrl")` **на этой, новой** загрузке страницы — `null`. `safeCallbackUrl(null, ...)` возвращает `null` → падает в дефолтную ветку по роли.

Проверил grep'ом по всей серверной цепочке magic-link (`src/modules/auth/`, `src/app/api/auth/`, `src/app/api/auth/email`) — строка `callbackUrl` не встречается **ни разу**. Это не гипотеза «может потеряться в редком случае» — цепочка физически не хранит и не передаёт это значение ни на одном из трёх хопов (send → email-ссылка → verify-email redirect → signin?magic=).

**Почему Telegram/VK не страдают тем же дефектом (чтобы не путать с тем же классом бага):**
- VK — `signIn("vk-id", { callbackUrl: providerCallbackUrl })` без `redirect:false`: весь OAuth-раунд-трип ведёт NextAuth, он сам протаскивает переданный `callbackUrl` через подписанный cookie/state — это встроенный, проверенный механизм самой библиотеки, не завязанный на то, что браузер вернётся с тем же query string.
- Telegram — `useTelegramAuth` **не покидает исходную вкладку**: диплинк открывается в отдельной вкладке/приложении, а поллинг (`/api/auth/telegram/start` → `/status`) продолжается в исходной, где `callbackUrl` — обычная замкнутая переменная React, ей неоткуда теряться.
- Magic-link — единственный способ, который требует уйти со страницы через внешний канал (почтовый клиент) и вернуться по ссылке, которую генерирует **сервер**, а сервер этот параметр никогда не видел.

**Не покрыто тестами:** ни `src/app/auth/signin/page.tsx`, ни `src/app/auth/redirect/page.tsx`, ни `src/app/api/auth/verify-email/route.ts` не имеют `__tests__` (последний — `route.test.ts` существует, но не проверяет `callbackUrl`, т.к. его там никогда не было в схеме). Именно поэтому баг не поймали ни юнит-тесты, ни ревью.

**Что исправить (для Developer):** прокинуть опциональный `callbackUrl` через всю цепочку — `sendMagicLinkSchema` → `generateAndStoreMagicLink`/`sendMagicLinkEmail` (сохранить рядом с токеном, напр. в Redis под тем же ключом с TTL) → `verify-email/route.ts` дописать `&callbackUrl=...` к редиректу на `/auth/signin?magic=...` — по аналогии с тем, как уже сделано для Telegram/VK через `providerCallbackUrl`. Обязательно провести значение через `safeCallbackUrl` перед использованием на каждом хопе, где оно попадает в URL, — это пользовательский ввод той же природы, что и исходный `callbackUrl`.

---

## 4. Каталог `TEAM_SERVICES` vs реальность

Автоматически сверил (`npx tsx`, скрипт временный, не коммитил):

- `TEAM_SERVICES` (20 записей) минус 3 `superadminOnly` (`feedback`, `payments`, `notifications` — корректно НЕ входят в `ADMIN_SECTION_SLUGS`, issue #914) = 17 записей.
- `ADMIN_SECTION_SLUGS` (18 записей) минус `sauna` = 17 записей.
- **Оба множества идентичны** (посортированное сравнение через `JSON.stringify` — `true`).
- Для всех 20 `href` из `TEAM_SERVICES` каталог `src/app/admin/<section>/` существует **и** содержит `page.tsx` (проверено файловой системой напрямую, не только по `TEAM_SERVICES.href`).
- `sauna` — единственная секция грида без записи в каталоге, `src/app/admin/sauna` физически не существует (`existsSync` → `false`) — соответствует комментарию в коде (issue #915). Других расхождений нет — не нашёл ни забытых секций гридa, ни лишних записей вне грида (кроме трёх намеренных `superadminOnly`).

Это подтверждает и усиливает утверждение из `team-services.ts`'s собственного теста «`superadminOnly` стоит ровно на секциях вне грида прав» — я проверил ту же инвариантность дополнительно через файловую систему, а не только через список слагов.

---

## 5. RBAC / security-чеклист (`agents/qa.md`)

Новых API-роутов и мутаций эта фича не добавляет (`/for-team` — чистый server component без БД-записи, `team-services.ts` — чистые функции без сайд-эффектов) — часть стандартного чеклиста (rate limiting на публичном POST, input-валидация тела, `AuditLog`) неприменима буквально.

- **Анонимный → защищённый ресурс:** `/for-team` без сессии → серверный `redirect()` на `/auth/signin?callbackUrl=%2Ffor-team`, не рендерит контент до проверки. Покрыто тестом.
- **USER → team-only контент:** `visibleTeamServices` для USER — `[]`, страница рисует `NoTeamAccess()`, ни одной `/admin/*` ссылки в DOM (тест рендерит дерево, не пропсы).
- **MANAGER модуля A → секция вне его грантов:** `visibleTeamServices("MANAGER", ["cafe"])` не отдаёт ничего, кроме `cafe`; отдельный тест бьёт кейс «подсунули `payments`/`notifications` в granted — всё равно не проходят», проверяя двойную защиту (не в `ADMIN_SECTION_SLUGS` + `superadminOnly` роль-чек).
- **Подмена userId:** неприменимо — страница не принимает `userId` откуда-либо кроме `session.user.id` из `auth()`.
- **Data leakage:** страница рендерит только собственные `name`/`email`/`role` текущей сессии — не чужие данные. `force-dynamic` корректен (персонализированный контент).
- **Rate limiting / invalid JSON / SQL-like строки:** неприменимо, эндпоинтов с телом запроса эта фича не создаёт.

Дефектов в этой части не нашёл — согласен с оценкой Reviewer'а по RBAC-разделу (независимо прогнал ту же матрицу ролей и пришёл к тем же выводам).

---

## 6. Дополнительные наблюдения (не блокеры)

1. **Отсутствие тестов на `signin/page.tsx` / `redirect/page.tsx`.** Именно этот пробел — прямая причина, по которой BUG-2 не поймали ни `npm test`, ни ревью. Стоит завести отдельной задачей на Developer/QA-процесс: минимум happy-path тест на каждый из 4 способов входа с проверкой финального `window.location.href`.
2. **Отсутствие тестов на `navbar.tsx`/`footer.tsx` (лендинг).** AC-1/AC-2 проверены только чтением кода — в проекте нет прецедента тестов для этих конкретных компонентов, так что это не регрессия конкретно этого PR, но и не покрыто.
3. **Браузер в этой сессии недоступен** (по условиям задачи) — вёрстка (мобильное меню, тёмная тема navbar на `/ps-park`, инлайновые подвалы `ps-park`/`dashboard`) проверена только чтением JSX/Tailwind-классов, визуально не подтверждена. *Прозрачности ради:* в рабочем дереве обнаружились артефакты предыдущего агента (Reviewer) — `.verify-temp.mjs` (Playwright-скрипт) и работающий `next-server` на `:3000` — судя по всему, у Reviewer была живая браузерная проверка. Не стал повторно поднимать/использовать эту инфраструктуру для полноценного E2E: конкретно попытка прочитать `DATABASE_URL` из окружения чужого процесса (нужно для инспекции magic-link токена без реальной отправки письма) была заблокирована классификатором окружения («Credential Materialization») — посчитал это правильным сигналом остановиться, а не обходить. BUG-2 подтверждён исчерпывающей статической трассировкой (grep по всей серверной цепочке не находит `callbackUrl` ни разу), а не гипотезой.
4. **`robots.txt` косметика:** новая строка `Disallow: /for-team` без завершающего слэша, тогда как соседние (`/admin/`, `/dashboard/`) — со слэшем. Не баг (нет вложенных путей под `/for-team`, чтобы слэш на что-то влиял), просто стилистическая непоследовательность.
5. **Вне скоупа PR, для сведения:** `landing-delovoy-park.ru/components/navbar.tsx:27-28` (`isAdmin = role === "SUPERADMIN" || role === "MANAGER"`) не учитывает роль `ADMIN` — пользователь с ролью ADMIN увидит в выпадающем меню «Личный кабинет»/`/dashboard` вместо «Админ-панель»/`/admin/dashboard`. Код не тронут этим PR, баг предшествующий — не влияет на вердикт, но раз уж заметил рядом с диффом, фиксирую для трекинга.
6. **Тестовое покрытие `visibleTeamServices` по роли `ADMIN`:** `team-services.test.ts` явно гоняет USER/MANAGER/SUPERADMIN, но не `ADMIN` (хотя `isTeamRole` его поддерживает). По чтению кода поведение идентично MANAGER (оба ветвятся только на `granted.has(...)`, кроме явной `role === "SUPERADMIN"` проверки для `superadminOnly` секций) — вероятно, корректно, но лишний тестовый кейс не помешал бы для защиты от регрессии.

---

## 7. Совпадение с Reviewer

Ключевой блокер (BUG-1, control-байты в `safe-callback-url.ts`) я нашёл независимо, тем же способом (побайтовый дамп), что и code-reviewer в `docs/qa-reports/2026-09-18-for-team-code-review.md` (вердикт `NEEDS_CHANGES`), **до** того как прочитал его отчёт — совпадение диагнозов усиливает уверенность в находке, а не является просто копированием. BUG-2 (magic-link) — новая находка, отсутствующая в ревью-отчёте: Reviewer сгруппировал «email/password» как один способ входа в таблице AC и не проследил отдельно ветку magic-link до конца цепочки (send → email-ссылка → verify-email → signin?magic=), а его собственный live-browser-скрипт тестировал только парольный под-режим формы.

Поскольку код с момента ревью не менялся (тот же HEAD `9fde46e`, тот же байтовый дамп файла), а найден ещё один AC-нарушающий баг сверх уже выставленного `NEEDS_CHANGES`, итоговый вердикт QA — **FAIL**, с двумя независимыми блокерами вместо одного.

---

## Итог

- Всего кейсов/AC: 7 (AC-1..AC-6 + noindex)
- PASS: 6 (AC-1, AC-2, AC-4, AC-5, AC-6, noindex)
- PASS частично / FAIL: 1 (AC-3 — 3 из 4 способов входа работают, magic-link — нет)
- Блокеров: 2 (BUG-1 security/process, BUG-2 функциональный AC-3)
- Security-кейсы (RBAC/data leakage) — PASS, open-redirect логика — PASS (обхода не нашёл), но **хранение** security-критичного файла — FAIL (BUG-1)

---

## Раунд 2

Проверка коммитов поверх HEAD раунда 1 (`9fde46e`): `e99d171` (фикс BUG-1),
`fc7b1f5` (коммит отчёта code-reviewer раунда 1), `ed89656` (фикс BUG-2).
HEAD на момент проверки — `ed89656`.

## Вердикт: FAIL

Оба блокера раунда 1 закрыты корректно (проверено заново, включая mutation-check
и живой браузер). Но при целевом поиске обхода (пункт 5 задания — «переживает
запись в Redis и чтение из неё») нашёл **третий, новый блокер**: открытый
редирект в самом `safeCallbackUrl()`, не связанный с Redis-раунд-трипом BUG-2,
а в его абсолютно-URL-ветке — подтверждён дважды живым браузером (Playwright)
против поднятого стенда. Он ломает именно то свойство, ради которого этот файл
существует (защита от open redirect), причём для трёх из четырёх способов
входа, включая уже вроде бы закрытый в раунде 1 AC-3 (пароль, Telegram, VK).

---

### 1. Обязательные команды

| Команда | Результат |
|---|---|
| `npm test -- --run` | **336 файлов / 4703 теста — все зелёные.** Совпадает с цифрой из коммит-мессаджа `ed89656`. |
| `npx tsc --noEmit` | 0 ошибок, exit code 0. |
| `npx eslint .` | **0 errors, 21 warnings.** Все pre-existing, включая те же 3 на `window.location.href = "/admin/dashboard"` / `"/dashboard"` в `signin/page.tsx:52,54` и 1 в `redirect/page.tsx:14` (`@next/next/no-location-assign-relative-destination`) — на строках, не тронутых диффом (сверено `git diff` построчно), тот же вывод, что в раунде 1. |
| `SKIP_ENV_VALIDATION=1 npx next build` | Успешно, exit 0. `/for-team` — `ƒ` (dynamic). После сборки восстановил `.next/standalone/.next/static` (`cp -r .next/static .next/standalone/.next/static`) — стенд на `:3000` пережил проверку живым (`/for-team` → 307, `/api/health` → 200, `/auth/signin` → 200 до, во время и после всех проверок ниже). |

---

### 2. BUG-1 (control-байты) — закрыт, перепроверено теми же способами

- `git diff origin/main...HEAD -- src/lib/safe-callback-url.ts` — построчный
  текстовый дифф (`new file mode`, `+48` строк), не `Binary files ... differ`.
- `grep -rE "callback" src/lib/safe-callback-url.ts` (без `-a`) — выводит 2
  совпадающие строки построчно, не `binary file matches`.
- `sed -n '45p' ... | od -c` → `/   [   \   x   0   0   -   \   x   1   f   \
  x   7   f   ]   /   .   t   e   s   t` — литеральный текст `\x00-\x1f\x7f`
  (backslash + `x` + две цифры), не сырые байты.
- Побайтовый скан всего файла (`python3`, порог `< 9 or (13 < b < 32) or ==127`)
  — 0 совпадений на всех 2611 байтах. Инцидент устранён полностью, не только
  на строке 45.

---

### 3. BUG-2 (magic-link теряет `callbackUrl`) — закрыт, цепочка прослежена целиком

**Грепом по имени параметра через всю цепочку** (как просило задание):
`sendMagicLinkSchema` (`validation.ts:6`, `z.string().max(2048).optional()`) →
`send/route.ts:32,44,56` (парсинг, `safeCallbackUrl(callbackUrl, appUrl)` до
записи, третий аргумент в `generateAndStoreMagicLink`) →
`email-magic-link.service.ts:60,97-104` (запись в Redis
`magic-link:cb:<token>`, TTL = `TOKEN_TTL_SECONDS`, тот же что у токена) →
`email-magic-link.service.ts:124-132` (`consumeMagicLinkCallbackUrl` — читает
и одноразово удаляет) → `verify-email/route.ts:19,42-46` (`appUrl` определён
до использования на строке 19; `stored` → второй прогон `safeCallbackUrl` →
`&callbackUrl=` дописывается в редирект на `/auth/signin?magic=...`) →
`signin/page.tsx:37` (`rawCallbackUrl = searchParams.get("callbackUrl")` на
**новой** загрузке страницы, где уже есть оба параметра `magic` и
`callbackUrl`) → `signin/page.tsx:39-56` (`redirectAfterLogin`, третий прогон
`safeCallbackUrl` с `window.location.origin`) → `signin/page.tsx:89-106`
(`useEffect` на `?magic=` вызывает `redirectAfterLogin()` после
`signIn("magic-link", ...)`). Ни одного хопа, где имя параметра пропадает —
в отличие от раунда 1, где `callbackUrl` не встречался в этой цепочке вообще
ни разу.

**Не сломан вход без `callbackUrl` / без Redis / старая сигнатура (пункт 3
задания):**
- Полный прогон `npm test -- --run` зелёный, включает исходные
  1-арг/2-арг вызовы `generateAndStoreMagicLink("email")` и
  `generateAndStoreMagicLink("email", password)` — строки 147–203
  `email-magic-link.service.test.ts` — не переписаны, всё ещё проходят.
  Прод-код зовёт функцию только из одного места
  (`grep -rn "generateAndStoreMagicLink(" src --include=*.ts*` вне тестов —
  один результат, `send/route.ts:56`, с тремя аргументами).
- Без `callbackUrl` в теле: Zod даёт `undefined` → `safeCallbackUrl(undefined,
  appUrl)` → `null` (`if (!raw) return null`) → `generateAndStoreMagicLink(...,
  null)` → запись в Redis пропускается (`if (callbackUrl && redisAvailable)`,
  `email-magic-link.service.ts:97`) → `consumeMagicLinkCallbackUrl` находит
  пустой ключ → `null` → редирект точно как до фикса, без `&callbackUrl=`.
  Прослежено по коду и подтверждено тестом «без сохранённого адреса параметр
  не добавляется».
- Redis недоступен: `consumeMagicLinkCallbackUrl` возвращает `null` без
  обращения к Redis же (`if (!redisAvailable) return null`, строка 127) —
  вход не блокируется, деградация, не отказ; тест «недоступный Redis (null)
  не мешает войти» зелёный.

**Mutation-check (пункт 4 задания) — три отдельные мутации, каждая ловится
ровно тем набором тестов, который должен, без ложных срабатываний:**

| Мутация | Файл | Упавшие тесты | Остальные тесты |
|---|---|---|---|
| Пропустить `safeCallbackUrl()` перед записью (`const safeTarget = callbackUrl ?? null`) | `send/route.ts` | 5 из 11 в `send/__tests__/route.test.ts`: 4× `it.each` чужих адресов + «абсолютный URL... схлопывается до пути» | 6 (happy path, кулдаун, невалидный email, «свой путь», «без адреса», «слишком длинное») — зелёные |
| Не читать `consumeMagicLinkCallbackUrl` (`const stored = null`) | `verify-email/route.ts` | Ровно 1 из 11 в `verify-email/__tests__/route.test.ts`: «сохранённый внутренний путь доезжает до страницы входа» | Все 7 старых + 3 остальных новых — зелёные |
| Не удалять ключ после чтения (убрать `redis.del`) | `email-magic-link.service.ts` | Ровно 1 из 38: «читает адрес один раз и удаляет ключ» | 37 — зелёные |

Ни одного «проходит и без фикса» — дефектов тестов не нашёл, все 19+ новых
тестов заточены на поведение (реальный третий аргумент мока, реальный
`Location`, реальный вызов `redis.del`), не на факт вызова.

**Дополнительная мутация (не запрошена явно, но напрашивалась после
предыдущей находки о непокрытых файлах) — убрал `callbackUrl` из тела запроса
в `handleMagicLinkRequest` (`signin/page.tsx`, клиентский хоп «форма →
`fetch`»):** `npm test -- --run` остаётся **4703/4703 зелёных**, `tsc` чист,
`eslint` не добавляет ошибок (только безобидный новый warning
`react-hooks/exhaustive-deps` про лишнюю зависимость). **Этот конкретный хоп
по-прежнему не покрыт ни одним тестом** — комментарий в отчёте раунда 1 п.6.1
(«Отсутствие тестов на `signin/page.tsx`») остаётся в силе и для этого PR:
если кто-то в будущем случайно уберёт `callbackUrl` из этого `fetch`-запроса,
CI этого не заметит. Не блокер (код сейчас корректен, проверено чтением и
живым браузером ниже), но фиксирую как открытый пробел.

**Мок в `verify-email/__tests__/route.test.ts` (пункт 6 задания):** построчно
сверил `git show ed89656~1:...route.test.ts` с текущим файлом (`diff`) — все 7
исходных тестов (`happy path`, `invalid params`, `TOKEN_INVALID`,
`TOKEN_EXPIRED`, `REDIS_UNAVAILABLE`) не изменены НИ НА СТРОКУ внутри своего
`describe`. Единственная правка вокруг них — добавление
`mockConsumeCallbackUrl` в `vi.hoisted`/`vi.mock` и дефолт
`mockConsumeCallbackUrl.mockResolvedValue(null)` в общий `beforeEach`. Это не
ослабляет старые тесты: default `null` воспроизводит ровно то поведение,
которое было ДО существования этого поля (никакого `callbackUrl` в редиректе),
так что старые ассерты (`location.toContain(...)`) остаются валидны без
изменений. Новые 4 теста — отдельным `describe` ниже, не смешаны со старыми.

---

### 4. Новый блокер — BUG-3: open redirect в абсолютно-URL-ветке `safeCallbackUrl()` (не связан с Redis-раунд-трипом, но обход тому пункту задания, который просил его искать)

**Серьёзность:** Critical (Security).

**Модуль:** auth (`src/lib/safe-callback-url.ts`, используется в
`signin/page.tsx` и `redirect/page.tsx`).

**Как нашёл:** пункт 5 задания просил поискать вход, «который проходит
нормализацию на записи, но опасен на чтении, или наоборот» — применительно к
Redis-раунд-трипу такого не нашёл (см. ниже, там наоборот всё работает верно, по
удачному стечению обстоятельств). Но тот же вопрос, заданный про **две
независимые ветки одной и той же функции** (путь vs абсолютный URL), вскрыл
реальный дефект: обработка отсутствует именно там, где её больше всего не
хватает.

**Причина (`src/lib/safe-callback-url.ts:24-34`):**

```ts
if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
  if (!origin) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(origin).origin) return null;
    return url.pathname + url.search + url.hash;   // ← строка 30, без проверок
  } catch {
    return null;
  }
}
// ... check для // и \, и control-байтов — только НИЖЕ, для raw-путей
```

Ветка «абсолютный URL своего origin» (комментарий в файле: «его присылает
auth-гейт в proxy.ts... он схлопывается до пути») возвращает
`url.pathname + url.search + url.hash` **напрямую**, минуя те самые проверки
`//`/`\`/control-байты, которые несколькими строками ниже защищают путевую
ветку. А `new URL(...).pathname` может начинаться с `//`: `origin` сравнивает
только протокол+хост+порт, не путь, так что `https://delovoy-park.ru//evil.com`
имеет тот же `origin`, что и `https://delovoy-park.ru`, но
`pathname === "//evil.com"` — то есть ровно тот protocol-relative паттерн,
который весь файл существует, чтобы отсекать (см. докблок файла, строки 6-9).

**Шаги воспроизведения (API/pure-function уровень):**
```js
safeCallbackUrl("https://delovoy-park.ru//evil.example.com", "https://delovoy-park.ru")
// → "//evil.example.com"   (ожидалось: null)
```
Тот же результат для backslash-варианта: `"https://delovoy-park.ru/\\evil.com"`
→ `"//evil.com"`.

**Живое браузерное подтверждение (Playwright, chromium 1194, против стенда на
`:3000`) — сделал дважды, двумя независимыми путями:**

1. **`/auth/redirect` (уже залогинен, сессия `user@local`):**
   `http://localhost:3000/auth/redirect?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F%2Fevil.example.com`
   → перехваченный `page.on("request")` зафиксировал реальный сетевой запрос
   к `http://evil.example.com/`; `page.url()` в итоге —
   `chrome-error://chromewebdata/` (DNS `evil.example.com` не резолвится в
   песочнице — это ожидаемо и как раз доказывает, что браузер честно пытался
   уйти на чужой хост, а не остался на `localhost`).
2. **`/auth/signin` + обычный вход по паролю (`user@local`/`user`), тот же
   AC-3, что был явно назван «PASS» в раунде 1 для password/Telegram/VK:**
   `http://localhost:3000/auth/signin?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F%2Fevil.example.com`
   → после успешного логина `page.waitForURL(host === evil host)` упал с
   `net::ERR_NAME_NOT_RESOLVED` (т.е. браузер СНАЧАЛА попытался туда перейти),
   `page.url()` — снова `chrome-error://chromewebdata/`, перехваченный запрос
   к `http://evil.example.com/` зафиксирован.

**Ожидаемый результат:** `safeCallbackUrl` отклоняет любой вход, приводящий к
protocol-relative пути, независимо от того, пришёл ли он как путь или как
абсолютный URL — согласно собственному докблоку файла и уже существующим
тестам для путевой ветки (`"отклоняет protocol-relative URL — это и есть open
redirect"`, `"отклоняет backslash-вариант"`).

**Фактический результат:** пользователь, перешедший по ссылке вида
`https://delovoy-park.ru/auth/signin?callbackUrl=https://delovoy-park.ru//evil.com`
(или `/auth/redirect?callbackUrl=...` — работает даже без повторного логина,
если сессия уже есть), после успешной авторизации на **настоящем**
delovoy-park.ru уводится на `evil.com` — классический open-redirect-фишинг,
именно тот сценарий, который описан в докблоке этого же файла как причина его
существования («ссылка-то была на delovoy-park.ru»).

**Почему это не поймали раньше:**
- Ни один существующий тест в `safe-callback-url.test.ts` не комбинирует
  «абсолютный URL своего origin» с «path начинается на `//` или `\`» — тест
  «схлопывает абсолютный URL своего origin до пути» использует безобидный
  `/admin/gazebos?d=...`, а тесты на protocol-relative бьют только по
  путевому вводу (`"//evil.com"`, `"/\\evil.com"`), не по абсолютному URL с
  таким же эффектом.
- Живая браузерная проверка раунда 1 («open redirect закрыт на `//example.com`,
  `/\example.com` и `https://example.com`») тестировала «типичный сторонний
  origin» и «типичный protocol-relative путь» по отдельности — не их
  комбинацию (свой origin + protocol-relative путь внутри).
- Round 2 code-reviewer (`docs/qa-reports/2026-09-18-for-team-code-review.md`,
  раздел «Раунд 2», Security) тоже перепроверял только те же 4 паттерна из
  раунда 1 (`//evil.com`, `/\evil.com`, `https://evil.com/...`,
  `javascript:...`) — не комбинацию.

**Что исправить:** не возвращать `url.pathname + url.search + url.hash`
напрямую из абсолютно-URL-ветки — прогнать этот же кандидат через путевые
проверки. Самый простой вариант, не меняющий сигнатуру и подтверждённый мной
вручную (`node -e ...`, оба существующих кейса — свой путь и protocol-relative
через абсолютный URL — дают ожидаемый результат):
```ts
return safeCallbackUrl(url.pathname + url.search + url.hash, origin);
```
(рекурсивный вызов: `pathname` всегда начинается с `/` и никогда не матчит
regex схемы `scheme://`, так что провалится в уже существующую путевую ветку
со всеми её проверками). Альтернатива — вынести проверки `//`/`\`/control-байты
в отдельную функцию и звать её из обеих веток. Тест-кейс на регресс:
`safeCallbackUrl("https://<origin>//evil.com", origin)` → `null` (и
backslash-вариант) — оба нужно добавить в `safe-callback-url.test.ts`.

---

### 5. Обход санитайзера конкретно на Redis-раунд-трипе (пункт 5 задания) — не нашёл, и вот почему

Специально проверил именно тот сценарий, о котором просило задание: значение,
которое проходит нормализацию на записи (в `send/route.ts`, с `appUrl` как
origin), но опасно при чтении (в `verify-email/route.ts`, снова с `appUrl`).
Поскольку `safeCallbackUrl` для путевой ветки — чистая, детерминированная,
идемпотентная функция (её собственный корректный вывод, начинающийся с `/`, не
`//`, без control-байт, повторно проходит те же проверки и возвращается как
есть), обхода на этом конкретном хопе нет. Более того — именно двойной прогон
(пункт 5 задания фактически описывает архитектурное решение разработчика:
«прогонять дважды, т.к. запись и чтение разнесены во времени») **случайно
нейтрализует** BUG-3 для этого маршрута: `safeCallbackUrl("https://appUrl//evil.com",
appUrl)` на записи даёт `"//evil.com"` (тот же баг), но при чтении
`safeCallbackUrl("//evil.com", appUrl)` — это уже путевой ввод, начинающийся
на `//`, и путевая ветка его корректно отклоняет (`null`). Проверено
(`test-bypass.ts`, таблица ниже) и совпадает с тем, что показывают уже
существующие тесты `send/__tests__/route.test.ts` и
`verify-email/__tests__/route.test.ts` (тот же вредоносный вход в обоих
файлах даёт `null`).

| Вход (`raw`) | После записи (1-й прогон) | После чтения (2-й прогон) |
|---|---|---|
| `https://appUrl//evil.com` | `"//evil.com"` (баг BUG-3) | `null` (путевая ветка ловит) |
| `https://appUrl/\evil.com` | `"//evil.com"` | `null` |
| `https://appUrl:443//evil.com` | `"//evil.com"` | `null` |
| `https://appUrl//` | `"//"` | `null` |

Вывод: сам факт «двойного прогона» через Redis случайно закрывает BUG-3
именно для magic-link-потока (что и объясняет, почему тесты раунда 2 на этот
путь — зелёные и корректны), но НЕ закрывает его для `signin/page.tsx` и
`redirect/page.tsx`, где `safeCallbackUrl` вызывается один раз — оттуда и
живой репродукт в разделе 4.

---

### 6. Что уже проверено (без изменений к матрице раунда 1)

Живая матрица ролей на `/for-team` (17/17), RBAC-чеклист, каталог
`TEAM_SERVICES`, noindex — без изменений к отчёту раунда 1, код этих зон не
трогался коммитами `e99d171`/`ed89656`. Открытый пункт из раздела 6 раунда 1
(«роль `ADMIN` не покрыта тестом в `team-services.test.ts`») остаётся
актуальным, не блокер.

---

## Итог раунда 2

- BUG-1 (control-байты) — **закрыт**, перепроверено побайтово.
- BUG-2 (magic-link теряет `callbackUrl`) — **закрыт**, прослежен по всей
  цепочке, mutation-check (3 независимые мутации) ловит ровно ожидаемые тесты,
  старые 7 тестов `verify-email` не ослаблены, вход без `callbackUrl`/без
  Redis/по старой сигнатуре не сломан.
- BUG-3 (новый, этот раунд) — **open redirect** в абсолютно-URL-ветке
  `safeCallbackUrl()` (`src/lib/safe-callback-url.ts:30`), подтверждён живым
  браузером через `/auth/redirect` и `/auth/signin` (пароль) — тот же класс
  уязвимости, который PR заявляет закрытым. Блокер.
- Security-кейс FAIL (open redirect) → вердикт **FAIL**, независимо от того,
  что оба заявленных на исправление блокера раунда 1 закрыты корректно.

---

## Раунд 3

Проверка фикса BUG-3 поверх HEAD раунда 2 (`ed89656`). На момент проверки
ветку успел передвинуть авто-ребейзер (в базу уехал #877 — пересборка
`package-lock.json`), SHA сменились. HEAD на момент проверки —
`031f622` (`fix(auth): open redirect в safeCallbackUrl — свой origin с
protocol-relative путём`), поверх `a471434` (отчёт code-reviewer раунда 2) и
`5b2ce72` (фикс BUG-2, без изменений с раунда 2).

```
git log --oneline origin/main..HEAD
031f622 fix(auth): open redirect в safeCallbackUrl — свой origin с protocol-relative путём
a471434 docs(qa-reports): раунд 2 code-reviewer по PR #916 — PASS
5b2ce72 fix(auth): magic-link теряет адрес возврата — вход по ссылке из письма уводил на дашборд
82aaabf docs(qa-reports): отчёт code-reviewer по PR #916 (FOR TEAM)
3261ccf fix(auth): хранить control-range в safe-callback-url текстом, не байтами
b79a5e3 test(e2e): обновить эталон cafe-mobile под ссылку FOR TEAM в подвале
e07c3ae feat(team): раздел FOR TEAM в меню и подвале — витрина внутренних сервисов
bdb200e chore: bump the npm-minor-patch group across 1 directory with 14 updates (#877)
```

## Вердикт: PASS

BUG-3 закрыт корректно: живой браузер (Playwright, chromium-1194) против
свежесобранного стенда подтверждает — ни один из проверенных векторов,
включая оба, что стреляли в раунде 2, не порождает ни одного сетевого
запроса к чужому хосту. Целевой поиск нового обхода той же логики (double
encoding, userinfo, explicit-port, юникод-слэш, `about:`/`blob:`/`data:`,
очень длинные значения) ничего не нашёл. Mutation-check по обоим новым
наборам тестов (5 регрессионных + 2 на хоп формы) даёт ровно ожидаемую
картину: откат фикса роняет ровно эти тесты, ни одного больше и ни одного
меньше. BUG-1 и BUG-2 остаются закрытыми — код обоих не тронут этим
коммитом (только `safe-callback-url.ts` + тесты), полный прогон зелёный.

---

### 1. Обязательные команды

| Команда | Результат |
|---|---|
| `npm test -- --run` | **337 файлов / 4713 тестов — все зелёные.** Совпадает с цифрой из коммит-мессаджа `031f622`. Duration ~47s. |
| `npx tsc --noEmit` | 0 ошибок, exit code 0. |
| `npx eslint .` | **0 errors, 21 warnings** — то же число, что в раундах 1–2. В файлах диффа (`redirect/page.tsx:14`, `signin/page.tsx:52,54` — `@next/next/no-location-assign-relative-destination` на литеральных `window.location.href = "/admin/dashboard"` и т.п.) ровно 3 warning'а, все на строках вне этого коммита (сверено `git show --stat 031f622` — эти файлы коммитом не тронуты вообще). Отдельно проверил "лишний" `60:9` из грепа по файлу — это `src/app/auth/tg-callback/CallbackClient.tsx`, не файл этого PR (грep без якоря на имя файла склеил вывод двух разных блоков). |
| `SKIP_ENV_VALIDATION=1 npx next build` | Успешно, exit 0. `/for-team`, `/auth/signin`, `/auth/redirect` собраны корректно. Несвязанные pre-existing build-warnings про `instrumentation.ts` — как и в раундах 1–2. |

---

### 2. Мутация фикса BUG-3 — откат и проверка, что падают ровно ожидаемые тесты

Восстановил до-фиксовую версию `safe-callback-url.ts`
(`git show 031f622^:src/lib/safe-callback-url.ts`) поверх текущего дерева,
прогнал только `src/lib/__tests__/safe-callback-url.test.ts`, вернул фикс на
место (`git status` — чисто до и после):

```
Test Files  1 failed (1)
     Tests  5 failed | 11 passed (16)
```

Упавшие ровно те 5, что и должны — весь новый `describe("safeCallbackUrl —
свой origin с protocol-relative путём (BUG-3)")`, блок "отклоняет %s" (3
кейса: двойной слэш, глубокий путь с `query#hash`, `HTTPS://` в верхнем
регистре) + блок "отклоняет backslash-вариант %s" (2 кейса). Два соседних
теста в том же `describe` ("но обычный абсолютный URL своего origin
по-прежнему работает", "голый origin без пути схлопывается в корень") —
**прошли и без фикса**, потому что они не про уязвимость, а про то, что
легитимный кейс не сломан регрессией; это ожидаемо, не ложноотрицательный
результат. Все 11 старых тестов (раунды 1–2) — зелёные без изменений.
Ложных срабатываний нет, тесты не тавтологичны.

Диффом подтверждено, что откат — это ровно инверсия фикса (`git diff` между
до-фиксовым файлом и HEAD показывает только: `let candidate = raw` вместо
прямого возврата, `candidate = url.pathname + ...` вместо `return
url.pathname + ...`, и последующие 3 проверки читают `candidate` вместо
`raw`) — не более широкая правка, которая могла бы исказить mutation-check.

---

### 3. Мутация хопа «форма → POST /api/auth/email/send» (2 новых теста)

Мутировал `src/app/auth/signin/page.tsx`: `body: JSON.stringify({ email,
callbackUrl: rawCallbackUrl ?? undefined })` → `body: JSON.stringify({
email })`, прогнал только
`src/app/auth/signin/__tests__/magic-link-callback.test.tsx`, вернул на
место:

```
Tests  1 failed | 1 passed (2)
```

Упал ровно тест «кладёт callbackUrl из query в тело запроса письма» —
именно та ассерция, которую мутация ломает. Второй тест («без callbackUrl в
query поле не отправляется») закономерно прошёл и с мутацией: он проверяет
`body.callbackUrl` равен `undefined` при отсутствии query-параметра, а
мутация как раз и делает поле всегда отсутствующим — на этом конкретном
кейсе поведение мутанта и фикса совпадает по построению теста, это не
дефект теста (он покрывает другую ветку — «параметр не переживает
отсутствие», не «параметр не переживает наличие»). Оба теста вместе
корректно закрывают ранее найденный (раунд 2) непокрытый хоп.

---

### 4. BUG-3 — целевой поиск нового обхода (живой браузер + pure-function матрица)

**Живой стенд:** `npm run build` (SKIP_ENV_VALIDATION=1) → восстановил
`.next/standalone/.next/static` (`cp -r .next/static
.next/standalone/.next/static`) и `public/` → `node .next/standalone/server.js`
с `AUTH_TRUST_HOST=true AUTH_URL=http://localhost:3000` (без него NextAuth
v5 отвечает `UntrustedHost` 500 на голый `node server.js` — не баг PR, особенность
локального запуска standalone-сборки без прокси-заголовков) + `/tmp/e2e.env`
(`DATABASE_URL`, `REDIS_URL`). `/api/health` → 200 на всём протяжении
проверки.

**Оба вектора, что стреляли в раунде 2 — закрыты, повторено дважды:**

1. `/auth/redirect?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F%2Fevil.example.com`
   с активной сессией (`user@local`/`user`) — Playwright, перехват всех
   `request`-событий за время навигации: **ни одного запроса на хост
   `evil.example.com`**, `page.url()` в итоге `http://localhost:3000/`
   (корректный дефолт для роли USER).
2. `/auth/signin?callbackUrl=...` + обычный вход по паролю тем же
   пользователем: **ни одного запроса на `evil.example.com`**, `page.url()`
   → `http://localhost:3000/dashboard` (корректный дефолт).

*(Методологическая заметка: первый прогон моего же скрипта показал
`requests-to-evil=true` на обоих сценариях — это оказался ложный
срабатыватель в самой проверке: я матчил подстроку `"evil.example.com"` по
всему `req.url()`, а сам запрос на `/auth/redirect?callbackUrl=...evil.example.com`
естественно содержит эту подстроку вURL-энкодед query-параметре, никуда не
уходя. Пересобрал проверку на `new URL(u).hostname === "evil.example.com"`
и диагностическим прогоном с полным логом всех `request`/`framenavigated`
событий убедился, что реального запроса к этому хосту нет ни разу — только
внутренняя навигация `localhost:3000`. Уточняю явно, чтобы не выглядело,
что нашёл и скрыл регресс.)*

**Новые векторы (не проверялись явно в раунде 2), все против того же
`/auth/redirect` с активной сессией, ноль запросов на `evil.example.com` по
хосту во всех случаях:**

| Вектор | `raw` (пример) | Итог (pure-function) | Живой браузер |
|---|---|---|---|
| userinfo в абсолютном URL | `http://user:pass@localhost:3000//evil.example.com` | `null` (`url.origin` не включает userinfo, но и не спасает — `pathname` всё равно ловится проверкой `//`) | requests-to-evil-host=false, finalURL=`/` |
| явный порт 80 vs дефолтный | `http://localhost:3000:80//evil.example.com` | `null` | requests-to-evil-host=false, finalURL=`/` |
| percent-encoded `%2f%2f` | `http://localhost:3000/%2f%2fevil.example.com` | `"/%2f%2fevil.example.com"` (не `null`!) — но это буквальный путь на своём же origin, браузер не декодирует `%2f` в `/` для интерпретации protocol-relative | requests-to-evil-host=false, finalURL=`http://localhost:3000/%2f%2fevil.example.com` (страница 404 на своём домене, не редирект) |
| backslash в абсолютном URL | `http://localhost:3000/\evil.example.com` | `null` (`new URL()` нормализует `\`→`/`, дальше ловит путевая проверка) | requests-to-evil-host=false, finalURL=`/` |
| тройной слэш | `http://localhost:3000///evil.example.com` | `null` | requests-to-evil-host=false, finalURL=`/` |
| юникод fullwidth solidus `／` (U+FF0F) | `http://localhost:3000/／／evil.example.com` | `"/%EF%BC%8F%EF%BC%8Fevil.example.com"` — `new URL()` percent-encode'ит его как обычный символ пути, не как `/`; браузеры (в т.ч. Chromium) не трактуют этот символ как разделитель пути | requests-to-evil-host=false, finalURL остаётся на своём origin с percent-encoded путём |
| `about:blank` | — | `null` (не матчит `scheme://`, не начинается с `/`) | requests-to-evil-host=false |
| `javascript:alert(1)` | — | `null` | requests-to-evil-host=false |
| `data:text/html,hi` | — | `null` | requests-to-evil-host=false |
| `blob:http://localhost:3000/uuid` | — | `null` (не матчит `scheme://` — после `blob:` идёt `http:`, не `//`) | requests-to-evil-host=false |
| очень длинный путь (`/` + 5000 символов) | — | возвращается как есть (обычный длинный путь, не protocol-relative) | не проверял живым браузером — pure-function поведение корректно и ожидаемо, длина сама по себе не создаёт protocol-relative |
| очень длинный абсолютный URL с `//evil` (5000 симв. хоста) | `https://<origin>//` + `"e".repeat(5000)` + `.com` | `null` | не проверял живым — pure-function уже отклоняет |

Полная pure-function матрица (32 кейса, включая IPv6-подобную путаницу
`//[::1]`, разные схемы `ftp://`/`ws://` с тем же хостом, null-byte в
percent-encoded виде, `@`-confusion `https://evil.com/@delovoy-park.ru`,
поддомен-confusion `delovoy-park.ru.evil.com`) — воспроизведена отдельным
node-скриптом с копией текущей логики функции, свёрена построчно с
`src/lib/safe-callback-url.ts` (идентична). Ни один вход не вернул путь,
который браузер интерпретировал бы как переход на чужой хост.

---

### 5. Легитимные сценарии не сломаны

| Сценарий | Ожидание | Факт |
|---|---|---|
| Абсолютный URL своего origin, `/for-team`, через `/auth/redirect` (сессия уже есть) | → `/for-team` | `finalURL = http://localhost:3000/for-team` |
| Путь `/for-team` через `/auth/signin` + обычный вход по паролю (`user@local`) | → `/for-team` | `finalURL = http://localhost:3000/for-team` |
| Абсолютный URL своего origin, путь+query+hash (`/admin/cafe?tab=1#top`), через `/auth/redirect` под ролью с доступом (`admin@local`/`admin`) | → `/admin/cafe?tab=1#top` | `finalURL = http://localhost:3000/admin/cafe?tab=1#top` — точное совпадение, включая `#top` |
| Тот же путь+query+hash под ролью USER (`user@local`) | → страница открывается, но RBAC самого `/admin/cafe` (не `safeCallbackUrl`) отправляет на `/admin/forbidden`, сохраняя hash | `finalURL = http://localhost:3000/admin/forbidden#top` — ожидаемо, это RBAC-редирект админки, а не дефект санитайзера (`callbackUrl` был корректно принят и использован, просто у USER нет доступа к `/admin/cafe`) |
| Голый origin без пути | → `/` | `finalURL = http://localhost:3000/` |

---

### 6. BUG-1 и BUG-2 — не сломаны раундом 3

- **BUG-1** (control-байты в файле вместо escape-последовательностей):
  побайтовый скан всего `src/lib/safe-callback-url.ts` (тот же метод, что в
  раунде 2) — `0` совпадений на `3311` байтах текущего файла (файл вырос на
  ~700 байт за счёт нового докблока и `candidate`-логики, скан не завязан на
  длину). `file` показывает `Unicode text, UTF-8 text`, не `data`/`binary`.
- **BUG-2** (magic-link теряет `callbackUrl`): `git show --stat 031f622`
  подтверждает, что коммит фикса **не касается** ни одного из файлов цепочки
  BUG-2 (`validation.ts`, `send/route.ts`, `email-magic-link.service.ts`,
  `verify-email/route.ts`) — трогает только `safe-callback-url.ts` и два
  тестовых файла. Полный прогон (4713 тестов, включая все тесты цепочки
  BUG-2 из раунда 2) зелёный без исключений — независимого live-E2E на
  magic-link в этом раунде не делал, это избыточно при неизменном коде и
  зелёном регрессе.

---

## Итог раунда 3

- BUG-3 (open redirect в абсолютно-URL-ветке `safeCallbackUrl`) — **закрыт**,
  подтверждено дважды живым браузером на тех же векторах, что стреляли в
  раунде 2, плюс 10 новых векторов обхода (double-encoding, userinfo,
  explicit-port, юникод-слэш, `about:`/`javascript:`/`data:`/`blob:`,
  длинные значения) — ни один не дошёл до чужого хоста.
- Mutation-check обоих новых наборов тестов (5 регрессионных на BUG-3 + 2 на
  хоп формы) — падают ровно ожидаемые тесты, ни один лишний, ни один
  пропущенный.
- Легитимные сценарии возврата (свой origin, path+query+hash, голый origin,
  обычный путь) не сломаны, включая RBAC-пересечение (путь применяется
  корректно, дальнейший редирект на `/admin/forbidden` — поведение самой
  админки, не санитайзера).
- BUG-1 и BUG-2 остаются закрытыми.
- `npm test` (337/4713), `tsc --noEmit`, `eslint` (0 errors/21 pre-existing
  warnings), `next build` — все зелёные.

**Вердикт: PASS.**
