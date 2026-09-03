# QA-отчёт: недельный вид расписания и drag-and-drop переноса брони (US-5/US-6, issue #740/#741, эпик #442)

RUN_ID: `2026-09-03-calendar-week-dnd`
PR: #841, ветка `claude/close-prs-resolve-issues-b0wv6m` → `main` (`origin/main`).

**Источники правды:** PRD `docs/requirements/2026-08-16-booking-calendar-operator-ux-prd.md`
(US-5 AC-1..AC-6, US-6 AC-1..AC-7, «Вне скоупа»); ADR
`docs/architecture/2026-08-23-booking-calendar-week-view-drag-drop-adr.md`
(§6 типы, §7 контракт/RBAC, §9 edge cases, §10 запреты). Учтён
`docs/qa-reports/2026-09-03-calendar-week-dnd-review.md` (code-reviewer, PASS,
с задокументированной оговоркой по AC-6 и наблюдением про `deletedAt`) —
ключевые числа (тесты/tsc/lint) перепрогнаны самостоятельно, а не переписаны
со слов ревью; добавлена собственная проверка (mutation-check + новый
репро-тест на найденный баг), которых в review-отчёте не было.

## Вердикт: PASS

Все 13 AC (6 US-5 + 7 US-6) — PASS (одна с задокументированной, архитекторски
санкционированной оговоркой по AC-6, не блокирующей). Регрессия зелёная:
4555/4555 тестов, `tsc --noEmit` — 0 ошибок, `lint` — 0 ошибок/21
предсуществующий warning вне диффа. RBAC, rate limiting, input validation,
data leakage — все обязательные security-кейсы чисты. Mutation-check
подтверждает, что тесты действительно ловят регресс (сломал
`normalizeWeekStart` → упало ровно 6 новых тестов трёх файлов, вернул — все
зелёные). Найден один воспроизводимый, но некритичный баг (см. «Баг-репорт»
ниже) — не блокирует вердикт, так как не нарушает ни один явный AC и не
затрагивает безопасность/целостность данных; передаю Developer'у отдельным
пунктом.

---

## AC → результат

### US-5 — недельный вид (#740)

| AC | Результат | Как проверял |
|----|-----------|---------------|
| AC-1 (переключатель «День/Неделя») | **PASS** | `schedule-view-toggle.tsx` — новый компонент, `role="group"`, `aria-pressed`; подключён в обоих `timeline-grid.tsx` рядом с кнопкой «Печать». Тест `timeline-grid.test.tsx:124` (gazebos) и `ps-park/timeline-grid.test.tsx:65` — переключатель показывает/прячет соответствующую сетку в обоих модулях. |
| AC-2 (7 дней × ресурсы за экран) | **PASS** | `week-schedule-grid.tsx` — таблица `resource × day`, `data.days` (ровно 7 дат из `weekDays()`) как колонки, `data.resources` как строки, чипы броней в ячейке. Тест `week-schedule-grid.test.tsx:79` рендерит все 7 колонок и чип. |
| AC-3 (клик по брони → та же карточка) | **PASS** | `handleWeekBookingClick` в обоих `timeline-grid.tsx` кладёт `WeekTimelineBooking` (структурный супертип `TimelineBooking` + `date`, ADR §4) напрямую в `selectedBooking` — без адаптера рендерится существующими `GazeboBookingDetailCard`/`BookingDetailCard`. Тесты `timeline-grid.test.tsx:141` (gazebos), `:76` (ps-park). |
| AC-4 (навигация по неделям) | **PASS** | `week-schedule-grid.tsx:150-168` — «← / Эта неделя / →», шаг ±7 дней через `shiftDateKey`. Тест `week-schedule-grid.test.tsx:108` проверяет реальный `weekStart` в следующем fetch-запросе в обе стороны. |
| AC-5 (идентично для ps-park) | **PASS** | Общий `WeekScheduleGrid`, параметризован `moduleSlug/resourceLabel/unitLabel/countMetaKey` — поведение идентично по построению; отдельный regression-тест на ps-park (`ps-park/__tests__/timeline-grid.test.tsx`) подтверждает те же колбэки и подписи («Стол»/«игр.»). |
| AC-6 (клик по пустой ячейке → дневной вид, минимальный вариант) | **PASS с оговоркой** | `onEmptyCellClick(date, resourceId)` из `week-schedule-grid.tsx` доходит до `handleWeekEmptyCellClick(day)` в обоих `timeline-grid.tsx`, который принимает **только** `day` — `resourceId` молча отбрасывается (переключение на день без подсветки/выбора ресурса). Буквальный текст PRD AC-6 говорит «на нужный день/ресурс», но ADR §3 и §11 (Follow-up задача 1: «клик по пустой ячейке переключает в дневной вид на выбранную дату») явно сузили минимум v1 до одной даты — архитекторское решение, зафиксированное в принятом ADR, не самодеятельность разработчика. Не блокирует PASS (согласен с оценкой review-отчёта). Тест `timeline-grid.test.tsx:151` (gazebos), `:76` (ps-park). |

