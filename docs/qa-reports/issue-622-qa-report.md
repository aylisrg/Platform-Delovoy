# QA-отчёт: Issue #622 — 5 write-роутов gazebos/ps-park не проверяли requireAdminSection

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-622-admin-section-write-routes`, коммит `0457d0f` (HEAD) поверх `main`.
- Пять POST write-хендлеров проверяли только `hasRole(session.user, "MANAGER")`, но не звали
  `requireAdminSection(session, <module>)`. MANAGER, назначенный (через `ModuleAssignment`) на
  один модуль, мог создавать/мутировать данные в другом модуле, к которому не имеет доступа.
  Тот же класс бага, что уже закрыт для GET-роутов в #560/#561/#623.
- PRD в `docs/requirements/` отсутствует — точечный security-фикс, эталон — `CLAUDE.md` (RBAC) и
  уже одобренный паттерн `bookings/[id]/route.ts` (#560) / `bill/route.ts` (#561/#623).
- `docs/qa-reports/issue-622-review.md` (code-reviewer, PASS) прочитан и учтён; ниже —
  независимая проверка, не переповторение его выводов.
- `git diff main...HEAD --stat`: 11 файлов, `+493/-5` — 5×`route.ts` (по 2 добавленные строки
  каждый), 5×`__tests__/route.test.ts` (3 расширены, 2 новых для `add-items`/`pay-online`, у
  которых раньше тестов не было вовсе) + `docs/qa-reports/issue-622-review.md`. Вне этого —
  пусто, скоуп-крипа нет.

## Регрессия
- `npm test -- --run` (полный набор): **268 test files passed (268), 3802 tests passed (3802)**, 0 failed.
- `npx tsc --noEmit`: чисто, пустой вывод.
- `npm run lint` (весь проект): **0 errors, 16 warnings** — все pre-existing, в несвязанных файлах
  (`messenger`, `notifications/service.ts`, `telephony/novofon-client.ts`, `admin/sidebar.tsx`,
  `admin/ps-park/session-bill-modal.tsx`, `auth/vk-community-banner.tsx`) — ни один не в изменённых
  этим PR файлах.
- Точечный прогон 5 изменённых `route.test.ts`: 5 files / 37 tests passed.

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `POST /api/gazebos/admin-book` требует `requireAdminSection(session, "gazebos")` | PASS | `route.ts:20-21` — вызов сразу после `hasRole` (17-19), до `request.json()`/сервиса. Слаг верный. |
| 2 | `POST /api/ps-park/admin-book` требует `requireAdminSection(session, "ps-park")` | PASS | `route.ts:20-21`, тот же порядок, слаг верный. |
| 3 | `POST /api/ps-park/bookings/[id]/extend` требует `requireAdminSection(session, "ps-park")` | PASS | `route.ts:23-24`, до `extendBooking(...)`. |
| 4 | `POST /api/ps-park/bookings/[id]/pay-online` требует `requireAdminSection(session, "ps-park")` | PASS | `route.ts:27-28` — до чтения брони из БД (строка 31) и до `createOnlinePayment`; неавторизованный менеджер не триггерит ни один запрос к БД/платёжному провайдеру. |
| 5 | `POST /api/ps-park/bookings/[id]/add-items` требует `requireAdminSection(session, "ps-park")` | PASS | `route.ts:25-26`, до `addItemsToBooking(...)`. |
| 6 | Каждый роут имеет тест на denial-путь (403, сервис не вызван) | PASS | Все 5 файлов содержат тест `"#622: менеджер без ModuleAssignment на <module> — requireAdminSection отклоняет"` с `not.toHaveBeenCalled()` на соответствующий сервис. Регрессионность подтверждена мутационным тестом (см. ниже). |
| 7 | SUPERADMIN/ADMIN не регрессируют | PASS | `gazebos`/`ps-park` не в `STRICT_ACCESS_MODULES` (`src/lib/permissions.ts:41` — только `"nedelovoy"`); `requireAdminSection` возвращает `null` для SUPERADMIN/ADMIN вне strict-модулей (`src/lib/api-response.ts:90-92`). Существующий тест `admin-book` "суперадмин тоже проходит role-check" — зелёный. |

Прочитал во всех 5 route.ts вручную (не только диффы) — во всех порядок ровно
`session → hasRole(MANAGER) → requireAdminSection → парсинг тела/бизнес-логика → logAudit`,
совпадает с эталоном `bookings/[id]/route.ts` (#560).

## Независимая проверка тестов — мутационный тест (не тавтология)

Для всех 5 файлов одновременно временно удалил ровно добавленный блок
(`const denied = await requireAdminSection(...); if (denied) return denied;`) из `route.ts` и
прогнал соответствующие `route.test.ts`:

```
Test Files  5 failed (5)
     Tests  5 failed | 32 passed (37)
```

Упали **ровно** 5 новых `#622: менеджер без ModuleAssignment...` тестов (по одному на файл,
`403` ожидался → получен `201`/`200`), остальные 32 теста в тех же файлах остались зелёными.
Восстановил все 5 `route.ts` из бэкапа, `git status --short` — пусто (дифф идентичен исходному),
повторный прогон — снова 5/5 files, 37/37 passed. Это подтверждает, что новые тесты реально
зависят от добавленного вызова `requireAdminSection`, а не проходят при любом коде.

