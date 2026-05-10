# PRD: Напоминания о незакрытых сессиях с Web Push fallback

**Дата:** 2026-05-10
**RUN_ID:** `2026-05-10-overdue-session-reminders`
**Модуль:** notifications (расширение), ps-park, gazebos
**Статус:** Draft → Architect

---

## Проблема

Менеджер PlayStation Park и менеджер беседок закрывают сессии вручную: выбить чек, зафиксировать итог. Если менеджер отвлёкся, отошёл или забыл — сессия остаётся в статусе `CHECKED_IN` или `CONFIRMED` навсегда. Нет никакого механизма, который напомнил бы: «У тебя там стол три, время вышло 20 минут назад».

Сейчас единственный сигнал — красная карточка в браузерном интерфейсе (F2 реализован в PR #242). Но менеджер физически может находиться не за экраном в момент, когда карточка покраснела. Без push-напоминания просроченная сессия будет обнаружена «когда зайдёт».

**Бизнес-следствие:** накапливаются «мёртвые» записи в статусе `CHECKED_IN`/`CONFIRMED`, искажается аналитика доступности, клиент может уйти без оплаты. При нескольких одновременных столах менеджер физически не способен удерживать все таймеры в голове без автоматического напоминания.

**Персоны, которые страдают:**
- MANAGER PlayStation Park — несколько активных столов одновременно.
- MANAGER беседок — бронирования с фиксированным endTime, иногда забывает вернуться к ПК.

---

## Решение

Cron-сканер каждые 5 минут находит сессии, у которых `endTime` прошёл, а статус не закрыт. Для каждой такой сессии отправляет напоминание менеджеру соответствующего модуля через существующий `NotificationDispatcher`. Если через 15 минут сессия по-прежнему не закрыта — повторное напоминание менеджеру. Если через 30 минут — алерт суперадмину.

Канал доставки определяется автоматически:
- **Primary:** Telegram-бот (@DelovoyPark_bot), если у менеджера привязан `telegramId`.
- **Fallback:** Web Push в браузере — новый канал, реализуется в рамках этой фичи.
- **Last resort:** Email.

Web Push реализуется как новый канал `src/modules/notifications/dispatch/channels/web-push/` рядом с существующими `telegram.ts` и `email.ts`. Канал встраивается через существующий `INotificationChannel` интерфейс — никакой специальной логики в Dispatcher не добавляется.

PWA manifest добавляется для поддержки Web Push на iOS Safari 16.4+ (только в режиме «Add to Home Screen»). Для Android Chrome/Firefox — работает без PWA.

Логика закрытия сессий не меняется. Авто-закрытие не включается.

---

## Целевая аудитория

| Персона | Роль | Получает ценность |
|---------|------|-------------------|
| Менеджер PS Park | MANAGER (ps-park) | Уведомление, когда стол просрочен и нужно выставить счёт |
| Менеджер беседок | MANAGER (gazebos) | Уведомление, когда бронирование истекло и нужно закрыть сессию |
| Суперадмин / директор | SUPERADMIN | Алерт эскалации, если менеджер не реагирует 30 минут |

---

## Что уже реализовано (не дублируем)

- `INotificationChannel` — интерфейс канала в `src/modules/notifications/dispatch/types.ts`.
- `ChannelRegistry` + `NotificationDispatcher` — диспетчер с автовыбором канала, дедупликацией (`OutgoingNotification.dedupKey`), quiet hours, fallback по приоритету.
- `UserNotificationChannel` + `NotificationEventPreference` — per-user адреса и настройки приоритетов/fallback/quiet hours.
- `OutgoingNotification` — taблица с dedup-окном 5 минут, `PENDING`/`DEFERRED`/`SENT`/`FAILED` + `maxAttempts`.
- `PushChannel` (`src/modules/notifications/dispatch/channels/stubs.ts`) — stub-заглушка с `kind = "PUSH"`. Реализация в рамках этой фичи заменяет stub.
- `TelegramChannel` — готов, работает в production.
- `EmailChannel` — готов.
- Планировщик `scheduler.ts` (`processScheduledNotifications`) — вызывается каждые 5 минут, обрабатывает `processBookingReminders` и `processContractExpiryAlerts`.
- Красная карточка просроченной сессии в PS Park UI — PR #242, уже в production.
- `ModuleAssignment` — привязка менеджера к модулю, используется для определения адресатов напоминаний.

Чего **нет** и потребует добавления:

- Реализация `WebPushChannel` (сейчас `PushChannel` — stub с `isAvailable() = false`).
- Таблица `WebPushSubscription` — хранение endpoint/ключей браузера.
- Service Worker + VAPID setup для Web Push.
- PWA manifest для iOS support.
- UI «Включить уведомления» в админке.
- Функция сканера просроченных сессий в `scheduler.ts`.
- Логика эскалации менеджер → суперадмин.

---

## User Stories

### US-1: Менеджер получает напоминание о просроченной сессии

- **Как** менеджер PS Park или беседок
- **Я хочу** получить уведомление, когда время бронирования/сессии истекло, а я ещё не закрыл её
- **Чтобы** успеть выставить счёт клиенту, не пропустить закрытие и не терять деньги

**Acceptance Criteria:**

- [ ] AC-1.1: Сканер запускается каждые 5 минут в рамках существующего планировщика (`processScheduledNotifications`).
- [ ] AC-1.2: Сканер находит все записи `Booking` с `moduleSlug IN ('ps-park', 'gazebos')`, `status IN ('CHECKED_IN', 'CONFIRMED')`, `endTime < now - 5 минут`.
- [ ] AC-1.3: Для каждой просроченной сессии определяется список менеджеров модуля через `ModuleAssignment → User` (только роли MANAGER, не USER).
- [ ] AC-1.4: Для каждого менеджера-адресата вызывается `NotificationDispatcher.dispatch(...)` с `eventType: "session.overdue.reminder"` и `entityId: booking.id`.
- [ ] AC-1.5: Текст уведомления содержит: название ресурса (стол/беседка), время начала, время, прошедшее с `endTime`, ссылку на панель управления.
- [ ] AC-1.6: Уведомление доставляется через Telegram, если у менеджера в `UserNotificationChannel` есть активный канал `TELEGRAM`. Иначе — через Web Push. Иначе — через Email. Приоритет определяется существующим `pickChannel`.
- [ ] AC-1.7: Если сессия уже закрыта (статус `COMPLETED` или `CANCELLED`) к моменту следующего прогона — напоминание не отправляется.

**Приоритет:** Must have (P0)

---

### US-2: Дедупликация — одно напоминание на бронирование, не каждые 5 минут

- **Как** менеджер
- **Я хочу** получать первое напоминание один раз при наступлении просрочки, а не каждые 5 минут
- **Чтобы** уведомления не превращались в спам

**Acceptance Criteria:**

- [ ] AC-2.1: Первое напоминание отправляется, когда `endTime < now - 5 мин` И по данной записи ещё не было уведомления с `eventType = "session.overdue.reminder"` в `OutgoingNotification`.
- [ ] AC-2.2: Дедупликация опирается на существующий механизм `OutgoingNotification.dedupKey` с окном 5 минут — никакого дополнительного поля в `Booking` не нужно.
- [ ] AC-2.3: После первого напоминания повторное (`eventType: "session.overdue.escalation.manager"`) отправляется через 15 минут, если сессия всё ещё не закрыта. Для повторного напоминания используется другой `eventType`, что позволяет `isDuplicate` пропустить его.
- [ ] AC-2.4: Если менеджер закрыл сессию между прогонами — ни повторное, ни эскалационное уведомление не отправляются.

**Приоритет:** Must have (P0)

---

### US-3: Эскалация суперадмину, если менеджер не реагирует

- **Как** суперадмин / директор
- **Я хочу** получить алерт, если сессия не закрыта спустя 30 минут после её окончания
- **Чтобы** знать о проблемах оперативно и при необходимости вмешаться

**Acceptance Criteria:**

- [ ] AC-3.1: Если `endTime < now - 30 мин` И статус всё ещё `CHECKED_IN`/`CONFIRMED` — сканер вызывает `NotificationDispatcher.dispatch` для всех пользователей с ролью `SUPERADMIN` с `eventType: "session.overdue.escalation.superadmin"`.
- [ ] AC-3.2: Текст эскалационного уведомления содержит: модуль, ресурс, время просрочки, имя менеджера модуля (если есть `ModuleAssignment`).
- [ ] AC-3.3: Эскалация отправляется не более одного раза на бронирование (dedup через `OutgoingNotification.dedupKey`).
- [ ] AC-3.4: Если суперадминов несколько — уведомление получает каждый, у кого есть активный `UserNotificationChannel`.
- [ ] AC-3.5: Эскалационный алерт фиксируется в `SystemEvent` с уровнем `WARNING` и `source: "scheduler"`.

**Приоритет:** Must have (P0)

---

### US-4: Web Push канал в Dispatcher

- **Как** менеджер, у которого не привязан Telegram
- **Я хочу** получать push-уведомления прямо в браузере или на телефоне через браузер
- **Чтобы** не пропустить напоминание, даже если вкладка административной панели свёрнута

**Acceptance Criteria:**

- [ ] AC-4.1: Реализован класс `WebPushChannel` по интерфейсу `INotificationChannel` (`kind = "PUSH"`), расположен в `src/modules/notifications/dispatch/channels/web-push/`.
- [ ] AC-4.2: `WebPushChannel.isAvailable()` возвращает `true`, если в env настроены `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`.
- [ ] AC-4.3: `WebPushChannel.send(address, payload)` отправляет Web Push по endpoint из `address`, используя библиотеку `web-push`. `address` — это JSON-сериализация `PushSubscription` (endpoint + keys).
- [ ] AC-4.4: При успешной отправке возвращает `{ ok: true }`. При ошибке `410 Gone` (подписка устарела) — помечает `WebPushSubscription.isActive = false` и возвращает `{ ok: false, retryable: false }`. При сетевой ошибке — `{ ok: false, retryable: true }`.
- [ ] AC-4.5: `PushChannel` stub из `stubs.ts` заменяется реальной реализацией, зарегистрированной в `ChannelRegistry`.
- [ ] AC-4.6: Добавлена Prisma-модель `WebPushSubscription` со следующими полями: `id`, `userId`, `endpoint`, `p256dh`, `auth`, `userAgent`, `isActive` (default true), `createdAt`, `updatedAt`. Индекс по `userId` + `isActive`.

**Приоритет:** Must have (P0) — без Web Push у менеджеров без Telegram нет fallback-канала.

---

### US-5: PWA Manifest и Service Worker для поддержки Web Push

- **Как** менеджер, работающий с iOS Safari или Chrome на Android
- **Я хочу** добавить административную панель на домашний экран и получать push-уведомления
- **Чтобы** уведомления работали даже когда браузер не открыт

**Acceptance Criteria:**

- [ ] AC-5.1: В корне приложения добавлен `public/manifest.json` с полями `name`, `short_name`, `start_url`, `display: standalone`, `background_color`, `theme_color`, `icons` (минимум 192×192 и 512×512 PNG).
- [ ] AC-5.2: В `<head>` layout'а добавлен `<link rel="manifest" href="/manifest.json">` и `<meta name="apple-mobile-web-app-capable" content="yes">`.
- [ ] AC-5.3: Зарегистрирован Service Worker (`public/sw.js`), который обрабатывает событие `push` и показывает уведомление через `self.registration.showNotification(...)`.
- [ ] AC-5.4: Service Worker обрабатывает событие `notificationclick`: при клике на уведомление открывает вкладку с нужным URL (из `payload.actions[0].url`) или фокусирует уже открытую.
- [ ] AC-5.5: На Android Chrome и Desktop Chrome/Firefox Web Push работает без установки как PWA (требуется только разрешение браузера).
- [ ] AC-5.6: На iOS Safari 16.4+ Web Push работает только в режиме PWA (Add to Home Screen). Если браузер не поддерживает Push API — кнопка «Включить уведомления» скрыта, и это не считается ошибкой.
- [ ] AC-5.7: VAPID public key экспортируется как `NEXT_PUBLIC_VAPID_PUBLIC_KEY` в `.env`.

**Приоритет:** Should have — без этого Web Push работает на Android/Desktop, но не на iOS. iOS поддержка — важна для мобильных менеджеров.

---

### US-6: UI «Включить уведомления в браузере» в админке

- **Как** менеджер или суперадмин
- **Я хочу** нажать кнопку «Включить уведомления» в административной панели
- **Чтобы** мой браузер получал push-уведомления о просроченных сессиях

**Acceptance Criteria:**

- [ ] AC-6.1: В административной панели (в разделе «Профиль» или в шапке навигации) видна кнопка «Включить уведомления в браузере» — только для ролей MANAGER и SUPERADMIN.
- [ ] AC-6.2: При нажатии на кнопку запрашивается разрешение браузера (`Notification.requestPermission()`). Если пользователь отказал — показывается подсказка «Разрешите уведомления в настройках браузера».
- [ ] AC-6.3: После получения разрешения браузер подписывается (`pushManager.subscribe`), данные подписки отправляются на `POST /api/notifications/web-push/subscribe`. Сервер создаёт запись `WebPushSubscription` и запись `UserNotificationChannel` с `kind = "PUSH"`, `address = JSON.stringify(subscription)`, `isActive = true`.
- [ ] AC-6.4: Если у пользователя уже есть активная подписка для текущего устройства (endpoint совпадает) — повторная запись не создаётся, ответ `200 OK`.
- [ ] AC-6.5: Кнопка меняет состояние на «Уведомления включены» после успешной подписки. При статусе `denied` кнопка не отображается.
- [ ] AC-6.6: Доступен `POST /api/notifications/web-push/unsubscribe` — удаляет `WebPushSubscription` и деактивирует `UserNotificationChannel` по endpoint. Вызывается при нажатии «Отключить уведомления».
- [ ] AC-6.7: Доступен `GET /api/notifications/web-push/vapid-public-key` — возвращает VAPID public key для клиентской подписки.
- [ ] AC-6.8: USER (клиент B2C) не видит кнопку и не имеет доступа к эндпоинтам подписки.

**Приоритет:** Must have (P0) — без UI подписки Web Push канал физически недостижим.

---

### US-7: Per-user настройка приоритетов каналов

- **Как** менеджер
- **Я хочу** выбрать, через какой канал я хочу получать напоминания в первую очередь
- **Чтобы** уведомления приходили туда, где я их точно увижу

**Acceptance Criteria:**

- [ ] AC-7.1: В разделе настроек профиля менеджера отображается список активных каналов (`UserNotificationChannel`) с полем `priority` (порядковый номер).
- [ ] AC-7.2: Менеджер может изменить порядок каналов перетаскиванием или кнопками «выше/ниже». Изменение сохраняется через `PATCH /api/notifications/channels/:id` (изменение поля `priority`).
- [ ] AC-7.3: `NotificationDispatcher` уже использует `priority` при выборе канала — изменение порядка немедленно влияет на следующий dispatch.
- [ ] AC-7.4: Менеджер видит статус каждого канала: «активен» / «недоступен» (например, Web Push на устройстве без разрешения).
- [ ] AC-7.5: Настройка доступна только для своего профиля; SUPERADMIN может просматривать каналы любого пользователя, но не изменять их.

**Приоритет:** Could have — Dispatcher уже корректно работает с приоритетами; UI для их изменения удобен, но не блокирует основной флоу.

---

## RBAC — матрица доступа

| Действие | SUPERADMIN | MANAGER (свой модуль) | MANAGER (чужой модуль) | USER |
|---|---|---|---|---|
| Получать напоминания о просроченных сессиях | да (эскалация) | да | нет | нет |
| Получать эскалационные алерты | да | нет | нет | нет |
| Подписаться на Web Push | да | да | да | нет |
| Отписаться от Web Push | да | да (своя подписка) | нет | нет |
| Управлять приоритетами каналов | да (любой профиль, read-only) | да (свой профиль) | нет | нет |
| Видеть кнопку «Включить уведомления» | да | да | да | нет |

**Важно:** Сканер просроченных сессий рассылает уведомления только менеджерам модуля (через `ModuleAssignment`) и суперадминам. Менеджер PS Park не получает уведомления о беседках и наоборот.

---

## Edge Cases

| Ситуация | Поведение |
|---|---|
| У менеджера нет ни одного активного канала | `dispatch` возвращает `skipped: no available channel`. Пишется `SystemEvent` WARNING: «Менеджер {userId} не получил напоминание — нет активного канала». |
| Сессия закрылась между двумя прогонами сканера | Следующий прогон не находит её (статус не `CHECKED_IN`/`CONFIRMED`), уведомление не отправляется. |
| Web Push endpoint устарел (410 Gone) | `WebPushChannel.send` помечает `WebPushSubscription.isActive = false`, `UserNotificationChannel.isActive = false`. Dispatcher падает на следующий канал по приоритету. |
| Браузер не поддерживает Push API | Кнопка «Включить уведомления» скрыта через проверку `'PushManager' in window`. Отсутствие Web Push не считается ошибкой. |
| iOS Safari без PWA | Кнопка «Включить уведомления» скрыта (Push API недоступен). При добавлении на домашний экран — кнопка появляется. |
| Несколько менеджеров в одном модуле | Напоминание получают все менеджеры через `ModuleAssignment`. Дедупликация работает per-user (разные `userId` → разные `dedupKey`). |
| Менеджер назначен на 2 модуля | Получает напоминания за оба модуля независимо. |
| Планировщик недоступен (crash) | При восстановлении сканер отработает по всем просроченным сессиям за период простоя. Dedup предотвращает двойную отправку, если `OutgoingNotification` уже создан. |
| Quiet hours у менеджера активны | Dispatcher откладывает уведомление до конца quiet hours (существующее поведение `DEFERRED`). Эскалация суперадмину не зависит от quiet hours менеджера. |
| Один менеджер — несколько браузеров/устройств | Создаётся `WebPushSubscription` для каждого устройства отдельно. Dispatcher при dispatch выбирает один канал по приоритету; отправка на все устройства пользователя — вне скоупа. |

---

## Модель данных

### Новая таблица: `WebPushSubscription`

```
WebPushSubscription {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  endpoint    String   @unique  // URL браузерного push-сервиса
  p256dh      String           // ECDH public key
  auth        String           // auth secret
  userAgent   String?          // для диагностики (Chrome/Firefox/Safari)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, isActive])
}
```

`UserNotificationChannel.address` для канала `PUSH` хранит `JSON.stringify({ endpoint, keys: { p256dh, auth } })` — формат, принимаемый `web-push`.

### Изменения в существующих таблицах

Новых полей в `Booking` не требуется. Дедупликация работает через `OutgoingNotification.dedupKey` (уже существует).

### Новые eventType в `OutgoingNotification`

| eventType | Описание |
|---|---|
| `session.overdue.reminder` | Первое напоминание менеджеру (+5 минут просрочки) |
| `session.overdue.escalation.manager` | Повторное напоминание менеджеру (+15 минут) |
| `session.overdue.escalation.superadmin` | Эскалация суперадмину (+30 минут) |

---

## Новые переменные окружения

| Переменная | Описание | Обязательна |
|---|---|---|
| `VAPID_PUBLIC_KEY` | VAPID public key для Web Push | да (для Web Push) |
| `VAPID_PRIVATE_KEY` | VAPID private key для Web Push | да (для Web Push) |
| `VAPID_CONTACT_EMAIL` | Email отправителя в VAPID заголовке | да (для Web Push) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Тот же ключ для клиентской подписки | да (для Web Push) |

Если VAPID ключи не настроены, `WebPushChannel.isAvailable()` возвращает `false`, Dispatcher автоматически переходит на следующий канал. Остальные каналы продолжают работать.

---

## Приоритет (MoSCoW)

**Категория: Must have**

Обоснование: PS Park работает в production с 2026-04-14. Сессии `CHECKED_IN` без закрытия — это прямые потери выручки и искажение аналитики. Красная карточка (F2) дала визуальный сигнал, но не решила проблему отсутствия менеджера перед экраном. Напоминание — минимальный инструмент, без которого F1 (запрет закрытия без оплаты) создаёт риск «завис и забыл».

Web Push как fallback канал Must have, потому что не все менеджеры подключены к Telegram-боту (@DelovoyPark_bot). Без Web Push у них нет никакого внеэкранного уведомления.

**Зависимости:**
- `NotificationDispatcher` — готов, `INotificationChannel` интерфейс готов.
- `UserNotificationChannel` + `NotificationEventPreference` — готовы.
- `OutgoingNotification` dedup — готов.
- `PushChannel` stub — готов к замене реальной реализацией.
- Планировщик `scheduler.ts` — готов, требует добавления функции сканера.
- `ModuleAssignment` — готов, использовать для определения адресатов.

---

## Метрики успеха

| Метрика | Сейчас (baseline) | Цель (через 4 недели) |
|---|---|---|
| % сессий PS Park, закрытых в течение 15 минут после `endTime` | не измеряется, измерить при запуске | ≥ 80% |
| % сессий беседок, закрытых в течение 15 минут после `endTime` | не измеряется, измерить при запуске | ≥ 80% |
| Количество сессий, оставшихся в `CHECKED_IN`/`CONFIRMED` более 1 часа после `endTime` | измерить при запуске | снижение на 70% |
| % успешной доставки Web Push на Android Chrome | нет данных | ≥ 95% (при наличии подписки) |
| % успешной доставки Web Push на iOS Safari (PWA) | нет данных | ≥ 80% (при наличии подписки) |
| Доля менеджеров с хотя бы одним активным каналом уведомлений | нет данных | 100% |

**Прокси-SQL для наблюдения:**

```sql
-- Среднее время между endTime и закрытием (COMPLETED) после релиза
SELECT
  b."moduleSlug",
  ROUND(AVG(EXTRACT(EPOCH FROM (b."updatedAt" - b."endTime")) / 60)) AS avg_closure_delay_min,
  COUNT(*) AS sessions
FROM "Booking" b
WHERE b."moduleSlug" IN ('ps-park', 'gazebos')
  AND b.status = 'COMPLETED'
  AND b."updatedAt" > b."endTime"
  AND b."updatedAt" > NOW() - INTERVAL '30 days'
GROUP BY b."moduleSlug";
```

---

## Вне скоупа

- **Авто-закрытие сессий** — эндпоинт `/api/ps-park/auto-complete` гейтнут флагом `PS_PARK_AUTO_COMPLETE_ENABLED` (default false). Включение авто-закрытия — отдельное решение владельца, не часть этой фичи.
- **SMS-уведомления** — требуют отдельной интеграции с SMS-шлюзом (Novofon/СМСЦ). SMS как канал вне этой итерации.
- **WhatsApp / MAX / iMessage** — stubs уже в реестре, реализация каналов — отдельные фичи.
- **Нативные мобильные приложения** — нативных приложений нет; push на native iOS/Android APNs/FCM не рассматривается.
- **Push-уведомления для USER (клиентов B2C)** — только для MANAGER и SUPERADMIN.
- **Отправка Web Push на все устройства пользователя одновременно** — Dispatcher выбирает один канал; fan-out на несколько `WebPushSubscription` одного пользователя вне скоупа.
- **Создание нового доменного модуля** — Web Push живёт в `src/modules/notifications/dispatch/channels/web-push/`, никакого нового `src/modules/web-push/` не создаётся.
- **Изменение логики статусов бронирований** — `BookingStatus` state machine не меняется.
- **Настройка порогов напоминаний через UI** — пороги 5/15/30 минут зашиты в конфигурацию (константы в сервисе). Настройка через UI — вне скоупа MVP.
- **Аналитика открытости push-уведомлений** — click-tracking для Web Push вне скоупа.
- **Поддержка Safari < 16.4 на iOS** — не поддерживается Web Push API, и это не баг.
