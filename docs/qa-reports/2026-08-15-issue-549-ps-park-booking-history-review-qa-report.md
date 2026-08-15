# QA-отчёт: Issue #549 — ревизия ps-park booking-history компонентов + checkin/no-show роутов

**Ветка**: `claude/issue-549-ps-park-booking-history-review`
**Коммит**: `3933adbc` (1 коммит поверх `main`, 2 файла)
**Тип задачи**: investigation/chore (без PRD — по формату задачи это ревизия по следам issue #444, не новая фича)

---

## Скоуп

Issue #549 — две независимые ревизионные подзадачи:

1. Issue #444 утверждал, что `ps-park-booking-history-table.tsx` и `booking-history-table.tsx` — дубли, которые нужно смёржить. #549 просил проверить это и либо смёржить, либо (если компоненты реально разные) развести имена.
2. Проверить, вызываются ли из UI роуты `src/app/api/{gazebos,ps-park}/bookings/[id]/{checkin,no-show}` после issue #436, или это мёртвый код.

**Что сделано по коммиту**: компонент `booking-history-table.tsx` (дашборд-виджет «недавние брони» на `/admin/ps-park`) переименован в `recent-bookings-table.tsx`, `BookingHistoryTable` → `RecentBookingsTable`, `HistoryBooking` → `RecentBooking`. Второй компонент `ps-park-booking-history-table.tsx` не тронут. Подзадача 2 — только ревизия, изменений нет.

---

## Независимая проверка

### 1. Регрессия — `npm test`, `tsc`, `eslint`

| Проверка | Результат |
|---|---|
| `npm test -- --run` | **PASS** — 257 test files, 3695 tests, все зелёные |
| `npx tsc --noEmit` | **PASS** — без ошибок |
| `npx eslint src/app/admin/ps-park/page.tsx src/components/admin/ps-park/recent-bookings-table.tsx` | **PASS** — без замечаний |

### 2. Подзадача 1 — «дубли или нет», качество решения

Прочитал оба компонента целиком:
- `src/components/admin/ps-park/recent-bookings-table.tsx` (289 строк) — `RecentBookingsTable`: получает `bookings`/`resourceMap` пропсами от родительского RSC (`/admin/ps-park` page.tsx), не делает собственную загрузку списка, без пагинации, без фильтров/поиска. Имеет собственный «побочный» fetch по клику на завершённую бронь (`GET /api/ps-park/bookings/:id/bill` → модалка чека) — это не list-фетч, а detail-по-требованию, так что заявление «без своей загрузки/пагинации/фильтров» в коммит-сообщении и doc-комментарии в целом корректно, хоть и не абсолютно буквально (см. замечание ниже).
- `src/components/admin/ps-park/ps-park-booking-history-table.tsx` (275 строк) — `PSParkBookingHistoryTable`: полностью самодостаточная таблица на отдельной странице `/admin/ps-park/bookings` — свой `useEffect`-фетч `GET /api/ps-park/bookings`, пагинация, debounced поиск (#438), фильтры по статусу/датам, `SUPERADMIN`-only удаление с password-confirm, разворачиваемая лента аудита (`BookingHistory`).

Diff между старым `booking-history-table.tsx` (на `main`) и новым `recent-bookings-table.tsx` — **чистый rename**: только идентификаторы (`HistoryBooking`→`RecentBooking`, `BookingHistoryTable`→`RecentBookingsTable`) плюс добавленный doc-комментарий сверху файла. Ни одной строки логики не изменено. Проверено построчным diff.

**Моя независимая оценка**: согласен с выводом «это два архитектурно разных компонента, не дубли» — они различаются по всем значимым осям (источник данных: props vs self-fetch; пагинация: нет vs есть; фильтры/поиск: нет vs есть; RBAC-действия: нет vs SUPERADMIN-delete; аудит: нет vs есть). Слияние действительно потребовало бы либо гибридного компонента с двумя режимами (probs-driven / self-fetching) за одним именем, либо протаскивания через props всего state, который сейчас инкапсулирован во втором компоненте — в обоих случаях получается менее читаемый код ради устранения не-дублирования, а не дублирования. Решение «переименовать более общее/путающее имя, оставить раздельно» — то же самое, что сделал бы я на этом месте; вариант "смёржить" из issue не подошёл бы.

Единственное, к чему я бы придрался — само название `RecentBookingsTable` всё ещё не идеально: слово «recent» ничего не говорит про сам факт «only COMPLETED/CANCELLED», но это тонкость нейминга, не блокер, и явно лучше прежнего почти-дубликата имени.

### 3. Подзадача 2 — checkin/no-show роуты, независимая проверка

Прочитал все 4 файла из description:
- `src/components/admin/ps-park/booking-actions.tsx`, `src/components/admin/gazebos/booking-actions.tsx` — оба содержат `handleCheckIn()` / `handleMarkNoShow()`, вызывающие `POST /api/{module}/bookings/:id/checkin` и `/no-show`, привязанные к реальным `onClick` на видимых кнопках (не dead code, не закомментировано).
- `src/components/admin/ps-park/booking-detail-card.tsx`, `src/components/admin/gazebos/booking-detail-card.tsx` — та же пара хендлеров, тоже вызываются с кнопок в детальной карточке брони.

Подтверждаю: роуты живые, вызываются из UI в обоих модулях, изменений не требовалось. Комментарий про #436 в коммите соответствует истории — grep по `git log` подтверждает issue #436 действительно чинил именно это (роуты существовали, но были не подключены к кнопкам).

### 4. Отсутствие «хвостов» старого имени

```
grep -rn "BookingHistoryTable\b|HistoryBooking\b|booking-history-table" src/
```
— единственные совпадения: `PSParkBookingHistoryTable` (нетронутый второй компонент, корректно) и `GazeboBookingHistoryTable` (модуль gazebos, корректно не тронут — там нет коллизии имён, подтверждено: единственный `booking-history-table.tsx` там уже был у себя однозначно назван и не имеет dashboard-дубликата-виджета). Никаких сохранившихся импортов старого `BookingHistoryTable`/`HistoryBooking` из ps-park не найдено. `git diff main...HEAD --stat` — ровно 2 файла, как и заявлено.

### 5. Визуальная проверка (браузер)

Поднял окружение локально: `service postgresql start`, `redis-server --daemonize yes`, применил `.env` из `.env.example` (с временно обнулёнными `VK_CLIENT_ID/SECRET` — placeholder-значения из `.env.example` ломают NextAuth VK ID provider validation при пустом `issuer`/`userinfo`; это artefact дев-окружения, не связан с PR). БД уже содержала применённую схему и dev-пользователей (`admin@local`/`admin` SUPERADMIN, `manager@local`/`manager` MANAGER). Добавил 2 временные тестовые брони ps-park (`COMPLETED`, `CANCELLED`) — иначе секция «История» рендерит пустой стейт и не проверяет собственно таблицу.

Запустил `npm run dev`, залогинился как `admin@local` (verified через `/api/auth/callback/credentials`, session cookie рабочий), открыл `/admin/ps-park` через headless Chromium (Playwright, `/opt/pw-browsers/chromium`), сделал полный и секционный скриншот. Результат:

- Страница отдаёт 200, без React/hydration ошибок, без error boundary.
- Секция «История» рендерится корректно: заголовок, обе тестовые записи (одна `COMPLETED` со значком «чек» и ссылкой «Подробнее», одна `CANCELLED`), бейджи статусов, телефон + кнопка звонка — визуально соответствует прежнему поведению `BookingHistoryTable`, просто под новым именем компонента.
- Проверил также как `manager@local` (после выдачи `AdminPermission` на секцию `ps-park` — см. замечание ниже) — тот же рендер, значит рендер не завязан специфично на роль.
- В консоли браузера — предупреждение `Only plain objects can be passed to Client Components... Decimal` (см. «Дополнительное наблюдение» ниже) и один `ERR_CONNECTION_RESET`, похожий на артефакт HMR-вебсокета Turbopack-dev-сервера, а не реальная ошибка приложения. **Оба не относятся к изменённым файлам этого PR.**

Тестовые брони и временный `AdminPermission` удалены из БД после проверки; репозиторий (`git status`) чист, `.env` в `.gitignore`.

---

## Дополнительные наблюдения (вне скоупа PR, не блокируют вердикт)

Оба найдены случайно при попытке визуальной проверки, не связаны с изменёнными файлами (`git diff main...HEAD --stat` подтверждает — оба явления воспроизводятся кодом, который этот PR не трогает):

1. **Pre-existing**: `getTimeline()` в `src/modules/ps-park/service.ts` возвращает сырые `Resource` (включая `pricePerHour: Decimal`) в `TimelineData.resources`, который прокидывается пропом в клиентские компоненты `TimelineGrid`/`MobileTimeline` — React выдаёт `console.error` "Only plain objects can be passed to Client Components from Server Components... Decimal objects are not supported" на каждый рендер `/admin/ps-park`. Не регрессия этого PR (`service.ts` не в диффе), но стоит завести отдельный issue — шумит в консоли на каждой загрузке страницы.
2. **Pre-existing, dev-tooling gap**: `scripts/seeds/dev-overlay.ts` создаёт `manager@local` с `ModuleAssignment` на `ps-park`/`gazebos` (используется `hasModuleAccess()` для API), но НЕ создаёт `AdminPermission` (используется `authorized()` callback в `src/lib/auth.config.ts` для доступа к `/admin/*` UI-роутам). Итог: задокументированный dev-логин `manager@local`/`manager` при чистом сиде получает 302 → `/admin/forbidden` на **любую** секцию `/admin/*`, несмотря на корректный `ModuleAssignment`. Не связано с #549, но затрудняет ручную/dev-проверку под MANAGER — возможно стоит отдельным issue дополнить `dev-overlay.ts` созданием `AdminPermission`.

Оба зафиксированы для трекинга, не входят в вердикт по #549.

---

## Итог по чек-листу

| Пункт | Статус |
|---|---|
| `npm test` зелёный | PASS |
| `npx tsc --noEmit` зелёный | PASS |
| `eslint` на изменённых файлах чист | PASS |
| Подзадача 1 — независимая оценка «не дубли, rename оправдан» | PASS, согласен с выводом |
| Подзадача 2 — независимая проверка живых checkin/no-show вызовов | PASS, подтверждено чтением всех 4 файлов |
| Нет «хвостов» старого имени в `src/` | PASS |
| Diff ограничен 2 файлами | PASS |
| Визуальная проверка в браузере (rename не ломает рендер) | PASS — реальный скриншот, не только код-ревью |
| RBAC (SUPERADMIN, MANAGER) — обе роли видят секцию корректно | PASS |
| Security-кейсы (RBAC/rate-limit/input validation/data leakage) | N/A — чистый rename, новой API-поверхности/инпутов нет |

---

## Вердикт: PASS

Rename обоснован, реализован чисто (без побочных изменений логики), не оставляет "хвостов" старого имени, не ломает типы/тесты/линт и визуально подтверждён в браузере — секция «История» на `/admin/ps-park` рендерится идентично прежнему поведению под новым именем компонента. Вывод по подзадаче 2 (checkin/no-show — живой код) независимо перепроверен и подтверждён. Обнаруженные два наблюдения — pre-existing, не в диффе этого PR, не блокируют.
