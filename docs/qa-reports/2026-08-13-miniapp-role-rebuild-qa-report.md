# QA: Ролевой ребилд Telegram Mini App «Деловой»

## Вердикт: PASS

RUN_ID `2026-08-13-miniapp-role-rebuild`. Branch `claude/delovoypark-miniapp-rebuild-gtnc5p`, HEAD `f5897ce`.
PRD: `docs/requirements/2026-08-13-miniapp-role-rebuild-prd.md`. ADR: `docs/architecture/2026-08-13-miniapp-role-rebuild-adr.md`.
Review-отчёт для этого RUN_ID в `docs/qa-reports/` отсутствует на момент проверки — весь код и тест-план проверены самостоятельно (прочитан диф, а не пересказ ADR).

**Важная оговорка по диффу:** локальная ветка `main` в этом окружении отстаёт от `origin/main` на ~15 релизов (`git merge-base main HEAD` = `ac1afca`, тогда как `origin/main` HEAD = `555347c`). `git diff main...HEAD --stat` поэтому тянет тысячи посторонних строк из уже смерженных PR (booking history, no-show fix и т.д.). Все находки ниже проверены по `git diff origin/main...HEAD` — это и есть реальный скоуп фичи (82 файла, +9810/-1105).

Счёт AC: **43/44 подтверждено кодом+тестами, 1/44 (AC-7.5) требует владельца** — это не FAIL согласно заданию.

---

## Регрессионные гейты

| Проверка | Результат |
|---|---|
| `npm test -- --run` | **226 файлов / 3378 тестов, все зелёные** (41.16s) |
| `npx tsc --noEmit` | Чисто, вывода нет |
| `npm run lint` | 0 ошибок, 15 warning'ов — **все** в файлах, не тронутых этим PR (`messenger/*`, `telephony/novofon-client.ts`), кроме одного pre-existing unused-import warning в `notifications/service.ts` (`getRecipientUserIds`), которое подтверждено уже существовавшим в `origin/main` до этого PR (`git show origin/main:src/modules/notifications/service.ts \| grep getRecipientUserIds`) |
| `git diff origin/main...HEAD --stat` | 82 файла, +9810/-1105. Новых `src/modules/` нет (только файлы внутри уже существующего `notifications`). Затронутые поверхности: `notifications`, `src/app/webapp/`, `src/app/api/webapp/`, `bot/handlers/team-settings.ts`, `.github/workflows/deploy.yml`, `prisma/schema.prisma`+2 миграции, `CLAUDE.md` — ровно то, что зафиксировал ADR, без scope creep |
| `cafe`/`gazebos`/`ps-park` `service.ts`/`validation.ts` | Не изменены — отсутствуют в диффе (кроме `gazebos/types.ts`? — нет, тоже отсутствует). Подтверждает границу скоупа PRD |
| Миграции | Обе аддитивны: `ADD COLUMN`/`CREATE INDEX`/`CREATE TABLE`/`INSERT...ON CONFLICT DO NOTHING`. Ни одного `DROP`/`TRUNCATE`/`DELETE FROM`/`ALTER TYPE`/`SET NOT NULL` |
| БД в окружении нет | Миграции и бэкфилл проверены чтением SQL, не прогоном |

---

## AC → статус → доказательство

### US-1: Ролевая навигация и безопасный вход

