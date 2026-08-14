# QA-отчёт: issue #527 — анонимный доступ к PII через `/api/gazebos`, `/api/ps-park`, `/api/rental`

**Ветка:** `claude/issue-527-anon-booking-pii-access`
**HEAD:** `c548ee1673754f0253dd9f8efb88b5cb60ab62c2`
**Тип:** security fix (сужение допуска в edge-гейте `authorized()`)
**Изменённые файлы:** `src/lib/auth.config.ts`, `src/lib/__tests__/auth.config.test.ts` (новый, 31 тест)

---

## Контекст

`isPublicApiRoute` в `authorized()`-колбэке (`src/lib/auth.config.ts`, edge middleware
gate) ранее матчил по широкому префиксу (`startsWith("/api/gazebos")` и т.п.), и
`if (isPublicApiRoute && request.method === "GET") return true` пропускал ЛЮБОЙ
анонимный GET под пятью префиксами — включая админские роуты с PII без
собственной проверки авторизации: `/api/gazebos/bookings[/[id]]`, `/api/gazebos/timeline`,
`/api/ps-park/bookings[/[id]]`, `/api/ps-park/timeline`, `/api/ps-park/active-sessions`,
и, в худшем случае, `/api/rental` и `/api/rental/[id]` — полная карточка арендатора
(телефон, email, ИНН, юр. адрес, заметки).

Фикс переписывает `isPublicApiRoute` как точный allowlist (exact-path / узкий
prefix) плюс две функции `isGazeboResourceRoute`/`isPsParkResourceRoute`
(regex `^\/api\/{module}\/([^/]+)$` + `Set` зарезервированных литеральных
сегментов), различающие настоящий публичный `GET /api/{module}/[id]` от
односегментного соседнего литерального роута. Всё, что не попало в allowlist,
падает в неизменный generic `isApiRoute`-фолбэк, требующий `auth?.user` (иначе 401).

---

## 1. Регрессия — `npm test`

```
Test Files  232 passed (232)
     Tests  3500 passed (3500)
  Duration  27.16s
```

**PASS.** Полный сьют зелёный, 3500 тестов (включая 31 новый в `auth.config.test.ts`).

## 2. Типы и линт

