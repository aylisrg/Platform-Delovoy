# Review: #509 — listBookingsPaginated silently drops the userId filter (re-review post-#562)

## Вердикт: PASS

Это повторное ревью того же коммита, что получил NEEDS_CHANGES ранее. Сам код не менялся —
изменилось окружение: ветка перебазирована на `origin/main` после мержа #562 (issue #560),
который закрыл RBAC-дыру на `GET /api/gazebos/bookings` и `GET /api/ps-park/bookings`,
устранившую единственную причину прошлого отказа.

## Что проверено

### 1. RBAC-гейт (причина прошлого NEEDS_CHANGES) — подтверждено независимо

Прочитаны актуальные файлы на этой ветке:

- `src/app/api/gazebos/bookings/route.ts:23-27`
- `src/app/api/ps-park/bookings/route.ts:23-27`

Оба обработчика теперь делают, до вызова `listBookingsPaginated()`:
```ts
const session = await auth();
if (!session?.user?.id) return apiUnauthorized();
if (!hasRole(session.user, "MANAGER")) return apiForbidden();
const denied = await requireAdminSection(session, "gazebos" /* | "ps-park" */);
if (denied) return denied;
```
`hasRole` (`src/lib/permissions.ts:70-78`) — иерархическая проверка роли (USER < MANAGER < ADMIN
< SUPERADMIN), не строковое сравнение. `requireAdminSection` (`src/lib/api-response.ts:76-100`)
дополнительно режет `USER` и для `MANAGER` проверяет `hasAdminSectionAccess` (по модулю), плюс
уважает `STRICT_ACCESS_MODULES`. Это ровно тот паттерн, что уже стоял на PATCH/DELETE в этих же
файлах — теперь применён и к GET.

Коммит `135e848` (в `origin/main`, `git log` подтверждает — 1 коммит после него на этой ветке)
своим сообщением прямо ссылается на #509 как на триггер находки: "Found by code-reviewer while
reviewing #509 ... landing that fix before this one would have turned 'scrape everything' into
'pull one specific person's history on demand'". Причинно-следственная связь подтверждена, гэп
закрыт до, а не после активации фильтра — риск снят.

Проверено также, что `listBookingsPaginated` из `gazebos/service.ts` и `ps-park/service.ts`
вызывается **только** из этих двух гейтнутых route-файлов (`grep` по всему `src/` — 8 файлов:
2 service + 2 service-test + 2 route + 2 route-test, других вызывающих мест нет).

### 2. Корректность самого фикса против текущего `origin/main`

- `git diff origin/main...HEAD` — ровно 4 файла, +56/-0, без конфликтов, без drift.
- `userId?: string` добавлен в сигнатуру обоих `listBookingsPaginated`, `if (params.userId) where.userId = params.userId;` — идентично исходному описанию.
- Prisma-схема (`prisma/schema.prisma`, `model Booking`): `userId String?` + `@@index([userId])` — имя поля совпадает, фильтр валиден и использует существующий индекс.
- `bookingFilterSchema` (`src/modules/gazebos/validation.ts:44`) и `psBookingFilterSchema` (`src/modules/ps-park/validation.ts:52`) уже валидировали `userId: z.string().optional()` — фикс просто передаёт уже провалидированное поле в `where`, никакой новой валидации не требуется.
- `npx tsc --noEmit` — чисто.

### 3. Тесты

4 новых теста (по 2 на модуль) пинят именно баг-фикс: "применяет userId при наличии" /
"не добавляет userId в where при отсутствии". Моки прямые (`prisma.booking.findMany` /
`.count`), не скрывают поведение.

```
npm test -- --run src/modules/gazebos/__tests__/service.test.ts src/modules/ps-park/__tests__/service.test.ts
→ 2 files, 213 tests passed

npm test -- --run   (полный набор)
→ 252 files, 3605 tests passed
```

### 4. Scope

Ровно 4 файла: `src/modules/gazebos/service.ts`, `src/modules/gazebos/__tests__/service.test.ts`,
`src/modules/ps-park/service.ts`, `src/modules/ps-park/__tests__/service.test.ts`. Ничего лишнего
не приехало при ребейзе — RBAC-фикс (#562) целиком остался в базовом коммите `origin/main`,
в diff этой ветки не входит.

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| `userId` из уже провалидированного query-параметра применяется к `where` в обоих модулях | PASS | `service.ts` обоих модулей, идентичный паттерн с `status`/`resourceId` |
| Поведение без `userId` не меняется | PASS | тест "should not add userId to where when not provided" / аналог в ps-park |
| Фильтр доступен только авторизованным MANAGER+ с доступом к модулю | PASS | закрыто в #562, независимо подтверждено чтением route.ts |
| Тесты пинят баг | PASS | 4 новых теста, оба кейса (есть/нет userId) на оба модуля |

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` чисто, `any` не введён)
- Zod валидация: OK (поле уже валидировалось `bookingFilterSchema`/`psBookingFilterSchema` до этого фикса)
- API формат: OK (route handlers не менялись, `apiResponse`/`apiError` не затронуты)
- Тесты: OK (4/4 новых зелёные, полный набор 3605/3605 зелёный)

## Security
- Secrets leakage: `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по diff — ничего не найдено.
- RBAC: причина прошлого NEEDS_CHANGES закрыта и независимо перепроверена — `GET /api/gazebos/bookings` и `GET /api/ps-park/bookings` требуют `auth()` + `hasRole(MANAGER)` + `requireAdminSection(session, module)` до вызова `listBookingsPaginated()`. `userId` берётся из query-параметра, провалидированного Zod, не используется для обхода авторизации (сам by-userId фильтр доступен только уже авторизованному MANAGER+ с доступом к модулю — то есть это легитимный сценарий "найти брони конкретного клиента", а не эскалация привилегий).
- Injection: нет raw SQL, Prisma `where` typed, `userId` — обычная строка в `where`-объекте Prisma (параметризовано ORM).
- Supply chain: новых зависимостей нет.
- Инцидентов не найдено.

## Что хорошо
- Минимальный, точечный фикс — ровно то, что было заявлено при первом ревью.
- Тесты явно комментируют, какой баг они пинят (`// #509: ... this pins the fix`), с полезным для будущих читателей контекстом.
- Ребейз чистый: никакого дрейфа, конфликтов или "заодно поправил" изменений — subject-diff идентичен исходному коммиту, отличается только база.
- Причинно-следственная связь между этим PR и security-фиксом #562 явно задокументирована в commit message #562, что делает историю проверяемой без доверия к пересказу.