| AC | Статус | Доказательство |
|---|---|---|
| 1.1 Состав навигации определяется ролью | PASS | `src/lib/webapp/navigation.ts:39-57` — `buildNavigation(caps)` единственный источник; `src/lib/webapp/__tests__/navigation.test.ts` |
| 1.2 USER: ровно 6 разделов | PASS | `navigation.test.ts:13-27` — точный список `["/webapp","/webapp/cafe","/webapp/gazebos","/webapp/ps-park","/webapp/bookings","/webapp/profile"]`, без messenger |
| 1.3 MANAGER/ADMIN/SUPERADMIN — единообразный вход в Центр | PASS | `navigation.ts:42-48` ветвится только по `caps.canNotificationCenter`, не по роли; `webapp-center.test.ts:81-92` — ADMIN и MANAGER с одинаковыми секциями получают идентичный результат (AC-5.4, та же гарантия) |
| 1.4 Таб «Чаты» скрыт | PASS | `navigation.ts` `BASE_TABS` не содержит messenger; `navigation.test.ts:23` явно проверяет отсутствие; страницы `/webapp/messenger/**` не удалены (код сохранён) |
| 1.5 Ре-чек прав из БД на чувствительных роутах | PASS | `src/lib/webapp-auth.ts:94-114` `loadWebAppStaff` читает роль из `prisma.user.findUnique`, не из токена; `webapp-auth.test.ts:97-112` — токен с `SUPERADMIN`, в БД `USER` → 403; `notification-center/route.ts` использует `loadWebAppStaff` на GET и PUT |
| 1.6 Навигация не мигает | PASS | `src/components/webapp/TabBar.tsx:19-35` — скелет-таббар до `ready===true`; `capabilities` приходят тем же ответом, что и токен (`auth/route.ts:76,94`), второй фазы «доехали права → перерисовали» нет |
| 1.7 Rate limit на `/api/webapp/auth` | PASS | `auth/route.ts:22-23` — `rateLimit(request,"public")` первая строка обработчика, до любой криптографии; `route.test.ts:70-77` — 429 блокирует до вызова `validateInitData` |
| 1.8 Явный отказ без `NEXTAUTH_SECRET` | PASS | `webapp-auth.ts:25-31` `getWebAppJwtSecret` бросает `WebAppAuthConfigError` при пустом/<16 симв. секрете, без fallback-значения; `auth/route.ts:97-104` → 503 `NOT_CONFIGURED`; `webapp-auth.test.ts:41-53`, `route.test.ts:90-104`. Подтверждено: строки `webapp-secret` (публично известный fallback) нигде в `src/` не осталось (`grep -rn "webapp-secret" src/` → пусто) |
| 1.9 Timing-safe сравнение initData | PASS | `src/lib/telegram-webapp.ts:71-80` — формат хэша проверяется регэкспом до `Buffer.from`, сравнение через `crypto.timingSafeEqual`; `telegram-webapp.test.ts:53-61` — поддельный хэш корректной длины и хэш неверной длины/формата оба дают `null` без исключения |

### US-2: Главная — лента гостя парка

| AC | Статус | Доказательство |
|---|---|---|
| 2.1 Единая лента (объявления + личные уведомления), сорт. по времени | PASS | `src/modules/notifications/feed.ts:353-418` `getWebappFeed` — merge двух источников, `sort((a,b)=>b.createdAt-a.createdAt)`; `feed.test.ts:170-181` |
| 2.2 Источник — существующий инструмент рассылок | PASS | `feed.ts:24` `PUBLIC_SEGMENT_KEY = "all_verified_users"` читает `BroadcastCampaign`, новый инструмент не создан |
| 2.3 Содержательное пустое состояние | PASS | `src/app/webapp/page.tsx:401-416` — `EmptyState` с текстом о парке + секция «О парке» ниже (не пустая область) |
| 2.4 Относительное время + текст без перехода | PASS | `page.tsx:81-97` `formatRelativeTime` («только что»/«5 мин назад»/«вчера»/дата); `FeedCard` рендерит `title`+`body` инлайн |
| 2.5 Быстрый доступ к Барбекю/Плей Парку/Кафе на главной | PASS | `page.tsx:57` `QUICK_LINK_HREFS`, отрисован в верхней секции главного экрана |
| 2.6 Нет карточек без доступа | PASS | `page.tsx:242-243` — быстрые ссылки фильтруются через `buildNavigation(capabilities).tabs`, недостижимый href просто не попадёт в список |

### US-3: Кафе внутри Mini App

