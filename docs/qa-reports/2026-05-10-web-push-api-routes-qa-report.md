# QA Report: PR 2/4 — Web Push API Routes

**Дата**: 2026-05-10
**PR**: #252 — `claude/feat-web-push-api-routes`
**Коммит**: `ed95105` (после review-правок)
**Скоуп**: AC-6.3, AC-6.4, AC-6.6, AC-6.7, AC-6.8 + Feature flag 503 + SSRF allowlist + Rate limit + AuditLog
**Тестировал**: QA Agent (автоматизированный)

---

## Вердикт: FAIL

**Причина**: AC "Feature flag: все три endpoint возвращают 503 если `WEB_PUSH_ENABLED !== 'true'`" — FAIL.
`DELETE /api/notifications/web-push/subscribe` не содержит вызова `isWebPushEnabled()` и вернёт 200 (не 503) при отключённом флаге. Баг-репорт BUG-01 ниже.

---

## Результаты тестов

```
npm test (targeted — web-push + rate-limit): 78 tests / 7 files — все PASS
npm test (full suite):                       12 759 tests / 768 files — все PASS
npx tsc --noEmit:                            0 ошибок
```

Регрессий в существующем коде нет.

---

## Проверка Acceptance Criteria

| AC | Описание | Статус | Примечание |
|----|----------|--------|-----------|
| AC-6.3 | POST subscribe: SUPERADMIN/MANAGER создают WebPushSubscription + UNC(kind=PUSH). p256dh/auth не возвращаются | PASS | Тест `happy path`: проверяет отсутствие `p256dh`/`auth` и `p256dh` в ответе. UNC создаётся через `subscribeUser` (транзакция). |
| AC-6.4 | Повторный POST с тем же endpoint реактивирует inactive подписку (priority сохранён, lastFailureReason=null) | PASS | Service-test `reactivates existing inactive subscription`: upsert обновляет `isActive=true`, `lastFailureReason: null`; в UNC update-блок сохраняет priority (не перезаписывает). |
| AC-6.6 | DELETE идемпотентен — 200 даже для несуществующей/чужой подписки с `alreadyInactive: true`. Помечает isActive=false, удаляет UNC | PASS | Тесты: `idempotent: 200 alreadyInactive=true when subscription not found` и `idempotent: returns alreadyInactive=true when subscription belongs to another user` — оба PASS. |
| AC-6.7 | GET vapid-public-key: public, без auth, отдаёт публичный ключ. 503 без WEB_PUSH_ENABLED=true или без ключа | PASS | Endpoint не содержит `auth()`. Тесты: happy path 200, `WEB_PUSH_ENABLED=false` → 503, `VAPID_PUBLIC_KEY missing` → 503. |
| AC-6.8 | USER → 403 на POST и DELETE. Без сессии → 401 | PASS | Subscribe: `403 when USER role`, `401 when not authenticated`. Unsubscribe: `403 when USER role`, `401 when not authenticated`. |
| Feature flag | Все три endpoint возвращают 503 если `WEB_PUSH_ENABLED !== "true"` | **FAIL** | POST: проверяет флаг — OK. GET vapid-public-key: проверяет флаг — OK. **DELETE: `isWebPushEnabled()` не вызывается** — при отключённом флаге вернёт 200, а не 503. |
| SSRF allowlist | subscribe и unsubscribe оба отклоняют endpoint вне allowlist | PASS | POST: тест `422 SSRF: endpoint host not in allowlist`. DELETE: тест `422 when endpoint host not in SSRF allowlist`. Validation.test.ts: allowlist проверен на 6 allowlisted + 6 rejected URL. |
| Rate limit | subscribe — 10/мин/user (tier `web-push-subscribe`) | PASS | Тест `uses web-push-subscribe rate-limit tier keyed per-user`. `rate-limit.ts`: tier `web-push-subscribe` настроен с `limit: 10, windowSeconds: 60`. |
| Rate limit DELETE | тот же tier `web-push-subscribe` | PASS | Тест `uses web-push-subscribe rate-limit tier keyed per-user` для DELETE — отдельный тест-файл. |
| AuditLog subscribe | пишет лог без криптоключей | PASS | Тест проверяет: `auditLogCreateMock` вызван с `action: "notification.web-push.subscribe"`, metadata содержит `endpointHost`, НЕ содержит p256dh/auth. |
| AuditLog unsubscribe | пишет только когда реально деактивировано (не спамит) | PASS | Тест `idempotent: no AuditLog` — `auditLogCreateMock` не вызван при `alreadyInactive: true`. |

