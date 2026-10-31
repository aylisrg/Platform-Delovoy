#!/usr/bin/env bash
# Exercise the actual workflow backup block with failing Docker operations.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir "$TEST_DIR/bin"
export CALLS="$TEST_DIR/calls" DEPLOY_BACKUP_DIR="$TEST_DIR/backups"
export PATH="$TEST_DIR/bin:$PATH"
{
  echo 'set -euo pipefail'
  sed -n '/# deploy-backup-begin/,/# deploy-backup-end/p' "$ROOT/.github/workflows/deploy.yml"
  echo 'echo SUCCESS_AFTER_BACKUP'
} > "$TEST_DIR/backup.sh"
cat > "$TEST_DIR/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
  *' pg_dump '*)
    [ "$MODE" != emptydump ] || exit 0
    echo dump
    [ "$MODE" != faildump ] || exit 7 ;;
  *' pg_restore --list')
    cat >/dev/null
    [ "$MODE" != listfail ] || exit 8 ;;
  inspect*) echo 'sha256:existing-postgres-image' ;;
  run*) [ "$MODE" != startfail ] || exit 9 ;;
  *' pg_isready '*) [ "$MODE" != unready ] || exit 10 ;;
  *' pg_restore --exit-on-error '*)
    cat >/dev/null
    [ "$MODE" != restorefail ] || exit 11 ;;
  *' psql '*)
    if [ "$MODE" = zerotables ]; then echo 0; else echo 91; fi ;;
  'rm -f delovoy-deploy-restore-'*) ;;
  *) echo 'Unexpected Docker command' >&2; exit 12 ;;
esac
DOCKER
printf '#!/bin/sh\nexit 0\n' > "$TEST_DIR/bin/sleep"
chmod +x "$TEST_DIR/bin/docker" "$TEST_DIR/bin/sleep"
for MODE in faildump emptydump listfail startfail unready restorefail zerotables success; do
  export MODE
  : > "$CALLS"
  result=0
  bash "$TEST_DIR/backup.sh" > "$TEST_DIR/output" 2>&1 || result=$?
  if [ "$MODE" = success ]; then
    [ "$result" = 0 ] || { cat "$TEST_DIR/output"; exit 1; }
    grep -q SUCCESS_AFTER_BACKUP "$TEST_DIR/output"
    grep -q 'Backup restore verified: 91 tables' "$TEST_DIR/output"
  else
    [ "$result" != 0 ] || { echo "FAIL: $MODE did not block deployment"; exit 1; }
    if grep -q SUCCESS_AFTER_BACKUP "$TEST_DIR/output"; then exit 1; fi
  fi
  case "$MODE" in
    faildump|emptydump|listfail)
      if grep -q '^run ' "$CALLS"; then exit 1; fi ;;
    *) grep -q '^rm -f delovoy-deploy-restore-' "$CALLS" ;;
  esac
done
# The restore is isolated and never directed at the live database/container.
grep -q -- '--network none' "$CALLS"
grep -q -- '--tmpfs /var/lib/postgresql/data' "$CALLS"
grep -q 'pg_restore --exit-on-error --no-owner --no-privileges -U restore -d verify' "$CALLS"
echo 'PASS deployment backup: 7 failure paths block; success restores and cleans up'
