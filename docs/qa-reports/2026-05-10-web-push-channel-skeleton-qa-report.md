# QA Report: PR 1/4 — Web Push channel skeleton

**Дата**: 2026-05-10
**PR**: #250 — `claude/feat-web-push-channel-skeleton`
**Коммиты**: `ed3e6fb` (feat) + `89da0cd` (reviewer fixes)
**Скоуп**: AC-4.1, AC-4.2, AC-4.4, AC-4.6 + флаг WEB_PUSH_ENABLED
**Статус**: PASS

---

## Вердикт: PASS

---

## Результаты тестов

```
npm test (web-push):   47 tests passed / 0 failed (4 test files)
npm test (full suite): 882 tests passed / 0 failed (80 test files)
npx tsc --noEmit:      0 ошибок
```

Все тесты зелёные. Регрессий не обнаружено.

---

## Проверка Acceptance Criteria

| AC | Описание | Статус | Примечание |
|----|----------|--------|-----------|
| AC-4.1 | `WebPushChannel implements INotificationChannel`, `kind = "PUSH"`, расположен в `src/modules/notifications/dispatch/channels/web-push/` | **PASS** | Класс реализует интерфейс, `readonly kind: NotificationChannelKind = "PUSH"`, файловая структура точно соответствует ADR |
| AC-4.2 | `isAvailable()` возвращает `false` без `WEB_PUSH_ENABLED=true`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (legacy `VAPID_CONTACT_EMAIL` поддерживается) | **PASS** | `isWebPushEnabled()` проверяет флаг + Zod-валидацию всех трёх ключей; fallback с legacy alias реализован в `readSubject()`; 4 теста в `vapid.test.ts` |
| AC-4.4 | 410/404 → `isActive=false` + `retryable=false`; 5xx/timeout → `retryable=true` | **PASS** | `classifyError()` обрабатывает все случаи; транзакционно деактивирует `WebPushSubscription` и `UserNotificationChannel`; тесты покрывают 410, 404, 401, 500, 429 |
| AC-4.6 | Таблица `WebPushSubscription` со всеми полями + индекс `[userId, isActive]` | **PASS** | Все поля из ADR присутствуют; дополнительно есть `lastSuccessAt`, `lastFailureAt`, `lastFailureReason` (расширение ADR, не нарушение); индекс создан; миграция аддитивная |
| Флаг WEB_PUSH_ENABLED | При `false`/unset — регистрируется `PushChannel` stub, не `WebPushChannel` | **PASS** | `bootstrapChannels()` вызывает `isWebPushEnabled()` и регистрирует stub при `false`; тест `channel.test.ts: "false when WEB_PUSH_ENABLED is unset"` |

---

## Детальная проверка

### AC-4.1 — Структура и интерфейс

Файлы в `src/modules/notifications/dispatch/channels/web-push/`:
- `index.ts` — `WebPushChannel implements INotificationChannel`
- `vapid.ts` — VAPID конфиг + feature-flag
- `service.ts` — `deactivateSubscriptionByEndpoint`, `recordSuccessfulDelivery`
- `validation.ts` — Zod-схемы + SSRF allowlist
- `types.ts` — `BrowserPushSubscription`, `VapidConfig`
- `__tests__/` — 4 тест-файла (channel, service, validation, vapid)

Интерфейс `INotificationChannel` соблюдён: `kind`, `isAvailable()`, `send(address, payload): Promise<DeliveryResult>`.

### AC-4.2 — isAvailable logic

```ts
isAvailable(): boolean {
  return isWebPushEnabled(this.env);
}

isWebPushEnabled(env): boolean {
  if (env.WEB_PUSH_ENABLED !== "true") return false;
  return readVapidConfigFromEnv(env) !== null;
}
```