| AC | Статус | Доказательство |
|---|---|---|
| 3.1 Новый раздел «Кафе» в навигации | PASS | `navigation.ts:32` `{ href: "/webapp/cafe", label: "Кафе", icon: "coffee" }` |
| 3.2 Актуальное меню = данные публичной страницы | PASS | `src/app/webapp/cafe/page.tsx:171` — `fetch("/api/cafe")` напрямую, тот же публичный эндпоинт, обёртки нет |
| 3.3 Понятный путь к заказу через существующий сценарий | PASS | `src/app/api/webapp/cafe/checkout/route.ts:40` вызывает `createCheckout(user.id, ...)` из `@/modules/cafe/service` без изменений сервиса; `payment.confirmationUrl` открывается тем же ЮKassa-сценарием |
| 3.4 Только публичный интерфейс `cafe`, сам модуль не меняется | PASS | `git diff origin/main...HEAD -- src/modules/cafe/` — пусто (`service.ts`/`validation.ts`/`types.ts` кафе не в диффе). Роут импортирует `checkoutSchema`/`createCheckout`/`listOrders` как есть |
| 3.5 Понятное сообщение при недоступности меню | PASS | `cafe/page.tsx:587-606` — раздельные `EmptyState` для `loadFailed` («Меню не загрузилось» + кнопка «Обновить») и `items.length===0` («Меню пока пустое») |

### US-4: Редизайн сценариев USER

| AC | Статус | Доказательство |
|---|---|---|
| 4.1 Новый визуальный вид, бизнес-правила не меняются | PASS | `src/app/webapp/gazebos/page.tsx` — комментарий на месте (`«тот же запрос, что и раньше (логика не менялась)»`), 53 строки диффа — только UI; `src/modules/gazebos/service.ts`/`ps-park/service.ts` отсутствуют в диффе фичи |
| 4.2 Существующие сценарии без потери функциональности | PASS | Экраны переиспользуют существующие публичные/webapp API (`/api/gazebos`, `/api/webapp/bookings`) — сами API не в диффе, только клиентский рендер |
| 4.3 402-штраф — управляемый шаг, не тупик | PASS | `src/app/webapp/bookings/page.tsx:124-161` `runCancel` — при `PENALTY_CONFIRMATION_REQUIRED` открывает диалог с суммой из `error.metadata` и повтором `DELETE` с `confirmPenalty:true`; если сумма не пришла — кнопка подтверждения всё равно показана (не тупик) |
| 4.4 Профиль сотрудника = профиль USER + явный вход в Центр | PASS | `src/app/webapp/profile/page.tsx:64-65,126-131` — `profileEntries` из `buildNavigation` рендерятся дополнительным блоком |

### US-5: Центр уведомлений для сотрудника

