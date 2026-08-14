# Review: Issue #489 — gazebos/health исключает soft-deleted брони из todayBookings

## Вердикт: PASS

## Acceptance Criteria
| AC | Статус | Комментарий |
|----|--------|-------------|
| `prisma.booking.count` в `src/app/api/gazebos/health/route.ts` фильтрует `deletedAt: null` | PASS | Строка добавлена в `where` (route.ts:17), подтверждено `git diff main...HEAD` — единственное изменение в файле. |
| Тест на happy path health-эндпоинта с учётом soft-deleted броней | PASS | `src/app/api/gazebos/health/__tests__/route.test.ts` — 3 теста: healthy-ответ с метриками, проверка `deletedAt: null` в вызове `prisma.booking.count`, unhealthy/503 при ошибке БД. |

Проверил вручную, что тест действительно валиден как регрессионный: временно откатил `route.ts` до версии из `main` (без `deletedAt: null`) и прогнал тест — тест №2 упал с ожидаемым diff (`deletedAt: null` отсутствовал в фактическом `where`), остальные два прошли. После восстановления фикса все 3 теста снова зелёные. Значит тест ловит именно баг из issue #489, а не является тавтологией/false positive.

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — `git diff main...HEAD --name-only` показывает ровно 2 файла: `route.ts` (1 строка) и новый тестовый файл. `package.json`/`package-lock.json` не тронуты.

## Качество кода
- TypeScript strict: OK (изменение тривиальное, без `any`)
- Паттерн `deletedAt: null` соответствует использованию в `src/modules/gazebos/service.ts` (16 вхождений того же паттерна на все чтения Booking) и схеме Prisma (`Booking.deletedAt DateTime?`, `@@index([deletedAt])`)
- API формат: health-роут не использует `apiResponse()/apiError()` — но это консистентно с соседним `src/app/api/ps-park/health/route.ts`, который построен по идентичному шаблону (`NextResponse.json` напрямую, тот же формат `{module, status, timestamp, metrics}` / `{module, status, timestamp, error}`). Расхождение с общим API-конвеншеном CLAUDE.md существует, но это pre-existing паттерн для всех health-эндпоинтов модулей, а не то, что вносит этот PR — исправление здесь было бы out-of-scope для issue #489.
- Тесты: OK — мокается `@/lib/db` (без реальной БД), моки корректны, happy path + error path + регрессионный тест на конкретный баг покрыты
- `npm test -- --run`: 248 test files / 3572 tests — все зелёные

## Безопасность
- RBAC: не применимо — `GET /api/gazebos/health` не содержит PII/бизнес-данных, только агрегированные счётчики (как и все остальные `/api/{module}/health` роуты в проекте, RBAC на них не стоит согласно текущей практике репозитория)
- Утечки данных: `grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)' -i` по изменённым файлам — ничего не найдено
- Supply chain: новых зависимостей нет
- Injection: raw SQL/`$executeRawUnsafe` не используется, только typed Prisma query builder
- Dangerous ops: отсутствуют

## Что исправить (если NEEDS_CHANGES)
Нет — PR готов к мержу.

## Что хорошо
- Точечный однострочный фикс, ровно по формулировке issue #489, без побочных правок
- Тест написан так, что явно проверяет причину бага (наличие `deletedAt: null` в `where`), а не просто факт успешного ответа — я подтвердил это, откатив фикс и увидев красный тест
- Не тронут сервисный слой и другие health-роуты — соответствует принципу "one PR = one feature"

## Отдельное наблюдение (не блокирует PASS, не в скоупе #489)
`src/app/api/ps-park/health/route.ts` содержит идентичный баг: `prisma.booking.count` без `deletedAt: null` в `where`. Тот же класс проблемы, что и issue #489/#423, но для модуля `ps-park`. Рекомендую завести отдельный issue для симметричного фикса — исправлять это в рамках текущего PR было бы scope creep за пределы issue #489.
