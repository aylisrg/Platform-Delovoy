# QA: #509 — listBookingsPaginated silently drops the userId filter

## Вердикт: PASS

Ветка `claude/issue-509-list-bookings-userid-filter`, diff против `origin/main`: 1 функциональный
коммит (`3ad9455`) + 1 docs-only коммит (`2e27a41`, review report). Проверено независимо от
Reviewer'а (второй PASS, после #562).

## Что проверено

### 1. `npm test`, `npx tsc --noEmit`, `npm run lint`

- `npm test -- --run` → **252 файла, 3605 тестов, все зелёные**.
- `npx tsc --noEmit` → чисто, без ошибок.
- `npm run lint` → 0 errors, 16 pre-existing warnings, все вне diff'а этого PR (`vk-community-banner.tsx`,
  `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`,
  `novofon-client.ts`, plus unused-eslint-disable в файлах, не относящихся к gazebos/ps-park).
  Ничего в `src/modules/gazebos/*` или `src/modules/ps-park/*`.

### 2. RBAC-гейт (пост-#562) + сквозная трассировка userId

Прочитаны актуальные файлы на этой ветке:

- `src/app/api/gazebos/bookings/route.ts:23-27` и `src/app/api/ps-park/bookings/route.ts:23-27` —
  оба обработчика перед вызовом `listBookingsPaginated()` делают:
  `auth()` → 401 если нет сессии → `hasRole(session.user, "MANAGER")` → 403 если ниже →
  `requireAdminSection(session, "gazebos"|"ps-park")` → 403 если MANAGER без назначения на модуль
  (и корректно уважает `STRICT_ACCESS_MODULES` для SUPERADMIN/ADMIN).
  `hasRole` — иерархическая проверка (`src/lib/permissions.ts:70-78`, USER<MANAGER<ADMIN<SUPERADMIN),
  не строковое сравнение. Подтверждено независимо — это ровно тот фикс из #562/PR #562, уже в
  `origin/main` (коммит `135e848`, родитель ветки).

- Сквозная трассировка `?userId=<id>` от схемы до Prisma:
  1. `bookingFilterSchema`/`psBookingFilterSchema` (`validation.ts:44`/`:52`) — `userId: z.string().optional()`, объектная Zod-схема без `.passthrough()` → лишние query-параметры отбрасываются, `userId` валидируется как строка.
  2. Route handler: `bookingFilterSchema.safeParse(searchParams)` → `parsed.data` (уже провалидированный, типизированный объект) целиком передаётся в `listBookingsPaginated(parsed.data)` — никакой ручной деструктуризации, которая могла бы обронить поле.
  3. `service.ts` (обе версии, `gazebos/service.ts:1732-1785`, `ps-park/service.ts:2001-2054`): сигнатура теперь включает `userId?: string`, и `if (params.userId) where.userId = params.userId;` добавлено рядом с идентичным паттерном для `resourceId`.
  4. `where` передаётся напрямую в `prisma.booking.findMany({ where, ... })` и `prisma.booking.count({ where })` — оба используют один и тот же `where`-объект, так что фильтрация и подсчёт согласованы (пагинация `total` не разъедется с выдачей).
  5. `prisma/schema.prisma`, `model Booking`: `userId String?` + `@@index([userId])` — имя поля совпадает, фильтр использует существующий индекс, лишней full-scan нагрузки нет.

  Вывод: `?userId=<id>` теперь действительно фильтрует end-to-end, а не только "прокидывается и теряется", как было до фикса.

### 3. Другие вызывающие места `listBookingsPaginated`

`grep -rn "listBookingsPaginated" src/` (без `docs/`) — ровно 8 файлов: 2×`service.ts`,
2×`service.test.ts`, 2×`route.ts`, 2×`route.test.ts`. Единственные продакшн-вызовы — из двух
уже проверенных, RBAC-огороженных route-хендлеров. Оба они и раньше передавали весь `parsed.data`
целиком (включая `userId`, который раньше молча игнорировался в `service.ts`) — новый параметр
опциональный, старое поведение вызовов без `userId` не меняется (см. п.4). Изменение чисто
аддитивное — риска регрессии для существующих вызовов нет.

### 4. Тесты пинят баг