| AC | Статус | Доказательство |
|---|---|---|
| 5.1 Категории только по доступным секциям, недоступные скрыты полностью | PASS* | `src/modules/notifications/catalog.ts` + `src/lib/webapp/capabilities.ts:36-69` `resolveManagedCategories` — фильтр `category.sections.some(s=>sections.includes(s))`; `webapp-center.test.ts:71-79` MANAGER с `["gazebos"]` видит только `bookings`. *Осознанное документированное отклонение: категория «Обратная связь»/`feedback` из нарративной таблицы ADR §4 в коде стала `avito` (`sections:["avito"]`, событие `avito.lead.new`), потому что `feedback` не существует ни как `AdminSection` (`src/lib/permissions.ts:15-34`), ни как событие в `EVENT_ROUTING` — честная замена, задокументирована комментарием в `catalog.ts:126-133`, не баг |
| 5.2 Раздельные тумблеры по типам событий внутри категории | PASS | `catalog.ts` — `booking.created`/`booking.cancelled` раздельные `ManagedEvent`; `webapp-center.test.ts:145-162` |
| 5.3 «Системные» — только `monitoring`-секция или SUPERADMIN | PASS | `catalog.ts:144-149` `sections:["monitoring"], superadminAlways:true`; `capabilities.test.ts:61-81`, `webapp-center.test.ts:94-113` |
| 5.4 ADMIN = MANAGER/SUPERADMIN без исключения по роли | PASS | `webapp-center.test.ts:81-92` — идентичный набор категорий для ADMIN и MANAGER с одинаковыми секциями; `subscribers.test.ts:95-102` — то же для резолвера аудитории |
| 5.5 Выключение/включение сразу влияет на доставку новых событий | PASS | `setEventPreference` пишет строку `NotificationEventPreference` синхронно (`webapp-center.ts:286-294`); аудитория staff-событий (`getSelfSubscribedUserIds`, `resolveReleaseAudience`) читает эту же таблицу без кэша — следующее событие сразу видит новое состояние |
| 5.6 Автопровижининг Telegram-канала без OTP | PASS | `webapp-center.ts:113-171` `ensureTelegramChannel` — create/verify/idempotent/no-reactivate/race-safe (P2002); `webapp-center.test.ts:201-307` — 7 сценариев, включая гонку двух открытий Центра |
| 5.7 CRITICAL-алерты не отключаемы через Центр (двухслойная защита) | PASS | Слой 1: `PROTECTED_NOTICES` — инфра-алерты физически не проходят через `dispatch()`/`NotificationEventPreference` (не тронуто этим PR); Слой 2: `notificationCenterUpdateSchema` — закрытый `z.enum(MANAGED_EVENT_TYPES)` (`validation.ts`); `catalog.test.ts:28-35` — тест-инвариант «ни один `eventType` каталога не матчит `/^health\./,/^site\./,/critical/i,/watchdog/i/`» |
| 5.8 Ре-чек прав на GET и PUT | PASS | `notification-center/route.ts:30-42` `requireStaff` → `loadWebAppStaff` на обоих методах; `setEventPreference` (`webapp-center.ts:272-284`) повторно вызывает `resolveManagedCategories` с `staff.sections`, не доверяя более раннему снимку; `route.test.ts:81-90,136-147` |

### US-6: Ровно одно сообщение о релизе

| AC | Статус | Доказательство |
|---|---|---|
| 6.1 Повторный деплой уже анонсированной версии не дублирует | PASS | `release-notify.ts:41-73` `announceRelease` — claim через `prisma.releaseAnnouncement.create` (PK=`version`), `P2002` → `skipped`, `dispatch` не вызывается; `release-notify.test.ts:189-198`; мёртвый файловый guard и архивный пуш убраны из `deploy.yml` (`grep docs/releases deploy.yml` — только чтение `current.md` для ручных notes, не guard) |
| 6.2 Двойной технический запуск деплоя → не больше 1 сообщения | PASS | Два эшелона: (а) `guard`-джоб в `deploy.yml:69-102` через GH API ищет уже успешный прогон того же SHA и скипает; (б) `ReleaseAnnouncement` claim на уровне БД как окончательная гарантия даже если (а) пропущен |
| 6.3 Один получатель в группе и в личных подписчиках — 1 сообщение | PASS | `deploy.yml:706-826` — персональный анонс идёт первым шагом (`id: release`), групповое «Deploy OK» получает `if: success() && steps.release.outputs.notified != 'true'` — fallback, а не второй независимый канал |
| 6.4 Управление в одном месте — Центр уведомлений | PASS | `release-notify.ts:174-189` `setReleaseSubscription` — единственный путь записи (пишет и `NotificationEventPreference`, и legacy-зеркало); `webapp-center.ts:286-289` роутит `system.release` только через эту функцию; `bot/handlers/team-settings.ts` — тумблер удалён, `/settings` и legacy callback `settings:releases:*` ведут deep-link'ом в Центр и **не пишут** предпочтение (`team-settings.test.ts:132-164` явно проверяет `mockSetReleaseSubscription` не вызван) |
| 6.5 Перенос состояния 1:1, никто не теряет/не получает лишнего | PASS (по чтению SQL, без БД) | `prisma/migrations/20260813130000_release_announcement/migration.sql` — `INSERT...SELECT...COALESCE(np."notifyReleases", true)...WHERE role IN ('SUPERADMIN','MANAGER') AND mergedIntoUserId IS NULL ON CONFLICT DO NOTHING` для строки предпочтения **и** для канала `UserNotificationChannel` (без канала `dispatch()` не найдёт получателя — оба бэкфилла обязательны и оба присутствуют). `ADMIN` строк не получает (легаси их не слал) |
| 6.6 Fail-open при сбое проверки идемпотентности | PASS | `release-notify.ts:57-73` — любая ошибка `create`, кроме `P2002`, логируется `WARNING` и код проваливается дальше к `dispatch`; `release-notify.test.ts:214-223` |
| 6.7 Каждая блокировка дубля — след в SystemEvent | PASS | `release-notify.ts:59-63` `log.info` на дубль, `log.warn` на fail-open; `release-notify.test.ts:200-211,225-237` |

