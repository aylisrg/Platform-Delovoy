#!/usr/bin/env bash
# Тест идемпотентной замены cron-строк из deploy.yml (issue #1074).
# Запуск: bash scripts/__tests__/cron-upsert.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAKE="$(mktemp)"; trap 'rm -f "$FAKE" "$FAKE.new"' EXIT
MODE=ok   # ok | none | error
# Как настоящий crontab: stdin читается целиком, потом файл заменяется.
crontab() {
  if [ "$1" = "-l" ]; then
    case "$MODE" in
      none)  echo "no crontab for deploy" >&2; return 1 ;;
      error) echo "crontab: cannot open spool: Permission denied" >&2; return 1 ;;
      *)     cat "$FAKE" ;;
    esac
  else cat > "$FAKE.new"; mv "$FAKE.new" "$FAKE"; fi
}
eval "$(sed -n '/# cron-upsert-begin/,/# cron-upsert-end/p' "$ROOT/.github/workflows/deploy.yml")"
fail() { echo "FAIL: $1"; exit 1; }
S=secret
run() {
  upsert_cron '/api/cron/process-outgoing' "* * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/process-outgoing > /dev/null 2>&1"
  upsert_cron '/api/cron/payments-reconcile' "*/10 * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/payments-reconcile > /dev/null 2>&1"
  upsert_cron '/api/cron/notifications' "*/5 * * * * curl -H 'Authorization: Bearer $S' https://delovoy-park.ru/api/cron/notifications > /dev/null 2>&1"
}
cat > "$FAKE" <<'C'
30 1 * * * /opt/delovoy-park/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
*/10 * * * * curl -fsS https://delovoy-park.ru/api/cron/payments-reconcile?token=OLD > /dev/null 2>&1
*/10 * * * * curl -fsS https://delovoy-park.ru/api/cron/payments-reconcile?token=OLD2 > /dev/null 2>&1
* * * * * curl -fsS 'https://delovoy-park.ru/api/cron/process-outgoing' > /dev/null 2>&1
*/5 * * * * curl -fsS "https://delovoy-park.ru/api/cron/notifications/" > /dev/null 2>&1
0 * * * * curl -fsS https://delovoy-park.ru/api/cron/notifications-digest > /dev/null 2>&1
C
# 1. Замена, ничего не печатает
OUT=$(run 2>&1); [ -z "$OUT" ] || fail "upsert printed output"
grep -q 'token=' "$FAKE" && fail "old ?token= line left"
grep -q "process-outgoing'" "$FAKE" && fail "single-quoted URL line left"
grep -q 'notifications/"' "$FAKE" && fail "trailing-slash double-quoted URL line left"
[ "$(wc -l < "$FAKE")" -eq 5 ] || fail "expected 5 lines, got $(wc -l < "$FAKE")"
grep -q 'cron-backup.sh' "$FAKE" || fail "unrelated line removed"
grep -q 'notifications-digest' "$FAKE" || fail "similar-path line removed"
for p in process-outgoing payments-reconcile 'notifications >'; do
  [ "$(grep -c "api/cron/$p" "$FAKE")" -eq 1 ] || fail "dup/missing $p"; done
# 2. Идемпотентность
FIRST=$(cat "$FAKE"); run; [ "$FIRST" = "$(cat "$FAKE")" ] || fail "not idempotent"
# 3. Ошибка чтения crontab: ничего не пишем, код != 0
MODE=error
if OUT=$(upsert_cron '/api/cron/process-outgoing' "X" 2>&1); then fail "error not propagated"; fi
[ -z "$OUT" ] || fail "error path printed output"
[ "$FIRST" = "$(cat "$FAKE")" ] || fail "crontab changed on read error"
# 4. "no crontab" = пустой crontab
MODE=none
upsert_cron '/api/cron/process-outgoing' "* * * * * new" || fail "no-crontab returned error"
MODE=ok
[ "$(cat "$FAKE")" = "* * * * * new" ] || fail "no-crontab case"
# 5. Пустой файл
: > "$FAKE"; run; [ "$(wc -l < "$FAKE")" -eq 3 ] || fail "empty crontab case"
echo "PASS cron-upsert"
