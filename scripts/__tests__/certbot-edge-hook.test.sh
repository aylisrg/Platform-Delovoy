#!/bin/bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir "$TEST_DIR/bin"
export TLS_QA_LOG="$TEST_DIR/calls"
cat > "$TEST_DIR/bin/openssl" <<'MOCK'
#!/bin/sh
printf 'openssl %s\n' "$*" >> "$TLS_QA_LOG"
exit "${TLS_QA_CERT_EXIT:-0}"
MOCK
cat > "$TEST_DIR/bin/docker" <<'MOCK'
#!/bin/sh
printf 'docker %s\n' "$*" >> "$TLS_QA_LOG"
if [ "$1" = inspect ]; then printf '%s\n' "${TLS_QA_EDGE_RUNNING:-true}"; exit 0; fi
if [ "$*" = 'exec delovoy-edge nginx -t' ]; then exit "${TLS_QA_NGINX_EXIT:-0}"; fi
MOCK
chmod +x "$TEST_DIR/bin/openssl" "$TEST_DIR/bin/docker"
export PATH="$TEST_DIR/bin:$PATH"
HOOK="$SCRIPT_DIR/certbot-delovoy-edge-hook.sh"
export RENEWED_LINEAGE=/etc/letsencrypt/live/delovoy-park.ru

: > "$TLS_QA_LOG"
RENEWED_LINEAGE=/etc/letsencrypt/live/staging.delovoy-park.ru sh "$HOOK"
test ! -s "$TLS_QA_LOG"

: > "$TLS_QA_LOG"
TLS_QA_CERT_EXIT=1 sh "$HOOK" && { echo 'invalid certificate accepted'; exit 1; }
! grep -q '^docker ' "$TLS_QA_LOG"

: > "$TLS_QA_LOG"
TLS_QA_NGINX_EXIT=1 sh "$HOOK" && { echo 'invalid nginx config accepted'; exit 1; }
! grep -q 'nginx -s reload' "$TLS_QA_LOG"

: > "$TLS_QA_LOG"
TLS_QA_EDGE_RUNNING=false sh "$HOOK"
! grep -q '^docker exec' "$TLS_QA_LOG"

: > "$TLS_QA_LOG"
sh "$HOOK"
grep -q -- '-checkhost delovoy-park.ru' "$TLS_QA_LOG"
grep -q -- '-checkhost www.delovoy-park.ru' "$TLS_QA_LOG"
grep -q -- '-checkend 0' "$TLS_QA_LOG"
grep -q 'nginx -t' "$TLS_QA_LOG"
grep -q 'nginx -s reload' "$TLS_QA_LOG"
echo 'TLS deploy-hook: 5 safety scenarios passed'
