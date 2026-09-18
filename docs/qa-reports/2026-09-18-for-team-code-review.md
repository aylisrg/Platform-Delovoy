# Review: FOR TEAM — раздел в меню/подвале + фикс callbackUrl (PR #916)

Ветка `claude/vigilant-maxwell-2u6fb3`. Заказ владельца — устный (нет PRD):
«FOR TEAM в меню и подвале — ведёт на авторизацию и затем на раздел ДЛЯ
команды с общими сервисами которые у нас сейчас работают».

**Процессное замечание:** в брифинге на ревью указан один коммит `8aa8510`,
но к моменту ревью на ветке уже два коммита — `8aa8510` (фича) и
`9fde46e` (`test(e2e): обновить эталон cafe-mobile под ссылку FOR TEAM в
подвале`), прилетевший поверх во время ревью и уже запушенный в
`origin/claude/vigilant-maxwell-2u6fb3`. Разобрал обе версии; ниже — оценка
факта на HEAD (`9fde46e`). Второй коммит — не сюрприз, а прямое следствие
первого: новая строка в подвале `/cafe` (mobile, flex-col) сдвинула высоту
скриншота на 32px, `toHaveScreenshot` не сравнивает при несовпадении размера
— без этого коммита e2e visual-regression был бы красным. Коммит менял
только PNG-эталон (взят из артефакта самого CI, не перегенерён локально —
избегает рассинхрона версий chromium), `playwright.config.ts` (threshold,
maxDiffPixels) не тронут, остальные восемь эталонов не перезаписаны. Оценил
как обоснованный, не blocking.

## Вердикт: NEEDS_CHANGES

Единственная причина — `src/lib/safe-callback-url.ts` содержит бинарные
управляющие байты вместо текстовых escape-последовательностей, из-за чего
git (и GitHub PR-diff) считает файл бинарным и НЕ показывает его содержимое
в обычном ревью. Файл при этом реализует ядро security-фикса (open redirect)
этого самого PR — то есть человек-ревьюер на GitHub физически не может
прочитать код, который его просят одобрить. RBAC, сама логика санитайзера и
остальной диф — в порядке, см. ниже.