- `npx tsc --noEmit` — чистый вывод, 0 ошибок.
- `npm run lint` — 0 errors, 16 warnings, все — в файлах, не относящихся к этому
  PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`,
  `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`,
  `novofon-client.ts`). Ни один warning не в `auth.config.ts` или новом тестовом файле.

**PASS.**

## 3. Независимая проверка полноты reserved-segment множеств

Листинг реальных `route.ts` под `src/app/api/gazebos/` и `src/app/api/ps-park/`
(исключая `[id]`):

- **Gazebos** (9 литеральных): `admin-book, analytics, availability, book, bookings, health, marketing, settings, timeline`
  → `GAZEBOS_RESERVED_SEGMENTS` содержит все 9, ровно. ✅ полное совпадение.
- **PS Park** (12 литеральных): `active-sessions, admin-book, analytics, auto-complete, availability, book, bookings, health, session-ending-alert, settings, shift, timeline`
  → `PS_PARK_RESERVED_SEGMENTS` содержит все 12 плюс один лишний элемент `sessions`
  (директории `sessions` не существует — только `active-sessions`). Лишний элемент
  избыточен, но не создаёт дыры: он лишь делает гипотетический `/api/ps-park/sessions`
  строже (падает в generic auth-required фолбэк), а не публичным. Не баг.

**Вывод: reserved-segment множества полны, пересчитано независимо от отчёта Reviewer'а — совпадений с недостающими сегментами не найдено.** PASS.

## 4. Независимое подтверждение отсутствия живых вызывающих `/api/rental` (root) и `/api/rental/[id]`

`grep` по `src/`, `bot/` на шаблон `/api/rental` + ровно один сегмент/конец строки:
единственные совпадения на голый `/api/rental` или `/api/rental/<id>` (не под
`/offices`, `/contracts`, `/tenants`, `/deals`, `/inquiries`, `/email-templates`,
`/send-email`, `/notification-settings`, `/tasks`, `/payments`, `/health`) —
**отсутствуют**. Все фактические `fetch()`-вызовы в `src/components/**`
(rental-компоненты и inquiry-form) бьют в под-роуты (`/api/rental/deals/...`,
`/api/rental/contracts/...`, `/api/rental/offices/...` и т.д.), ни один — в
`/api/rental` или `/api/rental/<office-id>` напрямую. В `bot/` — совпадений с
`/api/rental` вообще нет.

**Вывод: подтверждено независимо — мёртвые роуты, живого потребителя нет.** PASS.

## 5. Тестовое покрытие (`auth.config.test.ts`, 31 тест)

Прочитан полностью и запущен изолированно:

```
npx vitest run src/lib/__tests__/auth.config.test.ts
Test Files  1 passed (1)
     Tests  31 passed (31)
```

Покрытие соответствует описанию уязвимости:

- **Ранее экспонированные PII-роуты теперь требуют сессию** (11 кейсов,
  `expect(result).not.toBe(true)`): `/api/gazebos/bookings`,
  `/api/gazebos/bookings/booking-1`, `/api/gazebos/timeline`,
  `/api/ps-park/bookings`, `/api/ps-park/bookings/booking-1`,
  `/api/ps-park/timeline`, `/api/ps-park/active-sessions`, `/api/rental`,
  `/api/rental/office-1`, `/api/rental/contracts`, `/api/rental/tenants`.
  Все явно упомянутые в описании уязвимости пути покрыты.
- **Ранее-и-по-прежнему публичные роуты остаются публичными** (16 кейсов,
  regression guard от пере-сужения): `/api/cafe`, `/api/cafe/health`,
  `/api/cafe/menu/images/photo.jpg`, `/api/gazebos`, `/api/gazebos/availability`,
  `/api/gazebos/health`, `/api/gazebos/<resource-id>` (карточка беседки),
  `/api/ps-park`, `/api/ps-park/availability`, `/api/ps-park/health`,
  `/api/ps-park/<resource-id>` (карточка стола), `/api/parking`,
  `/api/parking/health`, `/api/rental/health`, `/api/inventory`,
  `/api/inventory/health`.
- **Сохранённые POST-исключения не задеты** (4 кейса): гостевое бронирование
  беседки, QR-чекаут кафе, поллинг статуса оплаты, публичный трекинг заявки.

**Вывод: тесты полны и корректно бьют по заявленным CVE-путям.** PASS.

## 6. Независимая проверка граничного случая regex

Выполнено вручную (Node REPL, скопирована точная реализация
`isGazeboResourceRoute` из diff):

| Путь | Ожидание | Факт |
|------|----------|------|
| `/api/gazebos/bookings` (1 сегмент, литерал в reserved-set) | `false` (не resource route → не публичен) | `false` ✅ |
| `/api/gazebos/bookings/abc123` (2 сегмента) | `false` (regex `$`-якорь не матчит доп. сегмент → падает в generic fallback) | `false` ✅ |
| `/api/gazebos/cljabc123` (1 сегмент, не в reserved-set — настоящий resource id) | `true` | `true` ✅ |

Регекс `^\/api\/gazebos\/([^/]+)$` корректно исключает многосегментные пути
(`[^/]+` + `$`-якорь не допускают доп. `/`), поэтому `/api/gazebos/bookings/abc123`
не может случайно "просочиться" через resource-route ветку — он падает в
generic `isApiRoute`-фолбэк, требующий `auth?.user`. Совпадает с независимым
тестовым прогоном п.5.

**PASS.**

## 7. Скоуп PR

```
git diff main...HEAD --stat
 src/lib/__tests__/auth.config.test.ts | 93 +++++++++++++++++++++++++++++++++++
 src/lib/auth.config.ts                | 70 ++++++++++++++++++++++++--
 2 files changed, 158 insertions(+), 5 deletions(-)
```

Ровно 2 файла — совпадает с описанием, scope creep не обнаружен. Полный diff
`src/lib/auth.config.ts` прочитан целиком: изменение — чисто сужающее
(`startsWith`-префиксы заменены на точные `===`/узкие `startsWith` + 2 хелпер-функции),
неизменный generic-фолбэк (`isApiRoute` → 401 без `auth?.user`) не тронут,
никакой новой публичной поверхности не добавлено. **PASS.**

---

## Acceptance criteria (из описания задачи/issue #527)

| AC | Описание | Статус |
|----|----------|--------|
| AC1 | Анонимный GET к `/api/gazebos/bookings`, `/api/gazebos/bookings/[id]`, `/api/gazebos/timeline` → не 200 (сессия обязательна) | PASS |
| AC2 | Анонимный GET к `/api/ps-park/bookings`, `/api/ps-park/bookings/[id]`, `/api/ps-park/timeline`, `/api/ps-park/active-sessions` → не 200 | PASS |
| AC3 | Анонимный GET к `/api/rental` и `/api/rental/[id]` → не 200 (полная карточка арендатора больше не отдаётся анонимно) | PASS |
| AC4 | Настоящие публичные виджеты (доступность слотов, список ресурсов, карточка ресурса по id, меню кафе, инфо парковки, гостевые POST-исключения) остаются доступны без сессии — нет регресса | PASS |
| AC5 | Изменение narrowing-only, generic auth fallback не тронут, scope = только `auth.config.ts` + тест | PASS |

---

## Security-чеклист (обязательные функциональные кейсы)

- [x] **RBAC / анонимный доступ к защищённым endpoint'ам** — все 11 ранее уязвимых
  путей теперь возвращают не-`true` из `authorized()` (401/редирект вместо
  анонимного прохода). Проверено тестами + независимым чтением кода.
- [x] **Data leakage** — PII (`clientName`, `clientPhone`, `cashAmount`,
  `cardAmount`, полная карточка `Tenant`: телефон/email/ИНН/юр.адрес) больше не
  достижима анонимно через сузившийся allowlist.
- [x] **Regression guard** — легитимные публичные роуты (виджеты доступности,
  списки ресурсов, resource-id карточки, гостевые POST) не задеты — 20 тестов
  (16 GET + 4 POST-исключения) это подтверждают.
- [x] **Полнота allowlist/reserved-set** — пересчитано независимо от прежнего
  review (см. п.3), несовпадений не найдено.
- [~] Rate limiting / input validation / SQL-injection — вне скоупа этого PR
  (изменения только в edge-гейте `authorized()`, ниже по стеку не тронуто);
  не применимо к этому конкретному фиксу.

Ни один security-кейс не FAIL.

---

## Известный остаточный риск (не блокирует PASS)

`/api/rental` (root) и `/api/rental/[id]` GET-хендлеры по-прежнему не имеют
собственной ролевой проверки (`role === MANAGER/SUPERADMIN`) — после фикса
достаточно ЛЮБОЙ авторизованной сессии (в т.ч. `USER`), чтобы пройти
generic-фолбэк. Это строгое улучшение относительно полностью анонимного
доступа (было: PII без всякой сессии → стало: PII требует хоть какую-то
сессию), и сами роуты — мёртвый legacy-код без живого вызывающего (см. п.4),
поэтому практический риск низкий. Рекомендация (follow-up, не блокирует этот
PR): добавить явную `role !== MANAGER && role !== SUPERADMIN` проверку в
`src/app/api/rental/route.ts` и `src/app/api/rental/[id]/route.ts`, либо
удалить эти мёртвые роуты вовсе в пользу `/api/rental/offices[/[id]]`.

---

## Вердикт: PASS

Все 7 пунктов независимой проверки подтверждены самостоятельно (не унаследованы
из отчёта code-reviewer): полный тест-сьют зелёный (3500/3500), типы и линт
чистые, reserved-segment множества пересчитаны и полны, отсутствие живых
вызывающих `/api/rental` root/`[id]` подтверждено grep'ом по `src/` и `bot/`,
31 новый тест прочитан и перезапущен изолированно с покрытием всех заявленных
уязвимых путей, граничные случаи regex проверены вручную и совпадают с
тестами, diff ограничен ровно двумя ожидаемыми файлами без scope creep.
Остаточный риск (dead `/api/rental` routes без ролевой проверки) зафиксирован
как рекомендованный follow-up, не блокирует вердикт согласно скоупу задачи.