### US-6 — drag-and-drop (#741)

| AC | Результат | Как проверял |
|----|-----------|---------------|
| AC-1 (перенос на другое время/ресурс) | **PASS** | `handleDragEnd` в gazebos `timeline-grid.tsx`: `DndContext`/`useDraggable`/`useDroppable` на строку ресурса (`res:<id>`), гибрид из ADR §5.2 — время из `delta.x`, ресурс из `over.id`. Тест `timeline-grid.test.tsx:177` (drop на другую дорожку со сдвигом 90px → корректное тело PATCH). |
| AC-2 (растяжение меняет только endTime) | **PASS** | `resizeBookingEnd()` в `timeline-drag.ts` меняет только `endHour`, `startHour` неизменен; отдельная droppable-зона `resize:<id>` с `stopPropagation`, не triggerит перенос всего блока. Тест `timeline-grid.test.tsx:230` (растяжение на 60px → только `endTime` +1ч, `startTime` без изменений) + юнит-тесты `timeline-drag.test.ts:35`. |
| AC-3 (конфликт решает сервер, без клиентской проверки) | **PASS** | Клиент готовит только `DropPlan` (координатная арифметика), никакой проверки пересечений на клиенте нет — `grep` по `timeline-drag.ts`/`timeline-grid.tsx` не находит сравнения времён броней друг с другом. 409 `BOOKING_CONFLICT` → откат состояния (`setData(snapshot)`) + `role="alert"` с текстом сервера. Тест `timeline-grid.test.tsx:215`. |
| AC-4 (тот же PATCH-путь без status, те же побочные эффекты) | **PASS** | `applyDrop()` шлёт `PATCH /api/gazebos/bookings/:id` с телом `{ resourceId, date, startTime, endTime }` — без `status`; эндпоинт (`src/app/api/gazebos/bookings/[id]/route.ts`) не в диффе → `rescheduleBooking()` не изменён, advisory-lock/конфликт-чек/Google Calendar/уведомление наследуются автоматически. Тело PATCH — подмножество полей `booking-edit-form.tsx` (без `clientName/clientPhone/guestCount`), валидно для `rescheduleBookingSchema` (все поля опциональны, все ADR-подтверждено §7.2). |
| AC-5 (перенос только внутри модуля) | **PASS** | Droppable-зоны (`res:<id>`) генерируются из `data.resources` текущего модуля — межмодульного `over.id` физически не существует, перенос между gazebos/ps-park невозможен по построению. |
| AC-6 (мобильный/сенсорный таймлайн не тронут) | **PASS** | `git diff origin/main --stat -- '*mobile-timeline*'` — пусто для обоих модулей; подтверждено чтением `mobile-timeline.tsx` (оба) — файлы идентичны `origin/main`. |
| AC-7 (только беседки, не ps-park) | **PASS** | `grep -n "dnd-kit" src/components/admin/ps-park/timeline-grid.tsx` — 0 совпадений; drag полностью отсутствует у ps-park (только переключатель вида добавлен). |