## Acceptance Criteria (из устного заказа)

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1: пункт FOR TEAM в навбаре лендинга (десктоп + мобильное меню) | PASS | `landing-delovoy-park.ru/components/navbar.tsx:17-20,108-110,208-214` |
| AC-2: пункт FOR TEAM в подвале | PASS | `landing-delovoy-park.ru/components/footer.tsx:15-22` + два инлайновых подвала (`dashboard/page.tsx:385-391`, `ps-park/page.tsx:449-456`) — весь список инлайновых футеров без общего `Footer` (`grep LegalFooterLinks`) закрыт целиком |
| AC-3: гостя ведёт на авторизацию | PASS | `src/app/(public)/for-team/page.tsx:35-37` — `redirect(/auth/signin?callbackUrl=%2Ffor-team)`, покрыто тестом `page.test.tsx:43-50` |
| AC-4: после логина возвращает на раздел «Для команды» | PASS (логика корректна) / см. Security | `signin/page.tsx:39-56`, `redirect/page.tsx:22-33`, оба через `safeCallbackUrl`; было: email/password-вход callbackUrl вообще игнорировал (только Telegram/VK его поддерживали) — это реальный баг, не scope creep, чинить его было необходимо именно для AC-4 |
| AC-5: раздел с сервисами, которые «сейчас работают» | PASS | `src/lib/team-services.ts` — только нестабы; `sauna` (stub, issue #915) исключён явно с комментарием и тестом (`team-services.test.ts:46-48`) |
| Побочное: не заводить лишние issues/фиксы вне заказа | PASS с оговоркой | issues #914/#915 не «чинятся» этим PR — корректно учтены как факт (см. Scope Check) |

## Scope Check

- Scope creep: **Нет** нового модуля (`src/modules/{slug}/` не создан), раздел
  явно задокументирован в `CLAUDE.md:143-155` как «не модуль», по аналогии с
  существующим паттерном (`legal`, `avito`).
- Фикс open redirect в `src/app/auth/signin/page.tsx` и
  `src/app/auth/redirect/page.tsx` — формально не заказан явно, но это тот же
  самый код, через который реализован заказанный round-trip (гость →
  `/auth/signin?callbackUrl=/for-team` → назад). Старая проверка
  `raw.startsWith("/")` в `redirect/page.tsx` пропускала `//evil.com` —
  живой open redirect, ещё **до** этого PR, в проде. Оставить его как есть,
  подключив новую фичу к тому же самому уязвимому коду, было бы хуже, чем
  исправить. Оцениваю как обоснованный, тесно связанный фикс (Scope guard
  #3 — компоновка связанных изменений в одном PR), не как scope creep.
  Формально стоило бы завести отдельный issue под сам факт уязвимости для
  трейсабилити — по факту трейсабилити есть (комментарии в коде + абзац в
  `CLAUDE.md:154`), не blocking.
- Второй коммит `9fde46e` (обновление e2e-эталона) — прямое следствие
  первого, не самостоятельная задача, никакого нового функционала не
  добавляет. Не scope creep.
- `payments` / `feedback` / `notifications` не в `ADMIN_SECTIONS` (issue
  #914) и `sauna` без реальной страницы (issue #915) — этот PR их **не
  чинит**, корректно с ними работает через `superadminOnly` (для первых
  трёх) и исключение из каталога (для `sauna`). Соответствует брифу: issues
  уже заведены отдельно, этот PR их не обязан закрывать.

## Архитектура

- Бизнес-логики в route handlers нет — `/for-team` не заводит новых API
  роутов вообще, только серверный компонент + `src/lib/team-services.ts`
  (чистые функции без сайд-эффектов, без БД).
- Переиспользует существующие RBAC-примитивы (`getUserAdminSections`,
  `hasAdminSectionAccess`) вместо реализации параллельной логики доступа —
  правильно, снижает риск дрейфа.
- Новых Prisma-моделей/миграций нет — уместно, раздел не хранит своих данных.

## RBAC — детальная проверка (главный риск по брифу)

Прогнал матрицу вручную поверх `src/lib/auth.config.ts:112-248` (реальный
гейт `authorized()`) и `src/lib/permissions.ts`:

- **USER** — `isTeamRole()` (`team-services.ts:217-219`) возвращает `false`,
  `visibleTeamServices` отдаёт `[]`, страница рисует `NoTeamAccess()` без
  единой ссылки на `/admin/*`. Подтверждено тестом
  `page.test.tsx:63-72` (рендерит дерево и проверяет реальные `href`, а не
  пропсы — ловит именно то, что дойдёт до пользователя).
- **MANAGER без грантов** — `getUserAdminSections` вернёт `[]`,
  `groups.length === 0` → `NoSectionsGranted()`, тоже без ссылок. Тест
  `page.test.tsx:89-98`.
- **MANAGER с грантами** — видит ровно выданные секции
  (`team-services.test.ts:65-68`, `page.test.tsx:76-87`), включая проверку
  что *битые* секции (`payments`/`notifications`), даже если бы их подсунули
  в `grantedSections` откуда-то ещё, всё равно не пройдут фильтр
  `superadminOnly` (`team-services.test.ts:70-74`) — то есть двойная защита:
  и `getUserAdminSections` их никогда не вернёт (не входят в
  `ADMIN_SECTION_SLUGS`, `permissions.ts:16-34`), и даже если бы вернул —
  `visibleTeamServices` их всё равно фильтрует по роли.
- **ADMIN** — тот же путь, что MANAGER (`authorized()` и
  `getUserAdminSections` не различают ADMIN/MANAGER) — код не различает их
  тоже. Корректно.
- **SUPERADMIN, `nedelovoy` без явного гранта** — `getUserAdminSections`
  (`permissions.ts:177-197`) для SUPERADMIN исключает
  `STRICT_ACCESS_MODULES` (`nedelovoy`) из «бесплатного» списка, добавляя
  его только если есть явный `AdminPermission`. `visibleTeamServices` просто
  доверяет этому списку (`granted.has(service.section)`), никакой
  собственной реализации strict-access не пишет — правильно, один источник
  правды. Тест `team-services.test.ts:76-91` бьёт именно оба случая (без
  гранта / с грантом). Отдельно проверил, что `/admin/nedelovoy` сам
  дублирует проверку (`src/app/admin/nedelovoy/page.tsx:40-42`,
  `hasAdminSectionAccess` + `forbidden()`) — даже если бы карточка
  протекла, страница всё равно не отдаст данные.
- **`payments` / `feedback` / `notifications`** (issue #914, нет в
  `ADMIN_SECTIONS`) — в `auth.config.ts:228` `SUPERADMIN` получает доступ к
  любому `/admin/*` безусловно (проверка секции для SUPERADMIN вообще не
  выполняется), поэтому «только SUPERADMIN» — это не консервативная
  выдумка `team-services.ts`, а точное отражение реального гейта. Для
  ADMIN/MANAGER путь `adminSections.includes(section)` (`auth.config.ts:236`)
  никогда не будет `true` для этих трёх строк, потому что
  `setUserAdminSections` (`permissions.ts:322-336`) фильтрует по
  `ADMIN_SECTION_SLUGS` и физически не даст создать `AdminPermission` с
  такой секцией. `superadminOnly: true` в `team-services.ts` — корректная
  прямая проверка `role === "SUPERADMIN"`, а не через `granted.has(...)`
  (которая для этих трёх секций всегда была бы `false` даже для
  SUPERADMIN, раз их нет в `ADMIN_SECTION_SLUGS`) — реализация это учла
  правильно (`team-services.ts:236-239`).
- Утечки не нашёл: карточки, которые роль не должна видеть, не рендерятся
  вообще (проверено рендером дерева в тестах, не только фильтрацией
  массива) — MANAGER/ADMIN никогда не увидит намёка на существование секций
  вне своих грантов на этой странице.

**Некритичное наблюдение (не blocking):** `/for-team` (как и уже
существующий `/api/admin/permissions/me`, который кормит боковое меню
админки) читает `getUserAdminSections()` живым запросом к БД, а реальный
гейт `authorized()` в `proxy.ts`/`auth.config.ts` проверяет
`auth.user.adminSections` — снимок, который обновляется только при логине
или явном `trigger === "update"` (`src/lib/auth.ts:79-115`). Если админ
только что выдал сотруднику новую секцию, а тот уже залогинен, карточка на
`/for-team` появится сразу (живые данные), а переход по ней ещё какое-то
время будет давать `/admin/forbidden` (гейт видит старый токен) — до
релогина/обновления сессии. Это не новый риск этого PR: `/for-team`
буквально повторяет уже существующий паттерн `/api/admin/permissions/me`
(`src/app/api/admin/permissions/me/route.ts:1-27`, «Used by the sidebar to
render only accessible navigation items»), то есть тот же зазор уже был в
проде для бокового меню админки. Отмечаю для полноты, не требую фикса в
этом PR.

## Санитайзер `callbackUrl` — атаки, которые проверил

`src/lib/safe-callback-url.ts` (логика; про кодировку файла — см. Security):

- `//evil.com`, `//evil.com/path` → `null` (raw[1] === "/") — тест есть.
- `/\evil.com`, `/\/evil.com` → `null` (raw[1] === "\\") — тест есть.
- `%2F%2Fevil.com` в query — `URLSearchParams.get()` декодирует до
  `//evil.com` ещё до вызова санитайзера → ловится тем же чеком. Не
  протестировано explicit, но логически то же покрытие, что и `//evil.com`.
- `/\t/evil.com`, `/for-team\n` → `null` (control-char regex, строка 45) —
  тест есть.
- Абсолютный URL чужого origin (`https://evil.com/phish`,
  `http://delovoy-park.ru.evil.com/`) → `null` — тест есть, origin сверяется
  через `new URL(...).origin`, а не строковым `startsWith`, поэтому
  «похожий на наш домен» хост (`delovoy-park.ru.evil.com`) не проходит.
- `javascript:alert(1)` → `null` (не начинается на `/`, нет `://`) — тест
  есть.
- `javascript://evil` (с двумя слэшами, формально проходит regex схемы) —
  вручную проверил в node: `new URL("javascript://evil").origin === "null"`
  (строка `"null"`, opaque origin для нестандартной схемы), сравнение с
  `new URL(origin).origin` (реальный origin) всегда `false` → отклоняется.
  Не покрыто unit-тестом — стоит добавить явный кейс, но сама реализация
  уже безопасна.
- `origin`, который передаётся в `safeCallbackUrl`, во всех вызывающих
  местах — `window.location.origin` (`signin/page.tsx:42`,
  `redirect/page.tsx:25`), то есть источник этого параметра не
  пользовательский ввод; сравнение origin не может быть подделано через
  сам `raw`.
- Абсолютный URL от `proxy.ts` (`request.nextUrl.href`,
  `auth.config.ts:219`) — схлопывается до пути на клиенте тем же кодом,
  origin совпадает (тот же домен) → пропускается, path+search+hash
  сохраняются. Тест `safe-callback-url.test.ts:15-19` покрывает.

Открытый редирект закрыт корректно, обычный сценарий возврата не сломан.

## Качество кода

- TypeScript strict, `any` не найден (`git diff ... | grep -iE ": *any\b|as any"` — пусто).
- ESLint на изменённых файлах — 0 ошибок, 5 pre-existing-style warning
  (`no-location-assign-relative-destination` на `window.location.href` —
  тот же паттерн уже использовался в этих файлах до PR для других веток
  редиректа, не новая практика).
- Prettier — чисто.
- `npx tsc --noEmit` — без ошибок.
- `npm run build` — проходит, `/for-team` собирается как `ƒ` (dynamic),
  соответствует `export const dynamic = "force-dynamic"`.
- Новых зависимостей в `package.json`/`package-lock.json` нет.
- Мутаций/API нет → `AuditLog` не требуется.

## Утечки данных

- `/for-team` не рендерит `session.user.id`, токены или чужие данные —
  только собственные `name`/`email` текущего пользователя (это не утечка,
  это его же данные).
- `robots: { index: false, follow: false }` в metadata + `Disallow: /for-team`
  в `public/robots.txt:7` + отсутствие в `src/app/sitemap.ts` — раздел не
  индексируется, что уместно (внутренняя точка входа).
- `force-dynamic` — верно, страница персонализирована по сессии, кэшировать
  нельзя.
- Список сервисов, доступных роли, не «утекает» пользователю с недостаточными
  правами — см. RBAC выше (рендер-тесты, не только фильтрация массива).

## Тесты

- `npm test -- --run`: **335 файлов / 4680 тестов — все зелёные.**
- Новые тесты: `safe-callback-url.test.ts` (9 кейсов, happy+error path),
  `team-services.test.ts` (14 кейсов, включая обе строгие ветки nedelovoy и
  «секция вне грида прав»), `for-team/__tests__/page.test.tsx` (7 кейсов,
  рендерит реальное дерево и читает `href`, мокает `auth`/`getUserAdminSections`
  через `importOriginal`, не подменяя саму бизнес-логику `team-services.ts`).
- Хороший инвариант в тестах: `superadminOnly стоит ровно на секциях вне
  грида прав` (`team-services.test.ts:50-57`) сверяется с реальным
  `ADMIN_SECTION_SLUGS` из `permissions.ts`, а не с захардкоженным списком —
  если #914 когда-нибудь закроют (добавят `payments` в `ADMIN_SECTIONS`) и
  забудут снять `superadminOnly` здесь, этот тест упадёт. Это снижает риск
  будущего RBAC-дрейфа, отмечаю как хорошую практику.
- e2e: `9fde46e` актуализирует эталон `cafe-mobile-chromium-linux.png` без
  ослабления threshold/maxDiffPixels — разобрано в разделе Scope Check.

## Security

**Обязательный итог: инцидент найден → см. вердикт NEEDS_CHANGES.**

- **Secrets leakage** — `grep -inE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по дифу даёт только `type EmailMode = "password" | "magic-link"` (тип UI-состояния, не секрет). Чисто.
- **RBAC** — см. раздел выше, полное соответствие `authorized()`, включая strict-access и известные пробелы (#914). OK.
- **Injection** — нет raw SQL, нет `dangerouslySetInnerHTML`, весь пользовательский ввод (`callbackUrl`) проходит через `safeCallbackUrl` до использования в навигации. OK.
- **Supply chain** — новых зависимостей нет. OK.
- **Dangerous ops** — нет `rm -rf`/force-push/деструктивных миграций (миграций нет вообще). OK.
- **Инцидент (blocking):** `src/lib/safe-callback-url.ts` содержит буквальные
  управляющие байты (NUL `0x00`, `0x1F`, `0x7F`) внутри regex-литерала на
  строке 45 (`/[\x00-\x1f\x7f]/`) — не текстовые escape-последовательности
  `\`+`x`+`0`+`0`, а настоящие control bytes прямо в исходнике. Проверено
  побайтово (`od`/Python `bytes`), не гипотеза. Следствие:
  `git diff origin/main...HEAD -- src/lib/safe-callback-url.ts` выдаёт
  `Binary files /dev/null and b/src/lib/safe-callback-url.ts differ` — то
  есть **ни один построчный diff-вьюер (в т.ч. GitHub PR UI) не покажет
  содержимое этого файла**, только «Binary file not shown». Само ревью,
  которое сейчас идёт, устроено так, чтобы поймать именно такие вещи —
  и в данном случае это файл с самим security-фиксом. Функционально код
  работает как задумано (юнит-тесты, ESLint, `tsc --noEmit`, Prettier — все
  чисто, потому что инструменты транспиляции корректно едят control-байты в
  UTF-8), но хранить исходник в таком виде нельзя: это (а) прячет код от
  человека-ревьюера на GitHub, (б) хрупко относительно любых
  текстовых/патч-инструментов, которые могут иначе обработать NUL-байт.
  **Исправление:** переписать строку 45, использовав буквальный текст
  escape-последовательностей `\x00`, `\x1f`, `\x7f` (четыре печатных символа
  каждая — обратный слэш, `x`, две цифры), а не сырые control-байты.
  Поведение регулярного выражения не изменится — значит эквивалентности
  тестов после фикса тоже не изменится.

## Что исправить (NEEDS_CHANGES)

1. **`src/lib/safe-callback-url.ts:45`** — заменить сырые control-байты
   (`0x00`, `0x1F`, `0x7F`) внутри `/[<byte>-<byte><byte>]/` на текстовые
   escape-последовательности `\x00`, `\x1f`, `\x7f`. Пересохранить файл как
   обычный UTF-8 текст без control-символов и убедиться, что
   `git diff origin/main...HEAD -- src/lib/safe-callback-url.ts` показывает
   построчный diff, а не `Binary files ... differ`. После фикса — прогнать
   `npm test -- --run src/lib/__tests__/safe-callback-url.test.ts` (должно
   остаться 9/9 зелёных, поведение не меняется).

Необязательно, но стоит рассмотреть заодно (не blocking, не требую для PASS):
2. Добавить в `safe-callback-url.test.ts` кейс `javascript://evil` (двойной
   слэш) — уже безопасно по коду, но покрытия на этот конкретный обход схемы
   с `://` пока нет.

## Что хорошо

- RBAC-каталог `team-services.ts` не изобретает свою логику доступа, а
  целиком опирается на существующие `getUserAdminSections`/`isTeamRole`,
  включая корректную обработку strict-access `nedelovoy` и известного
  пробела `payments`/`feedback`/`notifications` (#914) — ровно так, как
  просил бриф ревью.
  Заглушка `sauna` (#915) осознанно исключена из каталога с комментарием и
  тестом — не плодит вторую битую ссылку.
- Тест `superadminOnly стоит ровно на секциях вне грида прав` сверяется с
  реальным источником правды (`ADMIN_SECTION_SLUGS`), а не с копией списка —
  хорошая защита от будущего дрейфа.
- Открытый редирект в `/auth/redirect` (использовавший
  `startsWith("/")`) был реальной уязвимостью в проде ещё до этого PR —
  фикс уместен и тесно связан с задачей, а не «заодно улучшил».
- Второй коммит (обновление e2e-эталона) хорошо задокументирован: источник
  скриншота — артефакт самого CI, а не локальная перегенерация, что снимает
  риск рассинхрона версий chromium; threshold/maxDiffPixels не тронуты.
- Тесты пишут через рендер дерева (`renderToStaticMarkup` + сбор `href`), а
  не через инспекцию пропсов — ловят именно то, что реально дойдёт до
  DOM/пользователя.

---

## Раунд 2

Три новых коммита поверх HEAD раунда 1 (`9fde46e`): `e99d171` (фикс моей
находки), `fc7b1f5` (коммит отчёта раунда 1), `ed89656` (новый функциональный
фикс от qa-engineer — magic-link терял `callbackUrl`).

## Вердикт: PASS

### 1. Находка раунда 1 — закрыта

`src/lib/safe-callback-url.ts` (коммит `e99d171`):

- `git diff origin/main...HEAD -- src/lib/safe-callback-url.ts` теперь
  построчный (`48 insertions`), не `Binary files ... differ`.
- `file src/lib/safe-callback-url.ts` → `JavaScript source, Unicode text,
  UTF-8 text` (было бы «data»/binary при наличии сырых control-байтов).
- Строка 45 побайтово (`od -c`): `/   [   \   x   0   0   -   \   x   1   f
  \   x   7   f   ]   /` — литеральный текст `\x00-\x1f\x7f` (backslash + `x`
  + две цифры), не сырые байты `0x00`/`0x1f`/`0x7f`.
- Поведение регулярки не изменилось: проверено в node —
  `/[\x00-\x1f\x7f]/.test("/for-team\n")` → `true`,
  `.test("/for-team\t")` → `true`, `.test(String.fromCharCode(127))` →
  `true`, `.test("/for-team")` → `false`. Тот же диапазон, что и до фикса.
- `src/lib/__tests__/safe-callback-url.test.ts` не изменился (не входит в
  diff `e99d171`) — те же 9 кейсов из раунда 1, все зелёные.

Инцидент полностью устранён.

### 2. Новый фикс — `ed89656` (magic-link теряет `callbackUrl`)

**Возможность утечки — оба конца проверены:**

- **Запись в Redis** (`src/app/api/auth/email/send/route.ts:33-42`) —
  `callbackUrl` из тела запроса нормализуется через `safeCallbackUrl(callbackUrl,
  appUrl)` ДО вызова `generateAndStoreMagicLink(normalized, password,
  safeTarget)`. Единственный вызывающий этой функции в проде — этот роут
  (`grep generateAndStoreMagicLink\( src` вне тестов даёт один результат).
  `generateAndStoreMagicLink` пишет в Redis только если третий аргумент
  truthy (`src/modules/auth/email-magic-link.service.ts:97`) — `null` от
  санитайзера просто ничего не пишет. Не­санитайзированное значение до Redis
  дойти не может.
- **Чтение из Redis → редирект** (`src/app/api/auth/verify-email/route.ts:42-46`)
  — `consumeMagicLinkCallbackUrl(token)` (get+del) прогоняется второй раз через
  `safeCallbackUrl(stored, appUrl)` перед подстановкой в `Location`; итоговое
  значение дополнительно проходит `encodeURIComponent`. Единственный вызывающий
  вне тестов — этот роут.
  На стороне клиента (`src/app/auth/signin/page.tsx:39-46`) параметр из
  `?callbackUrl=` читается через `useSearchParams` и **прогоняется через
  `safeCallbackUrl` третий раз** (с `window.location.origin`) прямо перед
  `window.location.href = target` — тот же путь, что уже использовался для
  password/Telegram/VK логина в первом коммите PR (не новый код раунда 2, но
  именно он замыкает cepочку для magic-link). Итого: три независимых прогона
  санитайзера на разных этапах (запись → чтение-редирект → клиентская
  навигация), путей в обход не нашёл — оба вызывающих места (запись/чтение)
  единственные в кодовой базе.
- **Адрес НЕ попадает в само письмо** — подтверждено кодом
  (`sendMagicLinkEmail` в `email-magic-link.service.ts:137-149` строит `url`
  только из `appUrl`, `token`, `email`; `callbackUrl` в эту функцию не
  передаётся вообще) и тестом
  `email-magic-link.service.test.ts:475-490` («сам адрес в ссылку письма не
  попадает» — сериализует объект, переданный в `sendTransactionalEmail`, и
  проверяет отсутствие подстрок `for-team`/`callbackUrl`).
- Атаки на санитайзер те же, что в раунде 1 (`//evil.com`, `/\evil.com`,
  `https://evil.com/...`, `javascript:...`) — покрыты новыми тестами по обе
  стороны Redis: `send/__tests__/route.test.ts:86-95` (до записи) и
  `verify-email/__tests__/route.test.ts:127-141` (после чтения) — в обоих
  случаях чужой адрес отбрасывается, а сам вход (письмо/редирект) не ломается.

**Существующее поведение не сломано:**

- Оба новых поля (Zod `callbackUrl`, третий параметр
  `generateAndStoreMagicLink`) — опциональны. `generateAndStoreMagicLink("email")`
  и `generateAndStoreMagicLink("email", password)` (старые сигнатуры без
  третьего аргумента) по-прежнему работают — все 10 существующих тестов в
  `describe("generateAndStoreMagicLink", ...)` не менялись и остаются
  зелёными.
- Ветка `redisAvailable === false`: `consumeMagicLinkCallbackUrl` возвращает
  `null` без обращения к Redis (`email-magic-link.service.ts:126`, тест
  «Redis недоступен — вход не ломается, просто нет адреса»), а запись
  пропускается тем же условием `callbackUrl && redisAvailable`
  (`email-magic-link.service.ts:97`) — вход по magic-link не блокируется,
  просто без адреса возврата (деградация, не отказ), симметрично уже
  существующему fail-open поведению для пароля/кулдауна в этом же файле.
- Полный прогон `npm test -- --run` (сам, не со слов брифа): **336 файлов /
  4703 теста — все зелёные**, совпадает с числом из коммит-мессаджа.
  `npx tsc --noEmit` — 0 ошибок. `npx eslint` по изменённым `.ts`/`.tsx` —
  0 errors, 5 warnings, все pre-existing (`@next/next/no-location-assign-
  relative-destination` на `window.location.href = "/admin/dashboard"` и
  т.п., те же файлы/паттерн, что в раунде 1, не на новых строках).

**Redis-ключи и TTL:**

- Префиксы `magic-link:pw:`, `magic-link:cb:`, `magic-link:cooldown:`,
  `magic-link:signin:` — все с разными литералами сразу после `magic-link:`,
  коллизий по построению нет (точное совпадение ключа, не префиксный поиск).
- TTL нового ключа — `TOKEN_TTL_SECONDS` (15 минут,
  `email-magic-link.service.ts:8,97-102`) — та же константа, что и у самого
  `VerificationToken` (строка 65: `new Date(Date.now() + TOKEN_TTL_SECONDS *
  1000)`), то есть срок жизни адреса возврата совпадает со сроком жизни
  токена буквально по общей константе, не по совпадению чисел. Подтверждено
  тестом `email-magic-link.service.test.ts:446-460` (`call?.[3]` ===
  `15 * 60`).
- Чтение одноразовое: `consumeMagicLinkCallbackUrl` делает `get` и, если
  значение есть, `del` (`email-magic-link.service.ts:124-130`) — не атомарно
  (`GETDEL`), в отличие от соседнего `consumeSignInNonce`, который использует
  `redis.getdel` явно ради атомарности при конкурентных попытках. Разница
  объяснима отличающейся ценой гонки: `consumeSignInNonce` защищает от replay
  самой аутентификации (двойной вход по одному nonce), а
  `consumeMagicLinkCallbackUrl` — вспомогательное значение для редиректа;
  худший сценарий состязания — адрес возврата прочитается дважды до удаления
  и попадёт в оба конкурентных редиректа, что не расширяет доступ и не хуже,
  чем если бы его не было вовсе. Не blocking, но стоит унифицировать при
  случае с соседней функцией на `getdel` — оставляю как наблюдение, не
  исправление к этому PR.

**Мок в существующем тесте `verify-email/__tests__/route.test.ts`:**

Сверил построчно (`git show ed89656~1:...` vs текущий файл) — все 7 исходных
тестов (`happy path`, `invalid params`, `TOKEN_INVALID`, `TOKEN_EXPIRED`,
`REDIS_UNAVAILABLE`) не тронуты ни на одну строку внутри `describe("GET
/api/auth/verify-email", ...)`. Единственное изменение — добавление
`mockConsumeCallbackUrl` в `vi.hoisted`/`vi.mock` и дефолт
`mockConsumeCallbackUrl.mockResolvedValue(null)` в общий `beforeEach`
(строка 22) — это ослабляет прежние тесты ровно в той мере, в какой они
вообще не проверяли поведение `callbackUrl` (её тогда не существовало), и не
меняет ни одного из прежних assert'ов. Новые 4 теста добавлены отдельным
`describe` ниже, не смешаны со старыми.

### 3. Scope creep

Оцениваю фикс как **не scope creep**. AC-3 из раунда 1 («после логина
возвращает на раздел „Для команды“ — для всех способов входа») уже был
частью заявленного устного заказа и раунда 1 ревью; qa-engineer обнаружил,
что для одного из четырёх заявленных способов входа (magic-link) это
свойство не работало вообще — то есть фикс закрывает уже принятый в PR
критерий, а не добавляет новый функционал сверх заказа. Изменения
локализованы строго вокруг этого пути (schema-поле, генерация/чтение
Redis-ключа, форма отправки, обработка редиректа) — новых поверхностей,
экранов или прав доступа не добавлено. Сопутствующие артефакты
(`docs/qa-reports/2026-09-18-for-team-qa-report.md`,
`.claude/feedback/qa-patterns.md`) — процессные, не код продукта.

### Security

- **Secrets leakage** — `grep -inE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'`
  по полному дифу `origin/main...HEAD` (исключая qa-отчёты и feedback-файл)
  даёт только имена переменных/полей (`password`, `token`, `NEXTAUTH_URL`
  как имя env-переменной, `EmailMode = "password" | "magic-link"`) — ни
  одного значения секрета. Чисто.
- **RBAC** — фикс не создаёт новых эндпоинтов и не меняет проверки роли;
  RBAC-каталог `/for-team` не тронут этими тремя коммитами. OK (полная
  проверка — в разделе раунда 1 выше).
- **Injection / open redirect** — ядро проверки раунда 1: control-байты в
  `safe-callback-url.ts` теперь читаемый текст, поведение подтверждено
  побайтово и в node. Новый round-trip через почту (magic-link) проверен на
  обоих концах (запись в Redis / чтение из Redis) — чужой адрес не проходит
  ни на запись, ни на редирект; сам адрес не покидает сервер через письмо.
  Redirect-цель дополнительно проходит `encodeURIComponent` — CRLF/URL-инъекция
  в `Location` исключена вдобавок к отсечению control-байтов санитайзером.
- **Supply chain** — новых зависимостей нет.
- **Dangerous ops** — нет `rm -rf`/force-push/деструктивных миграций.

Инцидентов не найдено.

### Тесты (сам прогнал, не по цифрам из брифа)

- `npm test -- --run`: **336 файлов / 4703 теста — все зелёные.**
- `npx tsc --noEmit`: чисто.
- `npx eslint` на изменённых `.ts`/`.tsx`: 0 errors, 5 warnings — все
  pre-existing (см. выше).
- `git status --short`: чистое рабочее дерево, ничего не пропущено при
  коммитах.

### Что хорошо (дополнительно к разделу раунда 1)

- Дизайн-решение не класть `callbackUrl` в саму ссылку письма (а только в
  Redis рядом с токеном) снижает поверхность атаки через пересылаемые/
  цитируемые письма — обосновано в коммите и подтверждено тестом, а не
  только комментарием.
- Двойная (по факту тройная, считая уже существующий клиентский прогон)
  нормализация на разнесённых во времени этапах (запись/чтение) — правильный
  выбор для round-trip через внешнюю систему (почту), которую нельзя
  контролировать между записью и чтением.
- Мутационная проверка не запускалась мной отдельно, но тесты написаны на
  поведение (`storedCallbackUrl()` читает реальный третий аргумент мока,
  `url.searchParams.get(...)` читает реальный `Location`), а не на факт
  вызова функции — такой тест упадёт, если фикс окажется забыт или отключен.
