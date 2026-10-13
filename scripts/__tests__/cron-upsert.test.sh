#!/usr/bin/env bash
# Тест идемпотентной замены cron-строк из deploy.yml (issue #1074).
# Запуск: bash scripts/__tests__/cron-upsert.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAKE="$(mktemp)"; trap 'rm -f "$FAKE" "$FAKE.new"' EXIT
# Как настоящий crontab: читаем stdin целиком, потом заменяем файл.
crontab() { if [ "$1" = "-l" ]; then cat "$FAKE"; else cat > "$FAKE.new"; mv "$FAKE.new" "$FAKE"; fi; }
eval "$(sed -n '/# cron-upsert-begin/,/# cron-upsert-end/p' "$ROOT/.github/workflows/deploy.yml")"
S=secret
cat > "$FAKE" <<'C'
30 1 * * * /opt/delovoy-park/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
*/10 * * * * curl -fsS https://delovoy-park.ru/api/cron/payments-reconcile?token=OLD > /dev/null 2>&1
*/10 * * * * curl -fsS https://delovoy-park.ru/api/cron/payments-reconcile?token=OLD2 > /dev/null 2>&1
0 * * * * curl -fsS https://delovoy-park.ru/api/cron/notifications-digest > /dev/null 2>&1
C
run() {
  upsert_cron '/api/cron/process-outgoing' "* * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/process-outgoing > /dev/null 2>&1"
  upsert_cron '/api/cron/payments-reconcile' "*/10 * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/payments-reconcile > /dev/null 2>&1"
  upsert_cron '/api/cron/notifications' "*/5 * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/notifications > /dev/null 2>&1"
}
OUT=$(run); [ -z "$OUT" ] || { echo "FAIL: upsert printed output"; exit 1; }
FIRST=$(cat "$FAKE"); run; [ "$FIRST" = "$(cat "$FAKE")" ] || { echo "FAIL: not idempotent"; exit 1; }
fail() { echo "FAIL: $1"; exit 1; }
grep -q 'token=' "$FAKE" && fail "old ?token= line left"
[ "$(wc -l < "$FAKE")" -eq 5 ] || fail "expected 5 lines"
grep -q 'cron-backup.sh' "$FAKE" || fail "unrelated line removed"
grep -q 'notifications-digest' "$FAKE" || fail "similar-path line removed"
for p in process-outgoing payments-reconcile 'notifications >'; do
  [ "$(grep -c "api/cron/$p" "$FAKE")" -eq 1 ] || fail "dup/missing $p"; done
: > "$FAKE"; run; [ "$(wc -l < "$FAKE")" -eq 3 ] || fail "empty crontab case"
echo "PASS cron-upsert"