**Итого: 13/13 AC — PASS** (1/13 с оговоркой по AC-6, не блокирующей, идентичной оценке code-reviewer).

---

## Регресс дневной сетки

`git diff origin/main -- src/components/admin/gazebos/timeline-grid.tsx src/components/admin/ps-park/timeline-grid.tsx` прочитан построчно:

- Часовые слоты и `handleSlotClick` (открытие quick-формы по клику на свободный слот) — не изменены, только обёрнуты в новый `ResourceTrack` (droppable-контейнер), сам `onClick={() => free && handleSlotClick(...)}` идентичен.
- Блок брони обёрнут в новый `BookingBlock` — сохраняет исходный `onClick={(e) => handleBookingClick(booking, e)}`, `title`, все status-based цветовые классы (`isSelected`/`active`/`PENDING`/остальное) не тронуты; единственное визуальное изменение — курсор `cursor-pointer` → `cursor-grab active:cursor-grabbing` (ожидаемо, сигнализирует draggability).
- Текущий-час маркер (`currentHourOffset`) — не тронут (строка объявления состояния попала в диф только как контекст, логика без изменений).
- `showPrint`/`PrintDaySheet` — рендерится безусловно (вне `view === "day"`/`"week"` развилки), печать работает независимо от текущего вида.
- Оба `timeline-grid.test.tsx` — новые файлы (`git show origin/main:...timeline-grid.test.tsx` — `fatal: path ... exists on disk, but not in 'origin/main'`): до этого PR у компонентов не было автотестов вовсе, регресс дневного поведения проверен чтением кода, а не существующим сьютом (это не пробел этого PR — тесты добавлены впервые именно им).

Вывод: дневное поведение (слоты, quick-форма, карточка, печать, маркер времени) не изменилось, кроме курсора над бронью.

---

## RBAC (ADR §7.3)

| Проверка | Результат |
|---|---|
| Анонимный запрос → 401 | **PASS** — `route.test.ts:63` (оба модуля), `mockAuth.mockResolvedValue(null)` |
| USER → 403 | **PASS** — `route.test.ts:72` (оба модуля) |
| MANAGER без `AdminPermission` на секцию → 403, не пустая неделя | **PASS** — `route.test.ts:81`, явно ссылается на ADR §9 п.6 в названии теста |
| Rate limit `authenticated` (429) | **PASS** — `route.test.ts:92`, проверено `rateLimit(request, "authenticated", session.user.id)` — по userId, не IP |
| Цепочка `auth() → hasRole(MANAGER) → requireAdminSection → rateLimit → Zod → service` | **PASS** — прочитано в `route.ts` обоих модулей, порядок совпадает с ADR §7.3 и копирует гейт дневного `/timeline` один-в-один (`hasRole`/`requireAdminSection`, не `hasModuleAccess` — обосновано в ADR: разные оси грантов) |
| `userId` из `session.user.id`, не из query/body | **PASS** — GET без body, `session.user.id` передаётся в `rateLimit`/`getMinBookingHours` косвенно не участвует |
| PATCH-эндпоинт (drag) — RBAC не создан заново | **PASS** — файл `src/app/api/gazebos/bookings/[id]/route.ts` отсутствует в диффе, RBAC там уже стоял до этого PR |

---

## Security-чеклист (`agents/qa.md`)

