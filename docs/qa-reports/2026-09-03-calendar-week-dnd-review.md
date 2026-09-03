# Review: Недельный вид расписания и drag-and-drop переноса брони (US-5/US-6, issue #740/#741, эпик #442)

**RUN_ID:** `2026-09-03-calendar-week-dnd`
**Reviewer:** Code Reviewer (LLM-as-Judge)
**Дата:** 2026-09-03
**Источники:** PRD `docs/requirements/2026-08-16-booking-calendar-operator-ux-prd.md`, ADR `docs/architecture/2026-08-23-booking-calendar-week-view-drag-drop-adr.md`, Context `docs/context/2026-08-16-booking-calendar-operator-ux-context.md`, issues #740/#741, `git diff origin/main...HEAD`

## Вердикт: PASS

---

## Acceptance Criteria

### US-5 — недельный вид (#740)

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | `ScheduleViewToggle` («День»/«Неделя») добавлен в оба `timeline-grid.tsx`, локальное состояние `view`, без `?view=` в URL — как решено ADR §3. |
| AC-2 | PASS | `WeekScheduleGrid` — матрица «ресурс × день», 7 колонок, чипы броней по ресурсам, «Итого/день» считается на клиенте (`week-schedule-grid.tsx:117-130`), тест `AC-2` в `week-schedule-grid.test.tsx:79`. |
| AC-3 | PASS | Клик по чипу → `onBookingClick` → та же карточка (`GazeboBookingDetailCard`/`BookingDetailCard`) без адаптера, `WeekTimelineBooking` структурно расширяет `TimelineBooking`. Тесты в обоих `timeline-grid.test.tsx`. |
| AC-4 | PASS | Навигация «← / Эта неделя / →» шагом ±7 дней (`week-schedule-grid.tsx:150-168`), тест `week-schedule-grid.test.tsx:108`. |
| AC-5 | PASS | Общий `WeekScheduleGrid` с пропсами `moduleSlug/resourceLabel/unitLabel/countMetaKey` — идентичное поведение по построению; отдельный тест на ps-park (`ps-park/__tests__/timeline-grid.test.tsx`). |
| AC-6 | PASS (минимальный вариант, с оговоркой) | Клик по пустой ячейке → `onEmptyCellClick(date, resourceId)` из `week-schedule-grid.tsx`, но обработчики в обоих `timeline-grid.tsx` (`handleWeekEmptyCellClick(day)`) используют только `day`, `resourceId` отбрасывается — переключение происходит на нужный **день**, ресурс не подсвечивается/не выделяется в дневном виде. Буквальный текст PRD AC-6 говорит «на нужный день/ресурс», но ADR §3 и §11 (Follow-up задача 1) явно сузили минимальный вариант до «на выбранную дату» — это архитекторское решение, зафиксированное в принятом ADR, а не самодеятельность разработчика. Не блокирует PASS, но стоит иметь в виду для будущего тикета, если оператора это не устроит на практике. |

### US-6 — drag-and-drop (#741)

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | Перенос между ячейками (время и/или ресурс) через `DndContext`/`useDraggable`/`useDroppable` на строку ресурса (`res:<id>`), гибрид из ADR §5.2. Тест `timeline-grid.test.tsx:177`. |
| AC-2 | PASS | Растяжение правого края — отдельный `useDraggable id="resize:<id>"`, `resizeBookingEnd()` меняет только `endHour`. Тест `timeline-grid.test.tsx:230`. |
| AC-3 | PASS | Клиент не проверяет конфликты — только готовит `DropPlan` и шлёт PATCH; 409 `BOOKING_CONFLICT` → откат состояния + `error.message` в `role="alert"`. Тест `timeline-grid.test.tsx:215`. |
| AC-4 | PASS | Тот же `PATCH /api/gazebos/bookings/:id` без `status`, тот же обработчик (`rescheduleBooking()` с advisory-lock/Google Calendar/уведомлением) — эндпоинт не изменён (`git diff` не затрагивает `src/app/api/gazebos/bookings/[id]/route.ts`). Тело PATCH — подмножество полей `booking-edit-form.tsx` (без `clientName/clientPhone/guestCount`), что валидно для `rescheduleBookingSchema` (все поля опциональны). |
| AC-5 | PASS | Droppable-зоны создаются только для ресурсов текущего модуля (`res:<id>` по `data.resources`) — межмодульный перенос невозможен по построению, отдельной проверки не требуется. |
| AC-6 | PASS | `mobile-timeline.tsx` (оба модуля) не в диффе — подтверждено `git diff --stat -- '*mobile-timeline*'` (пусто). |
| AC-7 | PASS | `src/components/admin/ps-park/timeline-grid.tsx` не импортирует `@dnd-kit`, drag отсутствует — подтверждено чтением файла и тестом-заголовком `AC-7`. |