### US-7: Единая дизайн-система на теме Telegram

| AC | Статус | Доказательство |
|---|---|---|
| 7.1 Все экраны на theme Telegram, живое переключение без перезагрузки | PASS | `src/components/webapp/TelegramProvider.tsx:140-149,154-205` — `useSyncExternalStore` подписан на `themeChanged`, полный маппинг 14 токенов → CSS-переменные; вне Telegram — light-дефолты в `:root` (`webapp.css:5-21`) |
| 7.2 Нет жёстких фирменных градиентов не по теме | PASS | `grep -rn gradient src/app/webapp src/components/webapp` — единственное совпадение: shimmer-анимация скелетона (`webapp.css:181-186`), построена на `var(--tg-secondary-bg)`, т.е. сама на теме, не фирменный цвет |
| 7.3 Единая иконография, эмодзи не смешаны с SVG на одном экране | PASS | `src/components/webapp/ui/Icon.tsx` — единственная точка рендера (`currentColor`, closed `WebAppIconName` union); прямой скан `.tsx` в `src/app/webapp/**` и `src/components/webapp/**` на юникод-эмодзи не нашёл совпадений в файлах, тронутых этим PR. Два pre-existing совпадения (`link-account/page.tsx`, неиспользуемый `WebappPushOptIn.tsx`) — оба вне диффа этой фичи и явно вне скоупа PRD (OTP-починка и PWA — п. 1 и 7 «Вне скоупа») |
| 7.4 Safe area + haptics на переработанных/новых экранах | PASS | `env(safe-area-inset-bottom)` сохранён в `.webapp-tabbar`/`.webapp-content`; `haptic.` встречается в 13 файлах — все основные новые/переработанные экраны (`page.tsx`, `cafe/page.tsx`, `bookings/page.tsx`, `notifications/page.tsx`, `profile/page.tsx`, `settings/page.tsx`) и переиспользуемые компоненты (`BookingCard`, `BookingConfirm`, `ResourceCard`, `SlotPicker`, `SuccessScreen`, `TabBar`) |
| 7.5 Визуальная приёмка владельцем | **ТРЕБУЕТ ВЛАДЕЛЬЦА** | Не проверяется автоматизированным QA по определению самого AC; PRD прямо указывает это как решение владельца перед вливанием в `main`. Не засчитано ни как PASS, ни как FAIL |

---

## RBAC-матрица по новым роутам

Анонимный запрос везде без заголовка `Authorization`; USER/MANAGER/ADMIN/SUPERADMIN — с валидным Mini App JWT (роль читается из БД на staff-роутах).