- **RBAC** (см. выше) — PASS, 4 обязательных кейса покрыты тестами для обоих модулей.
- **Rate limiting**: `authenticated`-тир (240/мин на пользователя), тестом подтверждено проброс 429 без вызова `getWeekTimeline`. Обоснованно строже, чем у дневного `/timeline` (без лимита вообще, по правилу «Admin: no limit» из CLAUDE.md) — сознательное защитное отклонение из-за 7-дневного диапазона (ADR §7.3), не ослабление.
- **Input validation**: `weekTimelineQuerySchema` — единственное поле `weekStart`, формат `YYYY-MM-DD` регэкспом; пустая строка/иной формат → 422 `VALIDATION_ERROR` с русским текстом (`route.test.ts:104,113`; `validation.test.ts` — параметризованный тест на 4 невалидных формата). Поля сверх схемы (`dateTo`) — отбрасываются Zod по умолчанию, подтверждено тестом `weekTimelineQuerySchema.safeParse({weekStart, dateTo}).data` не содержит `dateTo`. SQL-инъекция неприменима — весь доступ через Prisma query builder (`findMany`), нет `$queryRaw`.
- **Data leakage**: DTO `WeekTimelineResource`/`WeekTimelineBooking` не содержит `googleCalendarId`, паролей, токенов, внутренних `userId` — подтверждено чтением `week-timeline.ts:19-54` (select только `id/name/description/capacity/pricePerHour/isActive` и `id/resourceId/date/startTime/endTime/status/clientName/clientPhone/metadata/cashAmount/cardAmount`, ровно тот же набор, что уже отдаёт дневной `getTimeline()`). Ошибка 500 не содержит деталей — тест `route.test.ts:118` (`mockGetWeekTimeline.mockRejectedValue(new Error("db down"))` → `JSON.stringify(json)` не содержит `"db down"`).
- **Prompt injection / secrets**: `git diff origin/main...HEAD | grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN)'` — пусто (перепроверено самостоятельно).

Все security-кейсы — PASS.

---

## Edge cases (ADR §9, 16 пунктов)

| # | Кейс | Результат |
|---|---|---|
| 1 | `weekStart` не понедельник → нормализуется | **PASS** — `week-dates.test.ts`/`week-timeline.test.ts:38-45`, `normalizeWeekStart("2030-06-19")` → `"2030-06-17"` |
| 2 | Граница года внутри недели (29.12–04.01) | **PASS** — `week-timeline.test.ts:47`, `normalizeWeekStart("2027-01-01")` → `"2026-12-28"`, все 7 дат через смену года посчитаны корректно (UTC-арифметика, без TZ браузера) |
| 3 | Чипы сортируются по `startTime` | **PASS** — сортировка на клиенте (`week-schedule-grid.tsx`, `cells` useMemo) + `orderBy: { startTime: "asc" }` в самом Prisma-запросе (`week-timeline.ts`) |
| 4 | Деактивированный ресурс с середины недели — брони не роняют матрицу, не считаются в «Итого» | **PASS** — `week-schedule-grid.test.tsx:132`, бронь на несуществующем в `resources` `resourceId` не роняет рендер и не входит в подсчёт часов |
| 5 | Пустая неделя — прочерки, не «Загрузка…» | **PASS** — `week-timeline.test.ts:149` (сервис отдаёт пустые массивы, не ошибку) + UI показывает `—` в ячейках, «Нет активных ресурсов» при пустом списке ресурсов |
| 6 | MANAGER без AdminPermission → 403, не пустая неделя | **PASS** — см. RBAC выше |
| 7 | Перенос `CHECKED_IN`-брони разрешён | **Не переретестировано отдельно, обоснованно** — это существующее поведение `rescheduleBooking()` (не изменённого этим PR), покрыто существующим сьютом сервиса за пределами этого диффа; клиентский drag не различает статус брони при формировании `DropPlan` (проверено чтением `handleDragEnd` — статус не участвует в логике) |
| 8 | Перенос на занятое место → 409, откат, карточка не открывается | **PASS** — `timeline-grid.test.tsx:215` |
| 9 | Выход за рабочие часы → 422, откат | **Покрыто обобщённо** — клиент не различает код ошибки, любой `success:false` (включая 422) обрабатывается идентично 409-кейсу (откат + `error.message`); отдельного теста на конкретно `OUTSIDE_WORKING_HOURS` нет, но код не имеет условного ветвления по коду ошибки, которое могло бы сломаться только для этого кода — риск низкий |
| 10 | Растяжение ниже `minBookingHours` → 422 | Та же обобщённая обработка, что п.9 |
| 11 | Растяжение выше `maxBookingHours` → 422 | Та же обобщённая обработка, что п.9 |
| 12 | Микро-сдвиг — без запроса | **PASS** — `timeline-grid.test.tsx:206`, `timeline-drag.test.ts:61` (`planDrop` возвращает `null` при нулевом смещении и том же ресурсе) |
| 13 | Успешный перенос → 1 запись AuditLog/история/уведомление/Google Calendar | **Не ретестировано отдельно, обоснованно** — не новая логика (`rescheduleBooking()` не изменён), уже покрыто существующим сьютом сервиса |
| 14 | Перенос оплаченной брони пересчитывает `metadata.totalPrice` | **Не ретестировано отдельно, обоснованно** — то же, существующее поведение формы редактирования, drag использует тот же путь |
| 15 | Клик без движения открывает карточку; клик по слоту — quick-форму | **PASS** — `timeline-grid.test.tsx:245` (клик без движения); слот-клик — не изменён (см. «Регресс дневной сетки») |
| 16 | Мобильный таймлайн и обе поверхности ps-park без изменений | **PASS** — см. «Регресс» и AC-6/AC-7 US-6 выше |