---

## Детальные тест-кейсы

### TC-1: POST subscribe — happy path SUPERADMIN/MANAGER
- **Привязан**: AC-6.3
- **Статус**: PASS
- **Покрытие**: тест `happy path: creates subscription, writes AuditLog, doesn't leak p256dh/auth` (subscribe.test.ts). Роль MANAGER. SUPERADMIN явного теста нет — однако логика проверки `role === "USER" → 403` не блокирует SUPERADMIN, что корректно.

### TC-2: POST subscribe — повторный вызов, идемпотентность AC-6.4
- **Привязан**: AC-6.4
- **Статус**: PASS
- **Покрытие**: service.test.ts `reactivates existing inactive subscription`. UNC update-блок содержит `isActive: true, lastFailureReason: null` без перезаписи `priority`. Проверено на уровне upsert-аргументов.

### TC-3: DELETE — идемпотентность AC-6.6
- **Привязан**: AC-6.6
- **Статус**: PASS
- **Покрытие**: `idempotent: 200 alreadyInactive=true when subscription not found, no AuditLog` — проверяет и тело ответа и отсутствие AuditLog. service.test.ts `idempotent: returns alreadyInactive=true when subscription belongs to another user` — подтверждает no-leak факта существования чужой подписки.

### TC-4: GET vapid-public-key — без auth, 503 по флагу AC-6.7
- **Привязан**: AC-6.7
- **Статус**: PASS
- **Покрытие**: route.ts не содержит `auth()`. 3 теста: 200 с ключом, 503 при `WEB_PUSH_ENABLED=false`, 503 при отсутствии `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

### TC-5: RBAC — USER → 403, анонимный → 401 AC-6.8
- **Привязан**: AC-6.8
- **Статус**: PASS
- **Покрытие**: отдельные тесты для каждого endpoint и каждого сценария.

### TC-6: Feature flag 503 на DELETE
- **Привязан**: Feature flag AC (все три endpoint)
- **Статус**: **FAIL**
- **Шаги**: установить `WEB_PUSH_ENABLED=false`, сделать DELETE /api/notifications/web-push/subscribe с авторизованным MANAGER-сессией.
- **Ожидаемый результат**: 503 `WEB_PUSH_DISABLED`.
- **Фактический результат**: обработчик пропускает флаг-проверку и продолжает выполнение (возвращает 200 или 422 в зависимости от тела).

### TC-7: SSRF защита — оба endpoint
- **Привязан**: SSRF allowlist AC
- **Статус**: PASS
- **Покрытие**: allowlist реализован через Zod `.refine(isAllowedPushEndpoint)` в обоих схемах. `webPushUnsubscribeSchema` также применяется для DELETE. Протокол `http://` отклоняется даже для allowlisted хоста.

### TC-8: Rate limit — tier web-push-subscribe 10/мин/user
- **Привязан**: Rate limit AC
- **Статус**: PASS
- **Покрытие**: `CONFIGS["web-push-subscribe"] = { limit: 10, windowSeconds: 60 }`. Тесты для POST и DELETE проверяют аргументы вызова `rateLimit(req, "web-push-subscribe", userId)`.

### TC-9: AuditLog — нет криптоключей
- **Привязан**: AC-6.3, data leakage security AC
- **Статус**: PASS
- **Покрытие**: subscribe route извлекает только `endpointHost` (hostname через `new URL().hostname`) в metadata. Сам `p256dh`/`auth` в metadata не попадает. Тест явно проверяет, что ответ не содержит строк `SECRET-P256`, `SECRET-AUTH`, `p256dh`.

