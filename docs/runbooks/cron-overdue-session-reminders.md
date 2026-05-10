# Runbook: Cron — overdue session reminders

PR 4/4 of the overdue-session-reminders feature. This cron drives the
single-source scanner in `src/modules/booking/overdue-reminders.ts` to
detect PS Park / gazebos sessions whose `endTime` has passed without
the manager closing them, and dispatch reminders / escalations through
the existing `NotificationDispatcher`.

## Endpoint

```
GET /api/cron/overdue-session-reminders
Authorization: Bearer ${CRON_SECRET}
```

Response (200):

```json
{
  "success": true,
  "data": {
    "processedAt": "2026-05-10T12:00:00.000Z",
    "scanned": 3,
    "dispatched": 4,
    "escalated": 1,
    "deduped": 2,
    "skippedNoChannel": 0
  }
}
```

Status codes:

| Code | When |
|---|---|
| 200 | Scan succeeded |
| 401 | `Authorization: Bearer …` missing or wrong |
| 429 | Rate limiter tripped (defence against accidental crontab misfire) |
| 503 | `CRON_SECRET` unset |
| 500 | Unexpected error in scanner |

## Schedule

Add to the VPS root crontab:

```cron
*/5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://delovoy-park.ru/api/cron/overdue-session-reminders > /dev/null 2>&1
```

`CRON_SECRET` must be exported in the crontab environment. Easiest:
keep it in `/etc/default/delovoy-cron` (chmod 600) and source it at
the top of the crontab:

```cron
SHELL=/bin/bash
BASH_ENV=/etc/default/delovoy-cron
*/5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/overdue-session-reminders > /dev/null 2>&1
```

## Configuration

- `CRON_SECRET` — same secret used by sibling cron endpoints
  (`rental-payment-reminders`, `no-show`).
- `WEB_PUSH_ENABLED=true` — **gates только канал Web Push**, не cron.
  Cron работает независимо: dispatcher per-user выбирает канал
  (Telegram → Web Push → Email). Менеджеры с привязанным `telegramId`
  получат уведомление даже когда Web Push выключен.
- Per-module overrides of the 5/15/30-minute thresholds: write to
  `Module.config.overdueThresholds` (JSONB) for slug `ps-park` /
  `gazebos`. Schema enforced at read-time by Zod — invalid overrides
  fall back to defaults and emit a `SystemEvent` WARNING.

```sql
-- Example: relax PS Park to 10/20/40 minutes.
UPDATE "Module"
   SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{overdueThresholds}',
       '{"firstReminderMinutes":10,"repeatReminderMinutes":20,"escalateToSuperadminMinutes":40}'::jsonb,
       true)
 WHERE slug = 'ps-park';
```

## Enabling Web Push as a delivery channel (one-off ops action)

Cron уже работает через Telegram. Чтобы добавить Web Push как fallback-канал:

1. Generate VAPID keys once: `npx web-push generate-vapid-keys --json`.
2. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` into the production env file.
3. Set `WEB_PUSH_ENABLED=true`, restart the app.
4. Have at least one MANAGER / SUPERADMIN subscribe via the in-app
   "Включить уведомления" button (PR 3) and verify a `WebPushSubscription`
   row appears.

Cron сам не зависит от этих шагов — он отправляет напоминания через
доступные каналы менеджеров (минимум — Telegram, если привязан).

## Verifying that it works

- **AuditLog** — every successful dispatch produces a row with
  `action = "notification.overdue.dispatched"`, `entity = "Booking"`.

  ```sql
  SELECT "userId", "entityId", metadata, "createdAt"
    FROM "AuditLog"
   WHERE action = 'notification.overdue.dispatched'
   ORDER BY "createdAt" DESC
   LIMIT 20;
  ```

- **SystemEvent** — escalations to SUPERADMIN, missing-recipient cases,
  no-channel cases, and invalid config overrides all surface here:

  ```sql
  SELECT level, source, message, "createdAt"
    FROM "SystemEvent"
   WHERE source = 'scheduler'
   ORDER BY "createdAt" DESC
   LIMIT 20;
  ```

- **OutgoingNotification** — the dispatcher's queue. Look for
  `eventType IN ('session.overdue.reminder',
  'session.overdue.escalation.manager',
  'session.overdue.escalation.superadmin')`.

- **Telegram alerts** — high-severity SystemEvents (level WARNING+
  with `source = 'scheduler'`) surface in the existing Telegram alert
  bot path.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Endpoint returns 503 with `SERVICE_UNAVAILABLE` | `CRON_SECRET` not set in the app env |
| Endpoint returns 401 for known-good token | trailing newline in `CRON_SECRET` env, or the secret was rotated only in the cron host |
| `scanned > 0` but `dispatched = 0`, no SystemEvents | All targets de-duped (5-min dedup window). Run again after a slot transition (5/15/30 min). |
| `skippedNoChannel > 0` rising | Manager has no active `UserNotificationChannel`. Have them subscribe via the admin UI. |
| `escalated > 0` but no SUPERADMIN got the alert | Check `OutgoingNotification.failureReason` for that user. Most common cause: stale Web Push subscription (410 Gone) — `WebPushChannel` will mark it inactive on next attempt. |
