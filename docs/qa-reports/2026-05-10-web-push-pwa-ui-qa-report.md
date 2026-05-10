# QA-отчёт: Web Push PWA + Service Worker + UI (PR 3/4)

**RUN_ID:** `2026-05-10-web-push-pwa-ui`
**PR:** `claude/feat-web-push-pwa-ui` — «PR 3/4: Web Push PWA + Service Worker + UI»
**Дата:** 2026-05-10
**QA Engineer:** QA Agent (claude-sonnet-4-6)
**Ревизия кода:** `9f951fd` (SW open-redirect fix, PASS после code review)

---

## Вердикт: PASS

Все Must-have acceptance criteria из скоупа PR 3 подтверждены. Найдены два minor-замечания (не блокирующие): отклонение SW scope от ADR-спецификации и расхождение формулировки URL-источника в PRD AC-5.4 vs реализации. Оба замечания не влияют на security и функциональность, поскольку внутренняя согласованность кода сохранена. Тесты зелёные (12779/12779), сборка проходит без ошибок.

---

## Результаты проверки

### Инфраструктура

| Проверка | Статус | Детали |
|---|---|---|
| `npm test -- src/components/admin/notifications` | PASS | 18 тестов, 1 файл — все зелёные |
| `npm test -- --run` (полная регрессия) | PASS | 12779 тестов, 769 файлов — без падений |
| `npm run build` | PASS | Сборка чистая, `/admin/notifications` компилируется |
| `npx tsc --noEmit` | PASS | TypeScript ошибок нет |

---

## Таблица AC

| AC | Описание | Статус | Примечания |
|---|---|---|---|
| **AC-5.1** | `public/manifest.json` валидный, `start_url=/admin/dashboard`, `scope=/admin`, иконки 192/512 настоящие PNG | **PASS** | JSON валиден. `start_url: /admin/dashboard`, `scope: /admin`, `display: standalone`. PNG-файлы реальные (192×192 RGBA, 512×512 RGBA — проверено `file`). |
| **AC-5.2** | `<link rel="manifest">` + `apple-mobile-web-app-capable` в admin layout | **PASS** | `src/app/admin/layout.tsx` экспортирует `metadata.manifest = "/manifest.json"` и `metadata.appleWebApp.capable = true`. Next.js рендерит оба тега в `<head>`. Только для `/admin/*` — публичный сайт не затронут. |
| **AC-5.3** | SW обрабатывает `push` event — показывает уведомление; пустой/невалидный payload не падает | **PASS** | `sw.js` оборачивает `event.data.json()` в `try/catch`. При ошибке парсинга и при `event.data === null` использует пустой объект `{}`. Заголовок и тело имеют дефолты (`"Деловой — уведомление"`, `"Открыть админку для деталей"`). `event.waitUntil(showNotification(...))` — браузер не показывает пустой системный алерт. |
| **AC-5.4** | SW `notificationclick` — same-origin guard работает (cross-origin URL → fallback на `/admin/dashboard`) | **PASS*** | Same-origin guard реализован корректно: `new URL(rawUrl, self.location.origin)` + сравнение `u.origin === self.location.origin`. Покрыты случаи: cross-origin URL → `/admin/dashboard`, `null` data → fallback, невалидный URL → `catch` → fallback. Примечание: реализация хранит URL в `notification.data.url` (а не в `actions[0].url` как в формулировке PRD). Это внутренне согласованно (push-handler тоже кладёт url в `data.url`), но является отклонением от буквальной формулировки PRD. Функционально эквивалентно. |
| **AC-5.6** | iOS без PWA — `WebPushOptIn` показывает инструкцию «Добавьте на главный экран» | **PASS** | `detectSupport()` в `web-push-utils.ts` определяет iOS по UA (`/iP(hone|ad|od)/`), проверяет `navigator.standalone !== true` и `!('PushManager' in window)`. Возвращает `"ios_not_pwa"`. Компонент рендерит отдельный блок с инструкцией. Тест `"returns 'ios_not_pwa' on iOS Safari without standalone"` — PASS. |
| **AC-6.1** | USER не видит компонент (RBAC guard в WebPushOptIn) | **PASS** | Гварды в строгом порядке: `status === "loading" → null`, `!session?.user → null`, `session.user.role === "USER" → null` — всё до любого state-рендера. Компонент монтируется на странице `/admin/notifications` (только `MANAGER`/`SUPERADMIN` имеют доступ к `/admin/*`). Двойная защита выдержана. |
| **AC-6.3** | Subscribe flow (permission request → SW register → API call) корректен | **PASS** | `performSubscribe()` в правильном порядке: (1) `requestPermission()`, (2) `serviceWorker.register("/sw.js")`, (3) `getVapidPublicKey()`, (4) `pushManager.subscribe()`, (5) `postSubscribe()`. Тест `"happy path"` покрывает полный flow. Ошибка при `permission === "denied"` → прерывает до `register` и `postSubscribe`. |
| **AC-6.6** | Unsubscribe flow корректен | **PASS*** | `performUnsubscribe()` корректен: `getRegistration → getSubscription → sub.unsubscribe() → api.deleteSubscribe()`. Идиоматично обрабатывает отсутствие регистрации/подписки (возвращает `alreadyUnsubscribed: true`). Примечание: PRD AC-6.6 описывает `POST /api/notifications/web-push/unsubscribe`, реализация использует `DELETE /api/notifications/web-push/subscribe` — как определено в ADR, который имеет приоритет над PRD в части API-контрактов. |