**Итого:** 12/13 AC — чистый PASS, 1/13 (US-5 AC-6) — PASS с задокументированной оговоркой (расхождение с буквой PRD, но покрыто явным решением принятого ADR).

---

## Scope Check

- **Scope creep:** Нет.
- **Файлы диффа** (`git diff origin/main...HEAD --name-only`) — ровно те, что перечислены в ADR §8 и в задаче, плюс тесты. Нет посторонних правок в `mobile-timeline.tsx`, `prisma/schema.prisma`, `package.json`, автокомплите (#666), создании ресурса (#667), печати (#668).
- **Заявленные отклонения от буквы ADR** (все — обоснованные, не расширяющие скоуп):
  1. `export` у `getOpenCloseHours` в `src/modules/ps-park/service.ts` (ADR §8 говорит «без изменений») — единственная строка, оправдана тем, что общий слой `booking` не должен импортировать `gazebos`/`ps-park` (сохраняет инвариант изоляции доменов из ADR §8), альтернатива — дублировать хардкод часов работы в общем слое, что хуже. Принимаю.
  2. Вынос чистой арифметики в `week-dates.ts` (без Prisma) с реэкспортом из `week-timeline.ts` — не меняет публичный контракт `getWeekTimeline`, чисто структурная причина (клиентский компонент не может импортировать Prisma). Принимаю.
  3. `resizeBookingEnd` сверх четырёх функций, перечисленных в таблице ADR §5.3 п.3 — но растяжение прямо требуется тем же ADR §5.2 («Растяжение (AC-2) — отдельная зона... меняется только endTime»), список в §5.3 не претендовал на исчерпывающую сигнатуру. Естественное дополнение, не архитектурное отступление. Принимаю.
- Третий параметр `hours: WeekTimelineHours` у `getWeekTimeline(moduleSlug, weekStart, hours)`, которого нет в псевдокоде ADR §6/§7.1 — правильно объяснён (позволяет не хардкодить дефолты 11–22/4 vs 8–23/1 в общем слое и не импортировать модульные сервисы в `booking`). Не считаю это нарушением архитектуры — наоборот, соответствует духу изоляции доменов из ADR §8.
- Никаких новых модулей, никакого расширения RBAC-осей, никакого «заодно поправил» кода вне списка изменённых файлов.

---

## Архитектура

- Бизнес-логика — в `src/modules/booking/week-timeline.ts` (сервис), route-хендлеры — тонкие (parse → Zod → service → `apiResponse`), полностью по образцу `print-schedule` — соответствует CLAUDE.md и ADR §7.1.
- RBAC нового эндпоинта копирует гейт дневного собрата (`hasRole(MANAGER)` → `requireAdminSection`), а не вводит `hasModuleAccess` — ровно как предписано ADR §7.3, с обоснованием («иначе оператор видел бы день, но не неделю»).
- Drag-and-drop не создаёт новых серверных путей — переиспользует существующий, уже защищённый `rescheduleBooking()` (advisory-lock, конфликт-чек, EXCLUDE-constraint, AuditLog, Google Calendar, уведомление) — подтверждено: `src/app/api/gazebos/bookings/[id]/route.ts` отсутствует в диффе.
- `prisma/schema.prisma` не тронут — подтверждено, соответствует ADR §6 («изменений нет, миграции не нужны»).
- Общий слой `booking/week-timeline.ts` не импортирует ничего из `gazebos`/`ps-park` (изоляция доменов сохранена, см. deviation-обсуждение выше).

**Малое архитектурное наблюдение (не блокирует):** `getWeekTimeline`'s запрос ресурсов фильтрует `{ isActive: true, deletedAt: null }` (`week-timeline.ts:94`), тогда как дневной `getTimeline()` в `gazebos/service.ts:1916` фильтрует только `{ isActive: true }` (без `deletedAt`). Разница защитная (недельный вид строже), но создаёт небольшую асимметрию между дневным и недельным списком ресурсов в теоретическом крайнем случае «мягко удалён, но `isActive` всё ещё true». На практике при удалении ресурса оба поля меняются вместе (стандартный паттерн soft-delete в проекте), поэтому не считаю это багом — просто отмечаю для точности.

---

## Качество кода

- TypeScript strict: OK — `npx tsc --noEmit` — 0 ошибок (перепроверено).
- `any`/`@ts-ignore`/`eslint-disable`: OK — ни одного нового вхождения в диффе (проверено `grep`).
- Zod валидация: OK — `weekTimelineQuerySchema` валидирует единственное поле `weekStart`, лишние ключи (`dateTo` и т.п.) отбрасываются Zod по умолчанию — протестировано (`validation.test.ts`).
- API-формат: OK — `apiResponse()`/`apiValidationError()`/`apiServerError()`/`apiUnauthorized()`/`apiForbidden()` — везде штатные хелперы.
- Тесты: OK — `npx vitest run` — 327 файлов / 4555 тестов, все зелёные (перепроверено самостоятельно).
- Lint: OK — `npm run lint` — 0 ошибок, 21 warning (перепроверено самостоятельно) — все 21 в файлах, не относящихся к этому PR (`print-schedule` popup, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`); в изменённых файлах PR warning'ов нет.
- Новых npm-зависимостей нет (`package.json`/`package-lock.json` не в диффе) — `@dnd-kit/core` уже был зависимостью, соответствует ADR §10.

---

## Безопасность

### RBAC
- OK. Оба новых роута: `auth()` → `hasRole(session.user, "MANAGER")` → `requireAdminSection(session, moduleSlug)` → `rateLimit(request, "authenticated", session.user.id)` — до вызова сервиса. Копирует один-в-один гейт дневного `/timeline`, как предписано ADR §7.3 (а не `hasModuleAccess`, что обосновано в самом ADR). Подтверждено тестами: 401 без сессии, 403 для роли USER, 403 при отказе `requireAdminSection`, 429 при рейт-лимите — всё до вызова `getWeekTimeline`.
- PATCH-эндпоинт для drag не изменён — RBAC там уже стоял (`hasRole(MANAGER)` + `requireAdminSection("gazebos")` внутри «режима правки» без `status`), это подтверждено отсутствием файла в диффе.
- `userId` берётся из `session.user.id`, нигде не из body/query.

### Secrets leakage
- `git diff origin/main...HEAD | grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — пусто. Токенов, паролей, хардкода секретов нет.
- `.env*` не затронут.

### Утечки данных
- `WeekTimelineResource`/`WeekTimelineBooking` содержат ровно те же поля, что уже отдаёт дневной `/timeline` (имя, вместимость, цена/час, клиентское имя/телефон, статус, суммы наличных/карты) — никаких новых PII, внутренних ID пользователей, `googleCalendarId` или токенов. Подтверждено чтением `week-timeline.ts:19-54` и сравнением с существующим `TimelineData`.

### Injection
- Нет `$queryRaw`/`$executeRawUnsafe` — весь доступ к БД через Prisma query builder (`findMany` с типизированным `where`).
- Нет `dangerouslySetInnerHTML` в новых компонентах — `clientName`/`comment` рендерятся как текст JSX (React экранирует).

### Supply chain
- Новых зависимостей нет.

### Dangerous ops
- Нет `rm -rf`, `git push --force`, деструктивных миграций — миграций нет вообще.

**Инцидентов не найдено.**

---

## Что хорошо

- Тестовое покрытие AC-исчерпывающее и явно привязано к номерам AC/issue в комментариях тестов — заметно облегчает верификацию соответствия PRD.
- Мокирование `@dnd-kit/core` в `timeline-grid.test.tsx` через захват колбэков `DndContext` — чистый способ протестировать drag-логику без эмуляции реальных pointer-событий; покрывает ровно то, что нужно (тело PATCH, откат при 409, no-op при микросдвиге, клик без движения).
- Чистые функции `timeline-drag.ts` и `week-dates.ts` вынесены без DOM/Prisma зависимостей — юнит-тестируемы напрямую, соответствует принципу ADR §5.3 п.3.
- Деривация `openHour`/`closeHour` из `data.hours`, а не хардкод — сохраняет параметризацию модуля (#434) и в дневной, и в недельной сетке.
- Три задокументированных отклонения от буквы ADR (§ в задании) — каждое по существу минимально и обосновано инвариантами самого ADR (изоляция доменов), а не удобством разработчика.