Прочитаны исходники тестов (не только их прохождение):
- `src/modules/gazebos/__tests__/service.test.ts:1316-1337` — `"should apply userId filter"` /
  `"should not add userId to where when not provided"`.
- `src/modules/ps-park/__tests__/service.test.ts` (соответствующий блок) — идентичный паттерн,
  `"listBookingsPaginated applies userId filter"` / `"...does not add userId..."`.

Сверено с pre-fix кодом на родительском коммите `135e848` (`git show 135e848:.../service.ts`):
сигнатура `params` там **не содержит** `userId`, и в построении `where` нет `if (params.userId)`.
Vitest транспилирует TS без type-check (excess-property check Zod-подобного рода тут не применяется
к обычному TS-объекту — на рантайме лишнее поле просто игнорируется), поэтому `listBookingsPaginated({ userId: "user-42" })`
на pre-fix коде вызвало бы `prisma.booking.findMany` с `where`, не содержащим `userId` →
`expect.objectContaining({ where: expect.objectContaining({ userId: "user-42" }) })` **упал бы**.
Тест `"should not add userId..."` тривиально проходит и до, и после фикса сам по себе, но паре
тестов (apply + absent) достаточно для пиннинга регрессии. Подтверждено чтением кода, ре-запуск
revert не требовался (уже верифицировано вручную разработчиком).

## Acceptance Criteria (issue #509)

| AC | Статус | Комментарий |
|----|--------|-------------|
| `userId` — опциональный параметр `listBookingsPaginated` в обоих модулях (gazebos, ps-park) | PASS | сигнатуры обновлены идентично |
| При наличии `userId` — Prisma `where.userId` применяется | PASS | код + тест "apply", трассировка end-to-end подтверждена |
| При отсутствии `userId` — поведение не меняется (`where` без поля `userId`) | PASS | код + тест "not add", grep других вызывающих мест — аддитивность подтверждена |
| RBAC: доступ к `?userId=` фильтру — только MANAGER+ с доступом к модулю | PASS | закрыто #562, независимо перепроверено чтением route.ts + permissions.ts |
| Регрессия: `npm test`/`tsc`/`lint` чистые | PASS | 3605/3605, 0 tsc errors, 0 lint errors |

## Security-кейсы

- **RBAC**: анонимный запрос → 401 (`auth()` guard); USER → 403 (`hasRole(MANAGER)`); MANAGER
  чужого модуля → 403 (`requireAdminSection`). Подтверждено чтением кода (см. п.2). `userId`-фильтр
  не открывает новый обходной путь — он доступен только уже авторизованному MANAGER+ с доступом к
  модулю, то есть это легитимный "найти брони конкретного клиента", а не эскалация привилегий или
  IDOR (сам список броней и так был MANAGER-only ещё до этого фикса).
- **Input validation**: `userId` — `z.string().optional()`, произвольная строка от Zod идёт в
  Prisma `where` как параметризованное значение (ORM, не raw SQL) — SQL-инъекция исключена.
  Несуществующий/чужого формата `userId` просто не даст совпадений (`findMany` вернёт `[]`,
  `count` вернёт `0`) — не 500, не утечка.
- **Data leakage**: ответ route по-прежнему `select`-ит только `name/phone/email` внутри `include.user`,
  без изменений в этом PR — эндпоинт и так был MANAGER+module-access-gated, `userId`-фильтр не
  расширяет то, что видно, только сужает выборку.

## Регрессия / другие вызывающие места

Единственные продакшн-вызовы `listBookingsPaginated` — 2 route handler'а, оба уже проверены.
Никаких других мест в `src/` (UI-компоненты, боты, скрипты) функцию не импортируют — изменение
сигнатуры чисто аддитивно, поведение старых вызовов не меняется.

## Итог

Все 4 пункта задания подтверждены самостоятельной трассировкой кода (не только доверием к тестам
и review-отчёту): RBAC-гейт цел, `userId` теперь реально фильтрует end-to-end через существующий
индексированный столбец, других вызывающих мест нет, новые тесты пинят именно этот баг и падали бы
на pre-fix коде. `npm test`, `npx tsc --noEmit`, `npm run lint` — все чистые.

**Вердикт: PASS**
