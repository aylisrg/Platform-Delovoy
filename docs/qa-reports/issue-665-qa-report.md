# QA-отчёт: Issue #665 — комментарий и email в quick-форме бронирования (US-1, Epic #442)

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-665-comment-email-quick-form`, HEAD `0937028`, поверх
  `main` (`b9d3925`). Уже запушена в origin, не смержена.
- PRD: `docs/requirements/2026-08-16-booking-calendar-operator-ux-prd.md`,
  US-1 (AC-1..AC-7). Обе quick-формы (десктоп-поповер + мобильный шит) обоих
  модулей (`gazebos`, `ps-park`) получают необязательные поля «Комментарий» и
  «Email», которые пишутся в `Booking.metadata` (не в `User.email`) и
  показываются в карточке брони и в ленте «История».
- Code review уже пройден с вердиктом PASS
  (`docs/qa-reports/issue-665-review.md`, прочитан и учтён). Ниже — независимая
  перепроверка: собственный прогон тестов/типов/линта, собственный
  mutation-тест на 3 независимых правках, самостоятельное чтение
  `pay-online/route.ts` по флагу ревьюера, самостоятельная проверка AC-6 через
  `upsertClientByPhone`, отдельная находка (см. «Дополнительное наблюдение»).
- `git diff main...HEAD --stat` — ровно 26 файлов (15 production + 11 test),
  `528(+) 6(-)`. Совпадает с заявленным скоупом: `types.ts`×2, `validation.ts`×2,
  `service.ts`×2, `admin-book/route.ts`×2, `booking/history.ts`,
  `quick-booking-popover.tsx`×2, `mobile-booking-sheet.tsx`×2,
  `booking-detail-card.tsx`×2, + тесты на каждый.

## Регрессия (собственный прогон)
```
npm test -- --run   → 286 test files passed (286), 3990 tests passed (3990)
npx tsc --noEmit     → чисто, пустой вывод
npm run lint         → 0 errors, 16 warnings — все pre-existing, ни один в
                        изменённых 26 файлах (session-bill-modal.tsx,
                        sidebar.tsx, vk-community-banner.tsx, ChatWindow.tsx,
                        useChatList.ts, messenger/types.ts,
                        notifications/service.ts, telephony/novofon-client.ts)
