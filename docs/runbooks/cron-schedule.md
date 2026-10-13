# Cron schedule (host crontab on VPS)

All cron routes are called from the VPS crontab with
`Authorization: Bearer $CRON_SECRET`. Entries are upserted idempotently by the
"Ensure process-outgoing cron is registered" step in `.github/workflows/deploy.yml`.
Server time is UTC.

## Scheduled

| Route | Schedule (UTC) |
|---|---|
| /api/cron/process-outgoing | every minute |
| /api/cron/payments-reconcile | */10 |
| /api/cron/notifications | */5 |
| /api/cron/rental-payment-reminders | 06:00 daily |
| /api/cron/overdue-session-reminders | */5 |
| /api/cron/process-recurring | 00:05 daily |
| /api/cron/inventory | :07, :22, :37, :52 (#1108) |

## Intentionally not scheduled (decision in #1108)

| Route | Reason | To enable |
|---|---|---|
| /api/cron/avito-account-sync | No Avito credentials in deploy env (`AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_ITEM_ID`), route is also gated by `AVITO_CRON_ENABLED=true`. | Add credentials to GitHub Secrets and env sync, set `AVITO_CRON_ENABLED=true`, then schedule hourly (e.g. `17 * * * *`). |
| /api/cron/avito-reviews-sync | Same as above. Sends staff Telegram alerts for reviews rated <= 3. | Same, hourly (e.g. `41 * * * *`). |
| /api/cron/avito-stats-sync | Same as above. | Same, every 15 min (e.g. `4,19,34,49 * * * *`). |
| /api/cron/avito-messenger-poll | Same as above, plus `AvitoIntegration.pollEnabled` must be true. Routes inbound client messages into leads. | Same, every minute. |
| /api/cron/no-show | Mutates bookings (CONFIRMED -> NO_SHOW) with no lower time bound: the first run would mark every past CONFIRMED booking in PS Park and Gazebos as NO_SHOW, including historical ones that were never checked in. | First confirm staff use check-in, count affected historical bookings and clean them up (or add a lower bound), then schedule every 5 min (e.g. `3-58/5 * * * *`). |
| /api/ps-park/auto-complete | Disabled by policy: admins close PS Park sessions manually. Returns 403 unless `PS_PARK_AUTO_COMPLETE_ENABLED=true`. | Owner decision to return to auto-complete. |