| Роут | Метод | Анонимный | USER | MANAGER | ADMIN | SUPERADMIN |
|---|---|---|---|---|---|---|
| `/api/webapp/feed` | GET | 401 (тест: `route.test.ts:47-58`) | 200 (тест: `route.test.ts:60-91`, `mockUser.role="USER"`) | 200¹ | 200¹ | 200¹ |
| `/api/webapp/feed/read` | POST | 401 (тест: `:148-155`) | 200 (тест: `:157-176`) | 200¹ | 200¹ | 200¹ |
| `/api/webapp/cafe/checkout` | POST | 401 (тест: `:83-93`) | 201 (тест: `:128-163`, `mockUser.role="USER"`) | 201¹ | 201¹ | 201¹ |
| `/api/webapp/cafe/orders` | GET | 401 (тест: `:204-211`) | 200 (тест: `:213-245`) | 200¹ | 200¹ | 200¹ |
| `/api/webapp/notification-center` | GET | 401 (тест: `route.test.ts:70-79`) | 403² (`loadWebAppStaff`: `role==="USER"` → 403, тест `webapp-auth.test.ts:97-112`; сервис дублирует — `webapp-center.test.ts:64-69`) | 200 (тест: `webapp-center.test.ts:71-79`, категории по секциям) | 200, идентично MANAGER (тест: `:81-92`) | 200, `system` доступна без секций (тест: `:94-98`) |
| `/api/webapp/notification-center` | PUT | 401 (тест: `route.test.ts:149-158`) | 403² (`webapp-center.test.ts:328-332`) | 200 при доступе к секции / 403 без (тест: `:320-332`, `route.test.ts:136-147`) | 200, идентично MANAGER | 200 |

¹ Эти роуты не ветвятся по роли (`verifyWebAppToken` не проверяет `role`, только валидность подписи) — «любая аутентифицированная» по ADR §12. Явных тестов с `role="MANAGER"`/`"ADMIN"`/`"SUPERADMIN"` нет, но поведение идентично для всех ролей по построению кода (роль нигде не читается в этих обработчиках) — не гэп, а корректное отсутствие ветвления.
² Понижение роли внутри активной сессии (валидный токен, но `role==="USER"` в БД) даёт тот же результат — проверено отдельно (`webapp-auth.test.ts:97-112`, тест на понижение с `SUPERADMIN` в токене и `USER` в БД).

Прямая подмена `userId`/`eventType`-получателя в body не работает нигде: `userId` берётся из `verifyWebAppToken(request).id` (из подписанного токена), а не из тела запроса — явно протестировано в `feed/__tests__/route.test.ts:178-192` («чужой id в `ids` уходит с userId из токена, не из body») и `cafe/__tests__/route.test.ts:230` (`listOrders` вызван с `{userId: user.id}` из токена).

---

## Edge cases

| Кейс | Статус | Доказательство |
|---|---|---|
| Истёкший JWT → 401 в `apiFetch` | PASS | `TelegramProvider.tsx:294-315` — `apiFetch` бросает `ApiFetchError{status, code}` на любой `!data.success`; на кафе-чекауте явно обработан (`cafe/page.tsx:344-345`, «Сессия истекла — закройте и снова откройте приложение»). *Минорное замечание ниже* — не все экраны различают 401 так же явно |
| Пустая лента нового гостя | PASS | `feed.test.ts:345-352` (сервис отдаёт `nextCursor:null` для пустой ленты) + `page.tsx:401-416` (содержательный `EmptyState`, AC-2.3) |
| `PAYMENT_CONTACT_REQUIRED` | PASS | `cafe/checkout/route.ts:50-55` маппит на 422; `cafe/page.tsx:337-339` фокусирует поле email; тест `cafe/__tests__/route.test.ts:190-200` |
| 402-штраф при отмене брони | PASS | Полный управляемый диалог, см. AC-4.3 выше; `bookings/page.tsx:140-153` |
| Повторный анонс той же версии | PASS | `release-notify.test.ts:188-198` — `P2002` → `skipped`, `dispatch` не вызван, `ReleaseAnnouncement.update` (recipientCount) тоже не вызван |
| MANAGER без секций → `canNotificationCenter=false` | PASS | `capabilities.test.ts:44-50` (снимок для навигации), `navigation.test.ts:37-46` (входа в Центр нет), и — на случай прямого обращения к API в обход UI — `getNotificationCenter` с `sections=[]` возвращает `categories:[]` (200, не тупик): UI показывает `EmptyState` «Пока нечего настраивать» (`notifications/page.tsx:187-193`), а не ошибку |
| Grandfather-подписчик (легаси MANAGER без `monitoring`) | PASS | `capabilities.test.ts:95-107` и `webapp-center.test.ts:115-124` — унаследованная строка `system.release` открывает категорию `system` даже без секции `monitoring`; миграция (`20260813130000_release_announcement/migration.sql`) создаёт именно такие строки для легаси-аудитории |
| Некорректный/malformed JSON body | PASS | Везде `request.json().catch(()=>null)` → Zod `safeParse` → 422 `VALIDATION_ERROR` (`cafe/__tests__/route.test.ts:104-111`, `feed/__tests__/route.test.ts` — malformed cursor/body) |
| Поля сверх Zod-схемы игнорируются | PASS | `feed/__tests__/route.test.ts:188-192` — `userId` в body игнорируется, реально используется `user.id` из токена |