```
Числа совпадают с заявленными в review-отчёте. `git status --short` после
прогона (и после всех мутаций, см. ниже) — только untracked
`docs/qa-reports/issue-665-review.md` (не мой файл, ревьюера).

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | Десктопные `quick-booking-popover.tsx` (gazebos + ps-park) рендерят `<textarea maxLength={500}>` «Комментарий (необязательно)», байт-в-байт идентично в обоих модулях. |
| AC-2 | PASS | `mobile-booking-sheet.tsx` (gazebos + ps-park) рендерят то же поле, идентичное по `maxLength`, сбрасывается вместе с `clientName`/`clientPhone` в `useEffect` при переоткрытии шита. Паритет desktop/mobile подтверждён построчным сравнением обоих компонентов. |
| AC-3 | PASS (с уточнением, не блокирует) | Оба поля/формы/модуля рендерят `<input type="email">`. Серверная валидация формата — `z.string().email("Некорректный email").max(200).optional()` в обеих схемах, malformed email отклоняется 400 с понятным сообщением, которое UI показывает через `setError`. Уточнение: десктопные поповеры обёрнуты в `<form onSubmit={...}>` (проверено `grep`) → получают бесплатную HTML5 pre-submit блокировку от браузера; мобильные шиты используют `<button type="button" onClick={handleSubmit}>` без `<form>` (проверено) → на мобильном невалидный email отклоняется только серверным round-trip, без клиентского pre-flight. Текст AC («некорректный email блокирует отправку с понятной ошибкой») формально выполнен на обеих поверхностях — бронь не создаётся, то же сообщение показывается — но это небольшая, не задокументированная desktop/mobile асимметрия UX, не функциональный провал. Согласен с наблюдением ревьюера. |
| AC-4 | PASS | `adminCreateBookingSchema` (`src/modules/gazebos/validation.ts:172`) и `adminCreatePSBookingSchema` (`src/modules/ps-park/validation.ts:41`) оба получили `email: z.string().email(...).max(200).optional()`, зеркалируя формат уже существующей публичной `createBookingSchema`. |
| AC-5 | PASS | Comment/email пишутся в `Booking.metadata` (`createAdminBooking`, оба `service.ts`), читаются обратно в `booking-detail-card.tsx` (comment — уже было, email — новый `mailto:`-блок) и теперь в «Истории»: `history.ts` получил `case "booking.admin_create"`, читающий `meta.comment`/`meta.email` из metadata, записанного `logAudit` в обоих `admin-book/route.ts`. Убедился, что новый `case` вставлен, не тронув остальные ветки `buildDetails` и `default`-фолбэк — подтверждено полным `git diff` файла. |
| AC-6 | PASS | Email пишется только в `Booking.metadata.email`, никогда в `User.email`. Независимо перепроверил (не полагаясь на review-отчёт): `upsertClientByPhone` (`src/modules/clients/service.ts:951-993`) принимает `opts: { name, source }` — параметра `email` в сигнатуре и теле функции нет вообще, ни в ветке `existing` (patch только `name`/`source`), ни в ветке `create` (`prisma.user.create` данные — `role/phone/phoneNormalized/name/source`). Оба вызывающих места (`gazebos/service.ts:513-516`, `ps-park/service.ts:1033-1036`) передают только `{ name: clientName, source: "..." }` — `email` туда физически не долетает. Учётной записи/логина email не создаёт. |
| AC-7 | PASS | Оба `comment: z.string().max(500).optional()` и `email: z.string().email(...).max(200).optional()`. UI включает их в POST-тело только через `...(x.trim() && { x: x.trim() })` — во всех 4 формах. Отсутствие полей не блокирует бронь: подтверждено тестами `service.test.ts` («не пишет email в metadata, когда не указан») для обоих модулей, и собственным mutation-тестом (см. ниже). |

## Собственный mutation-тест — 3 независимые правки, каждая обратима

Не полагаясь на review-отчёт, лично откатывал по одной правке, гонял целевой
тест-файл, затем восстанавливал файл через `git checkout --` и проверял
`git status`/`git diff`.

**Мутация (a) — `src/modules/gazebos/validation.ts`, убрал `.email()` из
`email`-поля `adminCreateBookingSchema` (строка 172, оставил только
`z.string().max(200).optional()`):**
```
npx vitest run src/modules/gazebos/__tests__/validation.test.ts
FAIL > adminCreateBookingSchema > rejects a malformed email (issue #665)
  AssertionError: expected true to be false
Tests  1 failed | 58 passed (59)
```
Упал ровно новый тест на malformed email, остальные 58 (включая соседний тест
«accepts a valid optional email» и «accepts input without email») остались
зелёными — тест не тавтологичен, реально пингует `.email()`-валидатор.
Восстановил `git checkout -- src/modules/gazebos/validation.ts` —
`git diff` пусто, обе строки `email: z.string().email(...)` (гостевая и
admin-схема) на месте.

**Мутация (b) — `src/modules/booking/history.ts`, убрал целиком
`case "booking.admin_create": { ... break; }` из `buildDetails`:**
```
npx vitest run src/modules/booking/__tests__/history.test.ts
FAIL > показывает комментарий и email в записи о создании админом (issue #665)
  AssertionError: expected [] to include 'Комментарий: VIP-гость'
Tests  1 failed | 10 passed (11)
```
Упал ровно новый тест; тест «не показывает пустые Комментарий/Email» остался
зелёным (ожидаемо — с удалённым `case` и без `case` details тоже пуст, так
как `meta.reason` не задан в тестовых данных). Восстановил файл —
`git diff` пусто, `case` на месте, `npx vitest run` того же файла снова 11/11.

**Мутация (c) — `src/modules/ps-park/service.ts`, убрал строку
`...(email && { email }),` из `metadata` в `createAdminBooking` (строка 1111):**
```
npx vitest run src/modules/ps-park/__tests__/service.test.ts
FAIL > сохраняет email в metadata, когда указан (issue #665)
  expect(prisma.booking.create).toHaveBeenCalledWith(...) — metadata больше не
  содержит email вовсе (объект вернулся без ключа email)
Tests  1 failed | 119 passed (120)
```
Упал ровно новый тест; тест «не пишет email в metadata, когда не указан»
остался зелёным (ожидаемо — без email и до, и после мутации). Восстановил
`git checkout -- src/modules/ps-park/service.ts` — `git diff` пусто, строка
`...(email && { email }),` на месте.

**Итог**: после всех трёх мутаций и восстановлений `git status --short` /
`git diff main...HEAD --stat` идентичны состоянию до начала mutation-теста
(тот же `26 files changed, 528(+) 6(-)`, плюс untracked review-файл
ревьюера — не мой). Полный `npm test -- --run` после восстановления —
286/286 файлов, 3990/3990 тестов, зелёно.

Не мутировал отдельно четвёртую зеркальную пару (`gazebos/service.ts` email-
спред, `ps-park/validation.ts` `.email()`) — их ассерты структурно идентичны
уже провалившимся (тот же паттерн зеркалирования между модулями,
подтверждённый построчным `diff`), откат дал бы тот же результат.

## Независимая проверка флага ревьюера: `pay-online` резолвит email из `User`, не из `metadata`

Прочитал `src/app/api/ps-park/bookings/[id]/pay-online/route.ts` лично, не
доверяя формулировке из review-отчёта:

```
const user = booking.userId
  ? await prisma.user.findUnique({
      where: { id: booking.userId },
      select: { email: true, phone: true },
    })
  : null;
...
customerEmail: user?.email ?? null,
customerPhone: user?.phone ?? booking.clientPhone,
```

Подтверждено: `customerEmail` резолвится из `User.email` (строка 70), не из
`booking.metadata.email`. Обратите внимание на асимметрию с телефоном:
`customerPhone` уже имеет фолбэк на `booking.clientPhone`, когда `User.phone`
пуст, а `customerEmail` аналогичного фолбэка на `booking.metadata.email` не
имеет. Поскольку `createAdminBooking`/`upsertClientByPhone` никогда не пишут
`User.email` (см. AC-6 выше), email, введённый через новую quick-форму, на
сегодня невидим для `pay-online` — `customerEmail` резолвится в `null`, и
54-ФЗ чек падает на `customerPhone`.

**Флаг ревьюера подтверждаю как реальный, не домысел.** Ни один AC-1..AC-7 не
требует прокидки в `pay-online`/`createOnlinePayment` — PRD прямо выносит это
за скоуп US-1 («используется только как контакт/для чека, по аналогии с
гостевой публичной бронью» — сама гостевая ветка тоже не персистит email в
`metadata`, только транзиентно потребляет его в `resolvePaymentContact()`).
Не чиню это в рамках QA этой задачи — оставляю как обоснованный follow-up
(будет заведён отдельным issue после этого отчёта), не блокирую PASS.

## Дополнительное наблюдение (не блокирует PASS, не в скоупе #665)

При чтении `history.ts` для проверки AC-5 заметил отдельный, не связанный с
флагом ревьюера, потенциальный дефект в **уже существующей** (до #665) логике
дедупликации синтетической записи о создании:

```
const hasCreation = entries.some((e) => e.action.startsWith("booking.create"));
```

`"booking.admin_create".startsWith("booking.create")` → `false` (проверено
`node -e`), поэтому для брони, созданной через админ-quick-форму (журнал
содержит `booking.admin_create`, не `booking.create`), `hasCreation` всегда
ложно, и в конец ленты дописывается синтетическая запись «Бронь создана» —
**в дополнение** к настоящей записи «Бронь создана администратором» из
audit-log. То есть лента истории для админ-созданных броней потенциально
показывает два «создания» вместо одного.

Проверил `git show main:src/modules/booking/history.ts` — и
`ACTION_LABELS["booking.admin_create"]`, и строка `hasCreation` с этим же
`startsWith`-условием существовали на `main` **до** ветки #665 без изменений;
`case "booking.admin_create"` в `buildDetails` — единственное, что добавил
#665. Это не регрессия, внесённая этой веткой, и не тот баг, что flaг
ревьюера про `pay-online` — отдельная, независимо найденная, пред-существующая
находка. Она не мешает AC-5 (комментарий/email всё равно видны в записи
«Бронь создана администратором»), поэтому не блокирует вердикт этой задачи —
но заведу отдельный follow-up issue вместе с `pay-online`-находкой, раз оба
реальны и не разовые опечатки.

## Спот-чек новых тест-файлов на мобильные шиты (0 предыдущего покрытия)

`mobile-booking-sheet.test.tsx` для обоих модулей — совершенно новые файлы (у
компонентов не было тестов вообще до #665). Прочитал оба целиком:
- Рендерятся под `// @vitest-environment jsdom`, мокируют только
  `next/navigation` (`useRouter`) — единственная внешняя зависимость,
  вызываемая компонентом на верхнем уровне. `fetch` стабится через
  `vi.stubGlobal`. Прогон (`npm test -- --run`, выше) подтверждает — рендерится
  и работает под jsdom без недостающих моков.
- Каждый файл — ровно 2 теста: «отправляет заполненные комментарий и email» и
  «не отправляет comment/email, когда поля пустые». Оба сфокусированы строго
  на новых полях (AC-1/AC-2/AC-7), не пытаются стать полным тест-сьютом
  компонента (не тестируют существующие до #665 клиентские поля/логику типа
  выбора длительности, дефолтного времени и т.п.) — это не scope creep, ровно
  то покрытие, что нужно для issue.
- Байт-в-байт идентичная структура между gazebos/ps-park версией (плейсхолдеры
  `"Например, Иван"`/`"guest@example.com"`/`"Пожелания гостя, особые
  условия…"` совпадают дословно), подтверждает паритет между модулями и на
  уровне тестов, не только компонентов.

## Паритет desktop/mobile × gazebos/ps-park

Построчно сравнил все 4 диффа компонентов и их тестов:
- Поле email: `<input type="email">`, `placeholder="Email (необязательно)"`
  (desktop) / `"guest@example.com"` (mobile) — идентично между модулями,
  различие desktop/mobile — намеренный дизайн (лейбл+инпут на мобильном вместо
  голого инпута на десктопе), не расхождение поведения.
- Поле comment: `<textarea maxLength={500} rows={2}>` — идентичный лимит и
  разметка во всех 4 поверхностях.
- Оба поля включаются в тело запроса только через `...(x.trim() && { x: x.trim() })`
  — идентичный паттерн omission-when-empty во всех 4 формах.
- Пред-существующее (до #665) расхождение `clientPhone` (обязателен у
  gazebos, опционален у ps-park) — не тронуто этой веткой, оба `diff`
  подтверждают: изменения `clientPhone`-строк в diff нет, #665 корректно не
  унифицировал то, что не входило в его AC.

## Security-кейсы

- **RBAC**: не изменён на обоих роутах — `auth()` → `hasRole(MANAGER)` →
  `requireAdminSection(session, "gazebos"|"ps-park")`, в этом порядке, до
  вызова сервиса. Новых эндпоинтов нет, существующий гейт диффом не тронут —
  подтверждено полным чтением обоих `admin-book/route.ts`.
- **Data leakage**: `grep -rniE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'`
  по диффу — 0 совпадений. `email`/`comment` доступны только через уже
  RBAC-огороженные admin-only поверхности (карточка брони, история, audit-лог)
  — тот же периметр, что уже был у `clientName`/`clientPhone`, новой публичной
  поверхности утечки нет.
- **XSS/injection**: React экранирует текстовый JSX по умолчанию. Единственный
  атрибут-вектор — `<a href={`mailto:${email}`}>` — достижим только для
  значений, прошедших `.email()`-валидацию на сервере (email физически не
  попадёт в БД, если не прошёл Zod); React также экранирует значение атрибута
  при рендере. Векторов обхода не найдено.
- **Supply chain**: `package.json`/`package-lock.json` не тронуты — 0 новых
  зависимостей.
- **Rate limiting / SQL-инъекции**: без изменений — Prisma параметризует все
  запросы, оба роута уже находятся за существующим rate-limit'ом admin-цепочки
  (не публичные).

Security-инцидентов не найдено.

## Edge cases

- Пустой email/comment — не блокирует создание брони (AC-7, подтверждено
  `service.test.ts` для обоих модулей + мутацией (c) выше).
- Malformed email (`"not-an-email"`) — отклоняется 400 на уровне схемы
  (`validation.test.ts`, оба модуля, + мутация (a) подтверждает, что тест
  реально ловит регресс).
- `email.max(200)` / `comment.max(500)` — соответствуют `maxLength` в UI,
  сервер — источник правды в любом случае (Zod валидирует до записи в БД).
- Комментарий/email отсутствуют в audit-log metadata (старые/не-#665 записи) —
  `history.ts`'s `if (meta.comment)`/`if (meta.email)` корректно не рендерят
  пустые строки деталей (тест «не показывает пустые Комментарий/Email»).

## Scope check
- `git diff main...HEAD --stat` — ровно 26 файлов, `528(+) 6(-)`. Совпадает с
  постановкой задачи (US-1, AC-1..AC-7). `prisma/schema.prisma`,
  `package.json`, `CLAUDE.md` не тронуты — новых моделей/полей/миграций/
  зависимостей нет (email хранится в уже существующем `Booking.metadata Json?`).
- Новый код не трогает другие ветки `buildDetails`/`ACTION_LABELS`, не
  трогает `clientPhone`-расхождение между модулями, не трогает `pay-online`
  (правильно оставлено за скоупом, как явно указано в PRD).
- Обе находки этого отчёта («pay-online» — независимо подтверждённая, и
  «дубль синтетической записи создания для admin_create» — новая, найденная
  самостоятельно) корректно не чинятся в рамках этой QA-проверки — заведу как
  follow-up issues, а не расширяю скоуп #665 задним числом.

## Итог
- Всего AC: 7, PASS: 7, FAIL: 0 (AC-3 — PASS с задокументированной некритичной
  UX-асимметрией desktop/mobile, не функциональный провал).
- Регрессия: `npm test` 3990/3990 (286 файлов), `tsc` чисто, `lint` 0 ошибок/16
  pre-existing warning'ов (ни один в изменённых файлах) — все числа
  независимо воспроизведены.
- Mutation-тест: 3 из новых поведений лично откачены по одной и восстановлены
  — каждая уронила ровно ожидаемый тест и только его, соседние тесты в файле
  остались зелёными; рабочее дерево после каждой мутации возвращено в
  исходное состояние (`git status --short` пусто).
- Флаг ревьюера про `pay-online` (`customerEmail` резолвится из `User.email`,
  не из `booking.metadata.email`) — подтверждён личным чтением роута, реален,
  не в скоупе AC-1..AC-7, не чиню сейчас — follow-up issue.
- Дополнительная независимая находка: пред-существующая (до #665, не
  регрессия этой ветки) вероятность дублирования синтетической записи «Бронь
  создана» в ленте истории для admin-созданных броней (`hasCreation` не
  матчит `booking.admin_create`) — не блокирует AC-5, follow-up issue.
- Security: RBAC не изменён и не ослаблен, data leakage не расширена (тот же
  admin-only периметр), XSS-вектор через `mailto:` проверен и закрыт
  server-side валидацией + React-экранированием, 0 новых зависимостей.
- Паритет desktop/mobile × gazebos/ps-park подтверждён построчным сравнением
  всех 4 поверхностей и их тестов.

**Вердикт: PASS.** Issue #665 (US-1, Epic #442) реализует ровно заявленные
AC-1..AC-7, паритет между всеми 4 формами подтверждён, тесты не тавтологичны
(подтверждено собственным mutation-тестом на 3 независимых правках), security
без инцидентов. Флаг ревьюера про `pay-online` подтверждён как реальный,
корректно вынесен за скоуп задачи — не блокирует. PR готов к автомержу
(`code-reviewer` уже PASS, теперь и `qa-engineer` PASS).