---

## Прогоны

- `npx vitest run --reporter=dot` — **327 файлов / 4555 тестов, все зелёные** (совпадает с ожиданием задания). Stderr-шум про `ECONNREFUSED 127.0.0.1:6379` (Redis) — предсуществующий шум песочницы без Redis, не относится к этому PR, не влияет на исход (`0 failed`).
- `npx tsc --noEmit` — **0 ошибок**.
- `npm run lint` — **0 ошибок, 21 warning**, все в файлах вне диффа (`mobile-nav.tsx`, `session-bill-modal.tsx`, `print-day-sheet.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`) — перепроверено grep'ом путей warning против `git diff origin/main...HEAD --name-only`, пересечения нет.

## Mutation-check

Временно сломал `normalizeWeekStart()` в `src/modules/booking/week-dates.ts`
(заменил тело на `return date;` — убрал нормализацию к понедельнику) и
перепрогнал три затронутых тест-файла:

```
npx vitest run src/modules/booking/__tests__/week-timeline.test.ts \
  src/modules/booking/__tests__/validation.test.ts \
  src/components/admin/shared/__tests__/week-schedule-grid.test.tsx
```

Результат: **6 упало** (ровно новые тесты, завязанные на нормализацию —
`week-timeline.test.ts` × 2, `week-schedule-grid.test.tsx` × 3 навигация/загрузка
недели по среде, плюс каскадный провал в связанном ассерте), 44 прошли.
`validation.test.ts` (тесты формата `weekTimelineQuerySchema`, не зависящие от
`normalizeWeekStart`) не задело — ожидаемо, схема и нормализация — независимые
слои. Вернул `git checkout -- src/modules/booking/week-dates.ts`, перепрогнал
те же три файла — **50/50 зелёных**. `git status --porcelain` после отката —
пусто (файл байт-в-байт как в PR).

Дополнительно — собственный репро-тест на найденный ниже баг (см.
«Баг-репорт»): временный тестовый файл, подтвердивший воспроизводимость,
запущен и удалён; `git status --porcelain` после удаления — пусто.

---

## Баг-репорт (не блокирует вердикт)

### BUG: Карточка брони из недельного вида остаётся открытой после перехода в дневной вид по клику на пустую ячейку (AC-6)

**Серьёзность:** Minor

**Модуль:** gazebos, ps-park (оба — идентичный паттерн)