---

## Rate limiting

| Роут | Тир | Ключ | Тест |
|---|---|---|---|
| `POST /api/webapp/auth` | `public` (180/мин, до крипто-проверки) | IP | `route.test.ts:70-77` — 429 блокирует до `validateInitData` |
| `GET/POST /api/webapp/feed*` | `authenticated` (240/мин), после верификации токена | `user.id` | `feed/__tests__/route.test.ts:124-133,210-219` |
| `POST /api/webapp/cafe/checkout` | `authenticated` | `user.id` | `cafe/__tests__/route.test.ts:113-126` |
| `GET /api/webapp/cafe/orders` | `authenticated` | `user.id` | Код идентичен checkout (`orders/route.ts:30-31`), но отдельного 429-теста для этого роута нет — **минорный гэп покрытия**, не функциональный риск (см. баги ниже) |
| `GET/PUT /api/webapp/notification-center` | `authenticated` | `guard.staff.id` | `route.test.ts:103-113` (GET) |

Все ключи — по `userId` после аутентификации (не по IP), что соответствует ADR §2 и защищает от CGNAT-эффекта мобильных сетей РФ (см. `CLAUDE.md` про `RATE_LIMIT_*_PER_MIN`).

---

## Качество кода

- **`any`**: `git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E "^\+" | grep -E ":\s*any\b|as any\b"` — пусто, ни одного нового `any`.
- **`apiResponse`/`apiError`**: все 6 новых `/api/webapp/*` роутов используют единый формат; `apiServerError()` на непойманных исключениях, без утечки stack trace (`feed/__tests__/route.test.ts:135-144` явно проверяет, что текст ошибки БД не попадает в ответ; то же для `admin/release-notify/__tests__/route.test.ts:150-164`).
- **Zod на входах**: `initDataAuthSchema`, `feedQuerySchema`, `feedReadSchema`, `webappOrdersQuerySchema` (`src/lib/webapp/validation.ts`), `notificationCenterUpdateSchema` — закрытый `z.enum(MANAGED_EVENT_TYPES)` (`src/modules/notifications/validation.ts`), плюс переиспользованный `checkoutSchema` кафе без изменений.
- **Секреты**: fallback-секрет `"webapp-secret"` полностью убран из `src/` (было продублировано в 3 файлах, теперь один helper с явным отказом). `grep -rn "console.log\|console.debug\|console.info"` по новым строкам диффа — пусто (только `console.error` в catch-блоках, не утекает в HTTP-ответ).
- **AuditLog**: мутации (`order.create`, `notification.preference.update`) логируются; чтение ленты (`feed/read`) сознательно не логируется — задокументированное решение (не мутация бизнес-данных, иначе шум на каждый скролл).

---

## Баги / замечания (все Minor/Trivial, ни один не блокирует Must-AC)

### 1. [Minor] Разное качество сообщения при истёкшем токене между экранами
**Модуль**: webapp / UX-консистентность
**Шаги**: открыть Mini App с истёкшим/невалидным JWT (например, после понижения роли или редкого протухания сессии) → перейти на «Мои брони».
**Ожидаемо**: понятное сообщение о необходимости перезайти (как на экране кафе).
**Фактически**: `src/app/webapp/bookings/page.tsx:88-98` — `loadBookings()` ловит **любую** ошибку (включая 401) единым `catch { setBookings([]); }` и показывает пустое состояние «Пока нет бронирований» — неотличимо от честного «у вас правда нет броней». Экран кафе (`cafe/page.tsx:344-345`) для аналогичной ситуации при чекауте явно проверяет `error.status===401` и показывает «Сессия истекла…». Функционально не критично (данные не текут, просто нет уточняющего сообщения на одном из экранов) — на усмотрение Developer, не блокирует релиз.