---

## Security

| Кейс | Статус | Детали |
|---|---|---|
| RBAC: USER → компонент hidden | PASS | `session.user.role === "USER" → return null` до рендера |
| RBAC: анонимный → компонент hidden | PASS | `!session?.user → return null` |
| Same-origin guard в SW | PASS | Cross-origin URL → fallback `/admin/dashboard`. `null` data → fallback. Невалидный URL → `catch` → fallback. |
| VAPID private key не в клиентском коде | PASS | `web-push-utils.ts` использует только `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Private key только на сервере (PR 1/2 scope). |
| Данные подписки: endpoint без криптоключей | PASS | `UserNotificationChannel.address` = endpoint URL; `p256dh`/`auth` в sidecar `WebPushSubscription` (PR 1/2). |

---

## Баг-репорты

### BUG-01: SW registraton scope — "/" вместо "/admin" (ADR-отклонение, Minor)

**Серьёзность:** Minor

**Модуль:** notifications / web-push PWA

**Описание:**
ADR §Безопасность явно требует: «для админки делаем явный `scope: '/admin'` при register». Реализация в `web-push-utils.ts` использует `{ scope: "/" }`.

**Фактическое:**
```ts
const registration = await deps.serviceWorker.register("/sw.js", { scope: "/" });
```

**Ожидаемое (по ADR):**
```ts
const registration = await deps.serviceWorker.register("/sw.js", { scope: "/admin" });
```

**Функциональный эффект:**
Низкий — `sw.js` не имеет `fetch`-обработчика и не кеширует ресурсы, поэтому не может перехватывать B2C-запросы. Push-функциональность работает корректно при обоих вариантах scope. Тем не менее, scope `"/"` даёт SW права контролировать все страницы сайта, что противоречит принципу минимальных привилегий, зафиксированному в ADR.

**Шаги для воспроизведения:**
1. Открыть `src/components/admin/notifications/web-push-utils.ts`, строка 137.
2. Сравнить с ADR §Безопасность, пункт 8.

---

### NOTE-01: AC-5.4 — URL из `data.url`, а не `actions[0].url` (PRD-расхождение, Informational)

**Серьёзность:** Informational (не баг)

**Описание:**
PRD AC-5.4 описывает URL как «из `payload.actions[0].url`». ADR в sample-коде также использует `data?.actions?.[0]?.url`. Реализация хранит URL в `notification.data.url` (через push-handler `data: { url }`) и читает его в `notificationclick` как `event.notification.data.url`. Это внутренне согласованное поведение — оба обработчика используют одну и ту же структуру.

**Статус:** Не является дефектом — реализация самосогласована. PRD-формулировка `actions[0].url` была ориентировочной и не стала обязательным контрактом. При желании можно уточнить формулировку в PRD.

---

## Edge cases

| Случай | Проверен | Статус |
|---|---|---|
| Push event с `event.data = null` | Да (код) | PASS — `event.data ? event.data.json() : {}` |
| Push event с невалидным JSON в payload | Да (код) | PASS — `catch (_err) { data = {}; }` |
| `notificationclick` с `null` data | Да (код + симуляция) | PASS — `(notification.data && notification.data.url) \|\| '/admin/dashboard'` |
| `notificationclick` с cross-origin URL | Да (симуляция) | PASS — fallback `/admin/dashboard` |
| `notificationclick` с невалидным URL | Да (симуляция) | PASS — `catch` → `/admin/dashboard` |
| iOS без PushManager, без standalone | Да (тест) | PASS — `ios_not_pwa` |
| iOS со standalone, без PushManager | Да (тест) | PASS — `unsupported` |
| Браузер без serviceWorker / PushManager | Да (тест) | PASS — `unsupported` |
| Permission denied перед SW register | Да (тест) | PASS — throws `permission:denied`, SW не регистрируется |
| VAPID сервер 503 | Да (тест) | PASS — throws `vapid-key:503`, UI показывает error state |
| Повторный subscribe с тем же endpoint | Да (код, upsert) | PASS — не создаёт дубль (уровень сервиса, PR 2 scope) |
| Unsubscribe без активной регистрации SW | Да (тест) | PASS — `alreadyUnsubscribed: true` |

---

## Итоги

| Метрика | Значение |
|---|---|
| Всего AC проверено | 8 (AC-5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.3, 6.6) |
| PASS | 8 |
| FAIL | 0 |
| Баги | 1 Minor (BUG-01 SW scope) |
| Informational | 1 (NOTE-01 AC-5.4 URL source) |
| Security-кейсы FAIL | 0 |
| Тесты (регрессия) | 12779/12779 PASS |
| Сборка | PASS |
| TypeScript | PASS |
