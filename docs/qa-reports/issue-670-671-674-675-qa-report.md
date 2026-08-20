# QA-отчёт: PR #691 — батч из 4 P2-фиксов (issues #670, #671, #674, #675)

## Скоуп

PR https://github.com/aylisrg/Platform-Delovoy/pull/691, ветка
`claude/issue-670-674-675-p2-fixes` → `main`. Четыре независимых
маленьких фикса, каждый закрывает свой issue:

1. #670 — `getBookingHistory()` дедуп синтетической записи о создании для
   броней, созданных админом (`src/modules/booking/history.ts`).
2. #671 — fallback `customerEmail` на `booking.metadata.email` в
   `/api/ps-park/bookings/[id]/pay-online`.
3. #675 — `getResource`/`getTable`/`listResources`/`listTables` фильтруют
   `deletedAt: null` безусловно; admin-страницы ресурсов переключены на
   сервисный слой (`src/modules/gazebos/service.ts`,
   `src/modules/ps-park/service.ts`, обе `resources/page.tsx`).
4. #674 — rate limiting на `/api/gazebos/guests/search` и
   `/api/ps-park/guests/search`.

PRD для этих issue нет (найдены QA/Reviewer'ом при работе над #665/#666,
acceptance criteria — из тела issue, переданы в задаче на верификацию).
`docs/qa-reports/<RUN_ID>-review.md` для этого батча тоже нет — код-ревью
на этот конкретный PR отдельным артефактом не оформлялось.

## Тест-кейсы

### TC-1: #670 — одна запись о создании для админ-брони
- **Приоритет**: Medium
- **Тип**: Functional
- **Шаги**: AuditLog содержит одну запись `booking.admin_create` → вызвать
  `getBookingHistory()`.
- **Ожидаемый результат**: в ленте ровно одна запись о создании, с лейблом
  «Бронь создана администратором»; синтетическая «Бронь создана» не
  добавляется.
- **Статус**: Pass. Тест `history.test.ts` («не дублирует создание
  синтетической записью для брони, созданной админом (issue #670)») мокает
  ровно этот сценарий и проверяет `creationEntries.toHaveLength(1)` — без
  фикса (`hasCreation` не матчил `booking.admin_create`) тест падает.

### TC-2: #671 — email из metadata как fallback
- **Приоритет**: Medium
- **Тип**: Functional / API
- **Шаги**: `User.email = null`, `booking.metadata.email = "guest@example.com"`
  → `POST /pay-online`.
- **Ожидаемый результат**: `createOnlinePayment` вызван с
  `customerEmail: "guest@example.com"`.
- **Статус**: Pass. Тест «issue #671: берёт email из booking.metadata...»
  проверяет ровно это через `expect.objectContaining`.

### TC-3: #671 — приоритет User.email
- **Статус**: Pass. Второй новый тест ставит оба источника и проверяет, что
  берётся `user@example.com` (User.email), не `metadata.email`.

### TC-4: #675 — soft-deleted ресурс не возвращается
- **Приоритет**: High (утечка мягко удалённых записей в PATCH-по-id и в
  списки — потенциально позволяет действовать над удалённым ресурсом)
- **Тип**: Functional
- **Статус**: Pass. `getResource`/`getTable` теперь всегда с
  `deletedAt: null` в `where`; `listResources`/`listTables` — то же в ветке
  `activeOnly=false`. Тесты сервисов проверяют точный `where` через
  `objectContaining({ deletedAt: null })` — без фикса упадут.

### TC-5: #675 — admin-страницы используют сервисный слой, не прямой Prisma
- **Статус**: Pass. Обе `resources/page.tsx` переключены с сырого
  `prisma.resource.findMany` на `listResources(false)`/`listTables(false)`.
  Проверил разметку страницы: активные-но-отключённые ресурсы по-прежнему
  рендерят бейдж «Отключена»/«Отключен» (`r.isActive` не меняется фильтром
  `deletedAt`), форма `ResourceEditor` получает тот же набор полей — фикс не
  меняет форму данных (нет `select` в Prisma-запросе).

### TC-6: #674 — rate limit применяется до поиска
- **Приоритет**: Medium (security — defense-in-depth)
- **Тип**: Security / API
- **Статус**: Pass. `rateLimit(request, "authenticated", session.user.id)`
  вставлен после auth+RBAC (`requireAdminSection`), до `guestSearchQuerySchema`
  и `searchGuestsByPhone` — паттерн идентичен прецеденту
  `src/app/api/inventory/sku/search/route.ts`. Тесты проверяют и корректные
  аргументы вызова, и что 429 обрывает поиск (`searchGuestsByPhone` не
  вызван) — оба падают без фикса.

## Регрессия

- Таргетная выборка (6 изменённых test-файлов): `npx vitest run` — 281/281
  passed.
- Полный `npm test`: после локального `prisma generate` (клиент не был
  сгенерирован под этот чекаут) — **4053/4053 тестов passed**, 288/297
  файлов. 9 файлов в `bot/**` не коллектятся
  (`Cannot find package '@/lib/telegram/escape'`) — воспроизвёл идентично на
  `main`, PR этот код не трогает. Пре-существующая особенность окружения, не
  регрессия PR.
- `npx tsc --noEmit`: после `prisma generate` — чисто, 0 ошибок. До генерации
  клиента — ~60 ошибок по отсутствующим экспортам `@prisma/client`,
  воспроизвёл идентично на `main` (тоже до генерации) — окружение, не код PR.

## Security-кейсы

- **RBAC**: ни один из 4 фиксов не меняет цепочку auth → role →
  `requireAdminSection`/module access — все гейты остались на месте, не
  тронуты диффом. FAIL не найден.
- **Rate limiting**: #674 добавляет недостающий рейт-лимит по образцу
  существующего прецедента; тест на 429 есть. PASS.
- **Data leakage**: `customerEmail`/`customerPhone` в #671 идут только в
  серверный вызов `createOnlinePayment` (платёжный провайдер), не в
  публичный API-ответ. Публичные списки ресурсов (#675) не содержат
  чувствительных полей сверх прежнего. PASS.
- **Input validation**: не менялась ни в одном из 4 фиксов — вне скоупа
  этого батча.

## CI на PR #691

Оба workflow-рана на HEAD `c6a0c21` (`CI — Lint, Test, Build`,
`Auto-merge bot PRs`) в статусе `action_required` — не выполнились из-за
известного инфра-гэпа с `AUTOMATION_TOKEN` (CLAUDE.md, ADR
`2026-08-10-autonomous-issue-cleanup-adr.md`, раздел «Обновление
2026-08-13»): пуш от `github-actions[bot]` требует ручного «Approve and
run». Код здесь ни при чём — подтверждено независимым локальным прогоном
(см. «Регрессия» выше). Владельцу нужно нажать «Approve and run» на PR,
чтобы получить фактический зелёный CI перед авто-мержем.

## Результат

- Всего кейсов: 6
- Пройдено: 6
- Провалено: 0
- Заблокировано: 0 (CI на GitHub не выполнился по инфра-причине,
  не блокирует вердикт — код верифицирован локально)

## Вердикт: PASS