## Проверка полноты покрытия тест-кейсов (RBAC-матрица)

Прочитал содержимое всех 5 `__tests__/route.test.ts` целиком (не только диффы) — во всех
файлах присутствуют все 4 обязательных сценария:

| Роль / состояние | Ожидание | gazebos/admin-book | ps-park/admin-book | extend | pay-online | add-items |
|---|---|---|---|---|---|---|
| Аноним (`auth()` → null) | 401 | ✓ | ✓ | ✓ | ✓ | ✓ |
| USER | 403 FORBIDDEN, сервис не вызван | ✓ | ✓ | ✓ | ✓ | ✓ |
| MANAGER без `ModuleAssignment` (`requireAdminSection` отклоняет) | 403, сервис не вызван | ✓ | ✓ | ✓ | ✓ | ✓ |
| MANAGER с доступом (happy path) | 200/201, сервис вызван с правильными аргументами, `logAudit` вызван | ✓ | ✓ | ✓ | ✓ | ✓ |
| SUPERADMIN (только в gazebos/admin-book) | проходит role-check | ✓ | — | — | — | — |

`pay-online` дополнительно покрывает 404 (бронь не найдена), 409 (`NOTHING_TO_PAY`), ошибку
провайдера (`PaymentError` → 400) и 500 без утечки деталей — сверх минимума AC, но не в ущерб
основному сценарию #622. `add-items` дополнительно покрывает 422 (пустой список) и
`INSUFFICIENT_STOCK`. Мок `requireAdminSection` реализован единообразно во всех 5 файлах через
`vi.mock("@/lib/api-response", ...)` с `importActual` + override — не подменяет весь модуль,
остальные экспорты (`apiResponse`, `apiError` и т.д.) остаются настоящими.

## Security-чеклист (функциональный, из agents/qa.md / SECURITY.md)

- [x] Анонимный запрос → 401 — проверено во всех 5 роутах.
- [x] USER → 403 (role check) — проверено во всех 5 роутах.
- [x] **MANAGER модуля A дёргает endpoint модуля B → 403, мутация не происходит** — это и есть
  суть фикса; проверено тестом + независимо подтверждено мутационным тестом выше.
- [x] `userId` берётся из `session.user.id`, не из body — во всех 5 роутах (`session.user.id`
  передаётся в сервис, в body только бизнес-поля брони/товаров).
- [x] Аудит: `logAudit(...)` вызывается после успешной мутации во всех 5 роутах, порядок не
  нарушен добавленной проверкой.
- [x] Ошибки 500 не содержат stack trace/деталей — тесты `"неожиданная ошибка ... — 500, без
  утечки деталей"` проверяют `body.error.code === "INTERNAL_ERROR"`, не `message` исходной
  ошибки.
- [x] Секретов/токенов в изменённых файлах нет — `grep -rniE '(password|token|secret|nextauth|
  telegram_.*token|api[_-]key)'` по всем 11 файлам диффа — 0 совпадений.
- [x] Rate limiting — не в скоупе этого фикса (эндпоинты авторизованные, admin-only; лимит для
  authenticated уже применяется на уровне middleware, не регрессирует этим PR).
- [x] Independent audit по всему `gazebos`/`ps-park`: `grep -rl 'hasRole(...MANAGER|SUPERADMIN)'`
  по обоим каталогам (исключая тесты) → для каждого найденного файла проверил наличие
  `requireAdminSection` рядом — 0 файлов без неё. Класс бага закрыт полностью, не только 5
  перечисленных в issue роутов.

Security-блокеров нет.

## Scope check
- Изменения строго в рамках issue #622: 5 route-хендлеров (+2 строки каждый) + их тесты + отчёт
  reviewer'а. `package.json`/`package-lock.json`/`prisma/schema.prisma`/`CLAUDE.md` не тронуты —
  новых зависимостей и модулей нет.
- Не найдено рефакторинга соседнего кода — каждый диф `route.ts` состоит из одной изменённой
  строки импорта и двух новых строк вызова.

## Итог
- Всего AC: 7
- PASS: 7
- FAIL: 0
- Security-кейсы: без блокеров
- `npm test` (268/268 файлов, 3802/3802 тестов), `tsc --noEmit`, `eslint` (весь проект) — все чисто
- Тесты — не тавтология: мутационный тест независимо подтвердил, что все 5 новых
  `#622`-денайл-тестов падают без фикса и только они
- SUPERADMIN/ADMIN регрессии нет (не strict-access модули)
- Дополнительный аудит подтвердил отсутствие пропущенных write/read роутов того же класса бага
  в `gazebos`/`ps-park`

**Вердикт: PASS.** Фикс точечный (по 2 строки на файл), полностью покрывает все 5 роутов из
issue, тесты реально бьют в найденную дыру (подтверждено независимым мутационным тестом), полный
прогон тестов/типов/линта зелёный, RBAC-матрица (401/403 role/403 module-scope/200 happy path)
покрыта во всех 5 файлах, SUPERADMIN/ADMIN не затронуты. Замечаний нет.