### TC-10: Data leakage — p256dh/auth не в ответе subscribe
- **Привязан**: AC-6.3
- **Статус**: PASS
- **Покрытие**: `toPublicWebPushSubscription` возвращает только `id, userId, endpoint, userAgent, isActive, lastSuccessAt, lastFailureAt, createdAt, updatedAt`. Поля `p256dh`/`auth` исключены явно. Тест сериализует ответ и проверяет через `JSON.stringify`.

---

## Баг-репорты

### BUG-01: DELETE /subscribe не проверяет feature flag WEB_PUSH_ENABLED

**Серьёзность**: Major

**Модуль**: notifications / web-push

**Шаги для воспроизведения**:
1. Установить `WEB_PUSH_ENABLED=false` (или не устанавливать — значение по умолчанию).
2. Выполнить `DELETE /api/notifications/web-push/subscribe` с авторизованным MANAGER-сессией и валидным body `{ endpoint: "https://fcm.googleapis.com/..." }`.

**Ожидаемый результат**:
`HTTP 503` `{ success: false, error: { code: "WEB_PUSH_DISABLED", ... } }` — аналогично POST и GET vapid-public-key.

**Фактический результат**:
Обработчик выполняется без 503 — начинает проверять auth, rate limit, body — и возвращает либо 200 (если сервис нашёл подписку), либо 422 (если endpoint не в allowlist), либо 200 с `alreadyInactive: true`.

**Окружение**:
- Файл: `src/app/api/notifications/web-push/subscribe/route.ts`, функция `DELETE`, строки 121–193
- Роль пользователя: MANAGER / SUPERADMIN

**Исправление** (не реализовывать — передаю Developer'у):
Добавить в начало функции `DELETE` те же две строки, что есть в `POST`:
```ts
if (!isWebPushEnabled()) {
  return apiError("WEB_PUSH_DISABLED", "Web Push недоступен", 503);
}
```
И добавить тест в `unsubscribe.test.ts`:
```ts
it("503 when web push disabled", async () => {
  process.env.WEB_PUSH_ENABLED = "false";
  authMock.mockResolvedValue({ user: { id: "user-1", role: "MANAGER" } });
  const res = await DELETE(makeReq({ endpoint: FCM_ENDPOINT }));
  expect(res.status).toBe(503);
});
```

---

## Security checklist

| Проверка | Статус | Примечание |
|----------|--------|-----------|
| Анонимный → 401 на защищённых endpoint | PASS | POST и DELETE |
| USER → 403 на POST и DELETE | PASS | |
| MANAGER не может отписать чужую подписку | PASS | `unsubscribeUser` возвращает `alreadyInactive: true` для чужих endpoint, no-op |
| SSRF: endpoint вне allowlist → 422 | PASS | Оба endpoint |
| VAPID private key не возвращается в API | PASS | `toPublicWebPushSubscription` исключает p256dh/auth; VAPID_PRIVATE_KEY нигде не экспортируется |
| AuditLog не логирует криптоключи | PASS | Только hostname + userAgent |
| Rate limit 10/мин/user на subscribe | PASS | Tier `web-push-subscribe` в rate-limit.ts |
| Feature flag — POST: 503 | PASS | |
| Feature flag — GET vapid-public-key: 503 | PASS | |
| Feature flag — DELETE: 503 | **FAIL** | BUG-01 |

---

## Регрессии

12 759 тестов / 768 файлов — все PASS. Регрессий не обнаружено.

---

## Итог

**PR 2/4 содержит один дефект (BUG-01):** `DELETE /api/notifications/web-push/subscribe` не проверяет feature flag `WEB_PUSH_ENABLED` и не возвращает 503 при отключённом Web Push. Это нарушение явного AC "все три endpoint возвращают 503". Без исправления AC не закрыт.

Все остальные AC проверены и PASS: idempotency DELETE, идемпотентная реактивация подписки (AC-6.4), data-leakage защита, SSRF allowlist на обоих endpoint, rate limit tier `web-push-subscribe`, AuditLog без спама при idempotent-операциях.

**Действие**: Developer исправляет BUG-01 (добавляет `isWebPushEnabled()` check + тест в DELETE handler) и пересдаёт PR на повторное QA.