### 2. [Trivial] Английский текст ошибки может дойти до пользователя при 401 в диалоге отмены брони
**Модуль**: webapp / локализация
**Шаги**: истечь токен во время открытого диалога отмены брони → подтвердить отмену.
**Фактически**: `bookings/page.tsx:154-157` — общий `catch` для не-402-ошибок кладёт `e.message` в `dialogError` как есть; сервер для 401 отдаёт англ. строку `"Invalid or expired token"` (паттерн уже существовал в `bookings/route.ts`/`book/route.ts` до этого PR, не новая регрессия). Смешение языков в едином русскоязычном диалоге — чисто косметическая находка.

### 3. [Trivial] Нет отдельного 429-теста для `GET /api/webapp/cafe/orders`
Код идентичен checkout (тот же `rateLimit(request,"authenticated",user.id)` до вызова сервиса), паттерн многократно протестирован в других роутах (`feed`, `checkout`, `notification-center`) — риска нет, просто гэп полноты тест-сьюта.

### 4. [Info, не баг] Документированное отклонение от нарративной таблицы ADR §4
Категория «Обратная связь»(`feedback`) заменена на реально существующую `avito` — секции `feedback` не существует в `ADMIN_SECTIONS`, событий `feedback.*` нет в `EVENT_ROUTING`. Решение верное и явно прокомментировано в коде (`catalog.ts:126-133`); упоминаю для трассируемости, не как дефект.

---

## Security-чеклист (`agents/qa.md` + `agents/SECURITY.md`)

- **RBAC**: анонимный → 401 везде; USER на staff-only роуте → 403 (`loadWebAppStaff` + дублирующая проверка в сервисе `assertStaff`); MANAGER без нужной секции на PUT → 403; подмена `userId`/адресата в body невозможна (берётся из подписанного токена). Все проверено кодом и тестами выше — **PASS**.
- **Rate limiting**: все новые public/authenticated роуты покрыты, тир и ключ соответствуют ADR/CLAUDE.md — **PASS**.
- **Input validation**: невалидный JSON/малоформед body → 422 `VALIDATION_ERROR`; поля сверх схемы игнорируются; `eventType` Центра — закрытый enum, попытка записать неуправляемый/угаданный тип отклоняется на уровне Zod и повторно на уровне сервиса — **PASS**. SQL-инъекции неприменимы — все запросы через Prisma, новых `$queryRaw` не добавлено (только статичный DDL/backfill в файлах миграций, не принимающий пользовательский ввод).
- **Data leakage**: `GET /api/webapp/cafe/orders` явно тестируется на утечку `user.email`/`user.name` из join'а сервиса (`cafe/__tests__/route.test.ts:213-245` — `raw` JSON не содержит `private@example.com`); DTO во всех новых роутах собираются явно (whitelist полей), нигде не расшарен сырой Prisma-объект; 500-ошибки не содержат текст исходного исключения в ответе (протестировано). Токен Mini App содержит только `sub`/`telegramId`/`role`, не PII. — **PASS**.
- **Fallback-секрет**: убран полностью, явный отказ 503 вместо тихой работы на публично известном значении — **PASS**.
- Ни один security-кейс не FAIL → не блокирует вердикт.

---

## Итог

Все Must-have AC (US-1…US-7) реализованы и подтверждены на уровне кода и тестов, кроме AC-7.5 (визуальная приёмка владельцем — вне зоны автоматизированного QA по определению). Полный прогон тестов зелёный (3378/3378), типы и линт чисты, RBAC подтверждён по всем 4 ролям + анонимному доступу на всех новых роутах, security-кейсы пройдены. Найдено 2 minor и 1 trivial косметических замечания без функционального риска — не блокируют релиз.

**Вердикт: PASS**
