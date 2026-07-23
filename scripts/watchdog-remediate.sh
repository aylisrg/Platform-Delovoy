#!/usr/bin/env bash
# Watchdog remediation — запускается workflow'ом site-watchdog.yml по SSH,
# когда внешняя проверка https://delovoy-park.ru не прошла.
#
# Печатает диагностику, затем поднимает сайт ступенями (от мягкой к жёсткой),
# после каждой ступени перепроверяя здоровье. Никогда не падает молча:
# последняя строка вывода всегда WATCHDOG_RESULT=healthy|recovered|failed.
#
# Перезагрузка всего сервера сюда намеренно НЕ входит — это ручное действие
# через timeweb-manage.yml (action=server-reboot).
set -uo pipefail

COMPOSE_DIR="/opt/delovoy-park"
PUBLIC_HEALTH="https://delovoy-park.ru/api/health"
# Blue-green (scripts/deploy-bluegreen.sh): активный слот задаёт порт и имя
# контейнера приложения. Без файла ACTIVE_SLOT — классический слот a (3000).
ACTIVE_SLOT=$(cat "$COMPOSE_DIR/ACTIVE_SLOT" 2>/dev/null || echo a)
if [ "$ACTIVE_SLOT" = "b" ]; then
  LOCAL_HEALTH="http://127.0.0.1:3001/api/health"
  APP_CONTAINER="delovoy-app-b"
  COMPOSE_CMD="docker compose --profile bluegreen"
else
  LOCAL_HEALTH="http://127.0.0.1:3000/api/health"
  APP_CONTAINER="delovoy-app"
  COMPOSE_CMD="docker compose"
fi
# Если контейнер app моложе этого порога — вероятно, идёт деплой; рестарты пропускаем.
DEPLOY_GRACE_SECONDS=300

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"

local_ok()  { curl -sf --max-time 10 "$LOCAL_HEALTH" > /dev/null 2>&1; }
public_ok() { curl -sf --max-time 15 "$PUBLIC_HEALTH" > /dev/null 2>&1; }

wait_local_ok() {
  # $1 = максимум секунд ожидания
  local deadline=$(( $(date +%s) + $1 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if local_ok; then return 0; fi
    sleep 5
  done
  return 1
}

app_age_seconds() {
  local started
  started=$(docker inspect "$APP_CONTAINER" --format '{{.State.StartedAt}}' 2>/dev/null || echo "")
  if [ -z "$started" ]; then echo 999999; return; fi
  local started_epoch
  started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
  echo $(( $(date +%s) - started_epoch ))
}

finish() {
  echo ""
  echo "WATCHDOG_RESULT=$1"
  exit 0
}

echo "===== WATCHDOG REMEDIATION $(date -u '+%Y-%m-%d %H:%M:%S UTC') ====="

echo ""
echo "=== Diagnostics: uptime / memory / disk ==="
uptime
free -m
swapon --show 2>/dev/null || echo "No swap"
df -h / | tail -1

echo ""
echo "=== Containers ==="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo ""
echo "=== Restart / OOM state ==="
for C in $(docker ps -a --format '{{.Names}}'); do
  docker inspect "$C" --format "$C: restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} status={{.State.Status}} started={{.State.StartedAt}}" 2>/dev/null
done

echo ""
echo "=== Kernel OOM events (last 20) ==="
$SUDO dmesg -T 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -20 || echo "none"

echo ""
echo "=== App logs (last 40) ==="
docker logs --tail 40 "$APP_CONTAINER" 2>&1 | tail -40 || echo "no app container"

echo ""
echo "===== REMEDIATION ====="

# T0: снять зомби-контейнеры от `docker compose run` — полные копии приложения,
# держащие память (см. инцидент 2026-07-06).
LEFTOVERS=$(docker ps -a --filter "name=-run-" --format '{{.Names}}' || true)
if [ -n "$LEFTOVERS" ]; then
  echo "T0: removing leftover compose-run containers: $LEFTOVERS"
  echo "$LEFTOVERS" | xargs -r docker rm -f || true
else
  echo "T0: no leftover containers"
fi

if public_ok; then
  echo "Public health OK — nothing to fix."
  finish healthy
fi

if local_ok; then
  # Приложение живо, но снаружи сайт не отвечает — проблема на уровне nginx/TLS.
  echo "T1: app healthy locally but public check fails — reloading nginx"
  if $SUDO nginx -t; then
    $SUDO systemctl reload nginx || $SUDO systemctl restart nginx || true
  else
    echo "T1: nginx config test FAILED — restarting nginx anyway"
    $SUDO systemctl restart nginx || true
  fi
  sleep 5
  if public_ok; then finish recovered; fi
else
  AGE=$(app_age_seconds)
  if [ "$AGE" -lt "$DEPLOY_GRACE_SECONDS" ]; then
    # Контейнер только что (пере)создан — почти наверняка идёт деплой с тяжёлым
    # entrypoint (prisma generate/migrate). Даём ему дозреть вместо рестарта.
    echo "T2: app container is only ${AGE}s old (deploy in progress?) — waiting instead of restarting"
    if wait_local_ok 180 && public_ok; then finish recovered; fi
    finish failed
  fi

  echo "T2: restarting $APP_CONTAINER"
  docker restart "$APP_CONTAINER" || true
  if wait_local_ok 90; then
    sleep 3
    if public_ok; then finish recovered; fi
    echo "T2: local OK but public still down — reloading nginx"
    $SUDO systemctl reload nginx || $SUDO systemctl restart nginx || true
    sleep 5
    if public_ok; then finish recovered; fi
  fi

  echo "T3: $COMPOSE_CMD up -d (recreate whole stack if needed)"
  cd "$COMPOSE_DIR" && $COMPOSE_CMD up -d || true
  if wait_local_ok 180; then
    sleep 3
    if public_ok; then finish recovered; fi
    $SUDO systemctl reload nginx || $SUDO systemctl restart nginx || true
    sleep 5
    if public_ok; then finish recovered; fi
  fi
fi

echo "All remediation tiers exhausted — site is still down. Manual action needed"
echo "(e.g. timeweb-manage.yml action=server-reboot)."
finish failed
