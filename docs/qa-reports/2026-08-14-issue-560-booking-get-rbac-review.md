# Review: [P0] GET /api/{gazebos,ps-park}/bookings|timeline|active-sessions — no role check (issue #560)

## Вердикт: PASS

Branch `claude/issue-560-booking-get-rbac`, commit `2486bd1`, diff vs `origin/main`
(14 files, +474/-7, all within the 7 stated routes + their tests — no other
files touched).

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| Все 7 перечисленных GET-роутов получают явную проверку роли (401/403) | PASS | Проверено построчным diff'ом каждого из 7 файлов: `gazebos/bookings/route.ts`, `gazebos/bookings/[id]/route.ts`, `gazebos/timeline/route.ts`, `ps-park/bookings/route.ts`, `ps-park/bookings/[id]/route.ts`, `ps-park/timeline/route.ts`, `ps-park/active-sessions/route.ts`. Гейт везде — первая операция внутри `try`, до любого обращения к БД/сервису. |
| `requireAdminSection` вызывается с корректным slug модуля | PASS | `"gazebos"` — во всех 3 gazebos-роутах, `"ps-park"` — во всех 4 ps-park-роутах (`grep` подтверждает 1:1 соответствие директории и slug'а, без перекрёстных подмен). |
| Независимый sweep — нет пропущенных GET-роутов с тем же анти-паттерном | PASS | Прошёлся по всем 24 GET-хендлерам под `src/app/api/{gazebos,ps-park}/**`. Все остальные либо уже были защищены (`analytics`, `marketing`, `settings`, `shift`, `sessions/[id]`, `bookings/[id]/history`), либо намеренно публичны и не содержат PII (`/api/gazebos`, `/api/gazebos/[id]`, `/api/gazebos/availability`, `/api/ps-park`, `/api/ps-park/[id]`, `/api/ps-park/availability`, `/api/{module}/health`) — эти пути явно в allowlist `isPublicApiRoute` в `src/lib/auth.config.ts` и отдают только справочные данные о ресурсах (имя/вместимость/цена/слоты), без имени/телефона клиента. |
| Существующие легитимные вызовы (booking-history-table, ps-park-booking-history-table, ActiveSessionsPanel, timeline-grid) не ломаются | PASS | Все компоненты, дергающие эти 7 эндпоинтов, смонтированы только под `src/app/admin/{gazebos,ps-park}/**`. `src/lib/auth.config.ts` `authorized()` уже требует `MANAGER`+ с проверкой `adminSections.includes(section)` для любого `/admin/*` пути (строки 186–211) — то есть до рендера этих компонентов пользователь уже прошёл ровно тот же уровень доступа, что теперь проверяет и сам route handler. Дублирование гейта — по дизайну (defense in depth), не регрессия. |
| Тесты добавлены/расширены для всех 7, зелёный `npm test` | PASS | Полный прогон: `Test Files 251 passed, Tests 3598 passed`. `tsc --noEmit` чист. |

---

## Специфичная проверка (по пунктам задания)

1. **Гейт на всех 7, без пропусков и без смещения после DB-доступа** — подтверждено. В `bookings/[id]/route.ts` (оба модуля) гейт стоит перед `getBooking(id)`; в списках — перед `searchParams`/`safeParse`/сервисом; в `active-sessions` — перед `getActiveSessions()`. Нигде гейт не «утоплен» в условной ветке, которая могла бы быть обойдена.

2. **`requireAdminSection(session, "gazebos" | "ps-park")` — соответствие slug'а роуту** — подтверждено, без перепутывания (см. таблицу AC выше и точный `grep` по обоим наборам файлов).

3. **Независимый sweep на пропущенные роуты** — выполнен по всем 24 GET-хендлерам в обоих модулях (список приведён выше), плюс проверено, что `rental`/`nedelovoy` не используют общие `listBookingsPaginated`/`getTimeline`/`getActiveSessions` из `booking`-core (у них свой набор функций, инцидент #527/#528 их уже закрыл). Пропусков в рамках заявленных 7 не найдено.
   - **Побочная находка (не блокирует этот PR, не в его диффе):** `src/app/api/ps-park/bookings/[id]/bill/route.ts` (`GET`) проверяет `hasRole(session.user, "MANAGER")`, но **не** вызывает `requireAdminSection`/`hasModuleAccess` — MANAGER, привязанный к другому модулю (например, `cafe`), технически может запросить счёт по booking id чужого модуля (PS Park), зная/подобрав UUID брони. Это отдельный, менее критичный (не открыт для `USER`/анонимов, нет листинга — нужен конкретный id) и не затронутый данным PR баг. Рекомендация: завести отдельный issue (аналогичный шаблону #560) на добавление `requireAdminSection(session, "ps-park")` в этот файл — не расширять текущий PR (по правилу CLAUDE.md «один PR = одна фича»).

4. **Легитимные вызовы не ломаются** — подтверждено через `authorized()` в `src/lib/auth.config.ts`: `/admin/gazebos/**` и `/admin/ps-park/**` уже требуют `MANAGER`+ с проверкой `adminSections`, поэтому все клиентские компоненты (`booking-history-table.tsx`, `ps-park-booking-history-table.tsx`, `active-sessions-panel.tsx`, `timeline-grid.tsx`, `mobile-timeline.tsx`) и так рендерятся только в контексте, который пройдёт новый route-level гейт.

5. **Качество тестов** — неоднородное внутри самого PR:
   - `gazebos/bookings/[id]`, `ps-park/bookings/[id]`, `gazebos/timeline`, `ps-park/timeline`, `ps-park/active-sessions` (5 из 7 роутов) — тесты мокают `requireAdminSection` явно и добавляют кейс `"respects requireAdminSection denial"` с сессией `role: "MANAGER"` (не SUPERADMIN) — то есть реально проверяют, что гейт модуля вызывается и его отказ учитывается, а не просто полагаются на bypass для SUPERADMIN.
   - `gazebos/bookings/route.ts` и `ps-park/bookings/route.ts` (списки, 2 из 7) — **этого кейса нет**. Тестовый файл вообще не мокает `requireAdminSection` (`grep` подтверждает — упоминается только в комментарии), полагаясь на реальную реализацию через SUPERADMIN-bypass (`role === "SUPERADMIN" && !STRICT_ACCESS_MODULES.has(section)` → `return null` без похода в БД). Это ровно тот риск, о котором сказано в задании: если бы вызов `requireAdminSection(session, "gazebos")` был случайно удалён из `bookings/route.ts` при будущем рефакторинге, ни один текущий тест этого файла не упал бы — `hasRole(session.user, "MANAGER")` и `auth()`-проверки остались бы нетронуты, а SUPERADMIN счастливо прошёл бы в обоих случаях (с гейтом и без). Само по себе это не действующая уязвимость сегодня (я вручную сверил, что вызов в коде присутствует и slug верный), но это пробел в mutation-покрытии именно тех двух роутов, что отдают самые массовые PII-данные (полный список броней с именем/телефоном), а не единичную запись.
   - **Рекомендация (некритичная, не блокирует мердж этого P0-фикса):** добавить в `gazebos/bookings/__tests__/route.test.ts` и `ps-park/bookings/__tests__/route.test.ts` мок `requireAdminSection` + тест на `role: "MANAGER"` с отказом модуля, по образцу уже существующих 5 файлов — для консистентности и защиты от будущей регрессии.

6. **Scope creep / секреты / прочее** — не найдено. Дифф ограничен ровно 7 роутами + их тестами. Новых зависимостей, миграций, изменений в `auth.config.ts`/`permissions.ts`/`api-response.ts` нет — переиспользован существующий паттерн 1-в-1 с PATCH/DELETE-хендлерами тех же файлов. `grep` по diff на секреты/токены/raw SQL/`dangerouslySetInnerHTML` — чисто.

---

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — только 7 route.ts + 7 test-файлов

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` чист)
- Zod валидация: не затронута этим PR (существующие схемы не менялись)
- API формат: OK (`apiUnauthorized()`/`apiForbidden()` — стандартные хелперы)
- Тесты: OK, с одной некритичной несогласованностью (см. п.5 выше)

## Безопасность
- RBAC: OK — все 7 заявленных роутов закрыты корректным гейтом (`auth()` → `hasRole(MANAGER)` → `requireAdminSection(section)`), идентичным уже принятому паттерну PATCH/DELETE в тех же файлах. Независимый sweep остального `gazebos`/`ps-park` API не выявил дополнительных пропусков в рамках заявленной уязвимости.
- Утечки данных: OK в границах этого диффа. Отдельно зафиксирована (см. п.3) уже существующая, не относящаяся к этому PR брешь в `ps-park/bookings/[id]/bill/route.ts` (GET) — рекомендовано отдельным issue, не блокирует этот мердж.

## Что исправить (если NEEDS_CHANGES)
Не применимо — вердикт PASS. Рекомендации выше (тест-консистентность для `bookings/route.ts` x2, отдельный issue на `bill/route.ts`) — некритичны и не блокируют мердж этого P0-фикса.

## Что хорошо
- Гейт 1-в-1 повторяет уже принятый и проверенный в проде паттерн PATCH/DELETE в тех же файлах — минимальный риск регрессии, максимальная предсказуемость ревью.
- Комментарии в тестах (`// #560: ...`) явно объясняют, какую уязвимость закрывает каждый новый кейс — хорошо для будущих ревьюеров.
- 19 из новых assertions действительно красные на пред-фикс коде (заявлено разработчиком, подтверждено мануальной сверкой diff — гейт физически отсутствовал в исходных версиях всех 7 файлов).
- Полный `npm test` зелёный (3598/3598), `tsc --noEmit` чист.