Zod-схема в `vapid.ts` требует: `VAPID_PUBLIC_KEY` (base64url, min 40), `VAPID_PRIVATE_KEY` (base64url, min 20), `VAPID_SUBJECT` (mailto: или https://). Legacy `VAPID_CONTACT_EMAIL` обрабатывается в `readSubject()` с автодобавлением `mailto:`.

Тесты (все PASS):
- `isAvailable false when WEB_PUSH_ENABLED is unset`
- `isAvailable false when flag is 'false'`
- `isAvailable false when flag set but VAPID missing`
- `isAvailable true with full valid config`

### AC-4.4 — Обработка ошибок

| HTTP статус | retryable | Действие |
|------------|-----------|---------|
| 404 | false | деактивация subscription + UNC |
| 410 | false | деактивация subscription + UNC |
| 401 | false | деактивация subscription + UNC (VAPID mismatch) |
| 403 | false | деактивация subscription + UNC (VAPID mismatch) |
| 429 | true | нет деактивации |
| 5xx | true | нет деактивации |
| unknown | false | нет деактивации |

Деактивация выполняется транзакционно через `prisma.$transaction`. Тест `"HTTP 410 Gone deactivates subscription and UNC"` проверяет атомарность через mock-транзакцию.

**Замечание (не блокер):** PRD AC-4.4 упоминает поле `revokedAt`, в реализации оно отсутствует — используется `isActive=false` + `lastFailureAt` + `lastFailureReason`. Это соответствует уточнённой схеме ADR (§«Схема данных»). Поведение семантически идентично требованию PRD.

### AC-4.6 — Модель WebPushSubscription

Поля в `schema.prisma` и миграции:

| Поле | PRD | Факт | Статус |
|------|-----|------|--------|
| id | обязательно | `@id @default(cuid())` | PASS |
| userId | обязательно | FK → User, `onDelete: Cascade` | PASS |
| endpoint | обязательно, @unique | `@unique` | PASS |
| p256dh | обязательно | TEXT NOT NULL | PASS |
| auth | обязательно | TEXT NOT NULL | PASS |
| userAgent | опционально | `String? @db.Text` | PASS |
| isActive | default true | `Boolean @default(true)` | PASS |
| createdAt | обязательно | `@default(now())` | PASS |
| updatedAt | обязательно | `@updatedAt` | PASS |
| `@@index([userId, isActive])` | обязательно | создан в миграции | PASS |
| lastSuccessAt / lastFailureAt / lastFailureReason | в ADR, не в PRD | присутствуют | PASS (расширение) |
| userNotificationChannelId | в ADR | `@unique`, FK → UNC | PASS |

### Флаг WEB_PUSH_ENABLED — smoke-тест

`bootstrapChannels()` в `channels/index.ts`:
```ts
if (isWebPushEnabled()) {
  ChannelRegistry.register(new WebPushChannel());
} else {
  ChannelRegistry.register(PushChannel); // stub, isAvailable = false
}
```

При `WEB_PUSH_ENABLED=undefined` (default) — `PushChannel` stub регистрируется, `WebPushChannel` не создаётся. Никакого `kind=PUSH` с реальной реализацией в `ChannelRegistry` нет. Существующие Telegram и Email каналы не затронуты.

### Регрессия существующих notification-флоу

Полный тест-сьют: 882 тестов, 80 файлов — все зелёные. В частности:
- `notifications/__tests__/events.test.ts` — EVENT_ROUTING не изменился
- `notifications/dispatch/__tests__/channel-registry.test.ts` — Stub channels по-прежнему возвращают `isAvailable=false`
- `notifications/dispatch/__tests__/preferences.test.ts` — `pickChannel` работает корректно

---

## Security-кейсы

| Проверка | Статус | Детали |
|---------|--------|--------|
| VAPID private key не попадает в API-ответы | PASS | `service.ts` экспортирует `PublicWebPushSubscription` без `p256dh`/`auth`; тест `"never leaks p256dh / auth crypto secrets"` |
| SSRF allowlist для endpoint | PASS | `isAllowedPushEndpoint()` с `ALLOWED_PUSH_HOST_PATTERNS`; тест `"rejects https://evil.com/fake-push"`, `"rejects http://..."` (только HTTPS) |
| Канал неактивен по умолчанию | PASS | `WEB_PUSH_ENABLED=false` → stub регистрируется, реальный канал не создаётся |

Security-кейсы для PR 1 in-scope. API/RBAC/rate-limit — PR 2, out-of-scope для данного QA.

---

## Найденные проблемы

Блокирующих багов нет.

Замечание (Minor, не блокирующее):
- `BUG-NOTE-1`: Термин `revokedAt` в PRD AC-4.4 не совпадает с именами полей в реализации (`isActive=false` + `lastFailureAt`). Разночтение документальное — ADR явно определяет схему без `revokedAt`, код следует ADR. Рекомендация: уточнить формулировку в PRD при следующем цикле документирования.

---

## Итог

| Категория | Результат |
|----------|-----------|
| Тесты | 882/882 PASS |
| TypeScript | 0 ошибок |
| AC-4.1 | PASS |
| AC-4.2 | PASS |
| AC-4.4 | PASS |
| AC-4.6 | PASS |
| Флаг WEB_PUSH_ENABLED | PASS |
| Регрессия | PASS (нет регрессий) |
| Security (in-scope PR 1) | PASS |

**Вердикт: PASS**

PR 1 готов к мержу. Канал зарегистрирован, по умолчанию отключён (`WEB_PUSH_ENABLED=false`), существующие notification-флоу не затронуты. Деплой безопасен.