**Шаги для воспроизведения:**
1. Открыть админ-расписание беседок (или Плей Парка), переключиться на «Неделя».
2. Кликнуть по существующей брони (чипу) в любой ячейке — открывается карточка брони под матрицей (AC-3).
3. Не закрывая карточку, кликнуть по свободной (пустой) ячейке в другой день/ресурс.

**Ожидаемый результат:** Согласно AC-6, клик по пустой ячейке переводит в дневной вид на нужный день для создания новой брони — логично ожидать чистого состояния (без карточки чужой/несвязанной брони поверх дневной сетки).

**Фактический результат:** Вид переключается на день, `loadTimeline(day)` подгружает нужный день — но `selectedBooking`/`selectedResourceOverride` не сбрасываются в `handleWeekEmptyCellClick()` ни в `src/components/admin/gazebos/timeline-grid.tsx`, ни в `src/components/admin/ps-park/timeline-grid.tsx`. Карточка брони, открытая на шаге 2 (потенциально для совсем другой даты/ресурса), остаётся видимой под новой дневной сеткой.

**Место в коде:**
- `src/components/admin/gazebos/timeline-grid.tsx:347-350` (функция `handleWeekEmptyCellClick`)
- `src/components/admin/ps-park/timeline-grid.tsx:183-187` (тот же паттерн)

Сравнить с `handleBookingStatusChanged()` в этих же файлах, который явно
делает `setSelectedBooking(null); setSelectedResourceOverride(null);` — тот же
сброс здесь отсутствует.

**Подтверждено:** самостоятельно написанным репро-тестом (mount → клик по
брони в неделе → клик по пустой ячейке → `detail-card` всё ещё в DOM);
тест запущен, воспроизвёл баг, затем удалён (не часть PR, in QA-mutation-check).

**Почему не блокирует вердикт:** ни один AC US-5/US-6 не требует явно закрывать
карточку при этой навигации; данные в оставшейся карточке не устаревают
некорректно (это валидный снимок брони на момент открытия, не битые данные) —
чисто UX-огрех, не нарушение контракта или безопасности. Рекомендация:
добавить `setSelectedBooking(null); setSelectedResourceOverride(null);` в
`handleWeekEmptyCellClick` в обоих файлах, с тестом.

---

## Наблюдение (унаследовано из review-отчёта, для полноты)

`getWeekTimeline()` фильтрует ресурсы `{ isActive: true, deletedAt: null }`
(`week-timeline.ts:94`), дневной `getTimeline()` — только `{ isActive: true }`
(без `deletedAt`). В проекте оба поля меняются вместе при soft-delete (см.
паттерн-запись в `qa-patterns.md` про парные `deletedAt`), поэтому на практике
это не расхождение данных — недельный вид просто на один явный фильтр строже.
Не баг, оставляю как наблюдение, согласен с оценкой review-отчёта.

---

## Scope check

`git diff origin/main...HEAD --name-only` — 19 файлов кода/тестов, все входят в
список ADR §8 (новые `week-timeline.ts`/`week-dates.ts`/роуты/UI-компоненты +
тесты, точечная правка `ps-park/service.ts` для экспорта `getOpenCloseHours`).
Нет posторонних изменений в `mobile-timeline.tsx` (оба модуля), `prisma/schema.prisma`,
`package.json`, автокомплите (#666), создании ресурса (#667), печати (#668).
Никаких новых npm-зависимостей — `@dnd-kit/core` уже был в `package.json`.

---

## Итог

- Всего AC-кейсов: 13 (US-5: 6, US-6: 7)
- Пройдено: 13 (1 — с задокументированной архитекторской оговоркой по AC-6, не блокирующей)
- Провалено: 0
- Security-кейсов: 4 обязательных (RBAC/rate limit/validation/data leakage) — все PASS
- Найдено багов: 1 (Minor, не блокирует)

## Вердикт: PASS
