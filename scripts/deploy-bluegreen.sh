#!/bin/sh
# Blue-green деплой без даунтайма.
#
# Схема: два слота приложения — a (app, 127.0.0.1:3000) и b (app-b,
# 127.0.0.1:3001, profile bluegreen). Новый образ поднимается в НЕАКТИВНОМ
# слоте, проходит health-гейт, nginx-upstream (conf.d/delovoy-upstream.conf)
# переключается на его порт с graceful reload — nginx дожёвывает in-flight
# запросы к старому слоту, пользователи не видят ни 502, ни паузы. Старый
# слот останавливается после 30с дренажа. Любой провал до переключения —
# работающий слот не тронут; провал публичной проверки после — upstream
# откатывается назад.
#
# Пререквизит: применён канонический vhost (ops-nginx apply) — есть
# /etc/nginx/conf.d/delovoy-upstream.conf. Иначе deploy.yml идёт legacy-путём.
#
# Активный слот хранится в /opt/delovoy-park/ACTIVE_SLOT (a|b); его читают
# watchdog-скрипты (порт/имя контейнера) и deploy.yml (какому контейнеру
# делать exec seed).
set -eu

COMPOSE_DIR=/opt/delovoy-park
SLOT_FILE=$COMPOSE_DIR/ACTIVE_SLOT
UPSTREAM_CONF=/etc/nginx/conf.d/delovoy-upstream.conf
PUBLIC_HEALTH=https://delovoy-park.ru/api/health
METER_LOG=/tmp/bluegreen-meter.log

SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
cd "$COMPOSE_DIR"

[ -f "$UPSTREAM_CONF" ] || { echo "bluegreen: нет $UPSTREAM_CONF — сначала ops-nginx apply"; exit 2; }

ACTIVE=$(cat "$SLOT_FILE" 2>/dev/null || echo a)
if [ "$ACTIVE" = "b" ]; then
    NEW_SLOT=a; NEW_SVC=app;   NEW_CONT=delovoy-app;   NEW_PORT=3000
    OLD_SVC=app-b; OLD_PORT=3001
else
    NEW_SLOT=b; NEW_SVC=app-b; NEW_CONT=delovoy-app-b; NEW_PORT=3001
    OLD_SVC=app; OLD_PORT=3000
fi
COMPOSE="docker compose --profile bluegreen"
echo "bluegreen: активный слот=$ACTIVE → деплою в $NEW_SLOT ($NEW_SVC → 127.0.0.1:$NEW_PORT)"

write_upstream() {
    printf 'upstream delovoy_app {\n    server 127.0.0.1:%s;\n    keepalive 32;\n}\n' "$1" | \
        $SUDO tee "$UPSTREAM_CONF" >/dev/null
}

# Даунтайм-метр: фоновый замер публичного health каждые 2с на всё окно деплоя.
# Итог (число не-200) — жёсткий гейт в конце.
: > "$METER_LOG"
(
    i=0
    while [ $i -lt 150 ]; do
        curl -s -o /dev/null -w "%{http_code}\n" --max-time 2 "$PUBLIC_HEALTH" >> "$METER_LOG" 2>/dev/null || echo "000" >> "$METER_LOG"
        i=$((i + 1))
        sleep 2
    done
) &
METER_PID=$!

fail() {
    echo "bluegreen: ПРОВАЛ — $1"
    kill "$METER_PID" 2>/dev/null || true
    exit 1
}

echo "bluegreen: поднимаю новый слот"
$COMPOSE up -d --no-deps "$NEW_SVC" || fail "compose up $NEW_SVC не прошёл"

echo "bluegreen: жду health нового слота (до 150с)"
HEALTHY=false
i=1
while [ $i -le 30 ]; do
    if docker exec "$NEW_CONT" wget --spider --quiet --timeout=5 http://localhost:3000/api/health 2>/dev/null; then
        HEALTHY=true
        echo "bluegreen: health OK (попытка $i)"
        break
    fi
    i=$((i + 1))
    sleep 5
done
if [ "$HEALTHY" != "true" ]; then
    $COMPOSE stop "$NEW_SVC" >/dev/null 2>&1 || true
    fail "новый слот не прошёл health — старый слот продолжает обслуживать"
fi

# Статик-архив ДО переключения: вкладки со старым HTML не должны ловить 404
# (nginx уже отдаёт /_next/static/ с диска — vhost с маркером static-archive).
ARCHIVE=/opt/delovoy-park/static-archive/_next/static
mkdir -p "$ARCHIVE"
if docker cp "$NEW_CONT":/app/.next/static/. "$ARCHIVE/" 2>/dev/null; then
    chmod -R a+rX "$ARCHIVE" || true
    find "$ARCHIVE" -type f -mtime +14 -delete || true
    find "$ARCHIVE" -type d -empty -delete || true
else
    echo "bluegreen: ⚠️ docker cp статики не прошёл — архив пропущен (не фатально)"
fi

echo "bluegreen: переключаю upstream на $NEW_PORT"
write_upstream "$NEW_PORT"
if ! $SUDO nginx -t; then
    write_upstream "$OLD_PORT"
    $COMPOSE stop "$NEW_SVC" >/dev/null 2>&1 || true
    fail "nginx -t после переключения — upstream возвращён на $OLD_PORT"
fi
$SUDO systemctl reload nginx

# Откат публичного трафика на старый слот: старый слот к этому моменту ещё
# не остановлен (стоп — только ниже, после успешной верификации), поэтому
# откат — это просто возврат upstream назад, без пересоздания контейнеров.
revert_to_old() {
    write_upstream "$OLD_PORT"
    $SUDO nginx -t && $SUDO systemctl reload nginx || true
    $COMPOSE stop "$NEW_SVC" >/dev/null 2>&1 || true
}

echo "bluegreen: публичная верификация"
sleep 3
PUB_OK=false
i=1
while [ $i -le 5 ]; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PUBLIC_HEALTH" 2>/dev/null || echo 000)
    if [ "$CODE" = "200" ]; then PUB_OK=true; break; fi
    i=$((i + 1))
    sleep 4
done
if [ "$PUB_OK" != "true" ]; then
    revert_to_old
    fail "публичный health не 200 через новый слот — upstream откачен на $OLD_PORT"
fi

# Smoke-тесты — ДО остановки старого слота (issue #570): раньше их гонял
# отдельный non-blocking шаг deploy.yml уже ПОСЛЕ того, как старый слот был
# остановлен, так что провал ловился, но откатывать было уже нечего.
if [ "${SKIP_SMOKE_TESTS:-false}" = "true" ]; then
    echo "bluegreen: smoke-тесты пропущены (skip_smoke_tests=true)"
elif ! sh scripts/smoke-tests.sh; then
    revert_to_old
    fail "smoke-тесты не прошли — upstream откачен на $OLD_PORT, старый слот не тронут"
fi

echo "$NEW_SLOT" > "$SLOT_FILE"
echo "bluegreen: активный слот теперь $NEW_SLOT; дренаж старого ($OLD_SVC) 30с"
sleep 30
$COMPOSE stop "$OLD_SVC" >/dev/null 2>&1 || true

kill "$METER_PID" 2>/dev/null || true
NON200=$(grep -cv '^200$' "$METER_LOG" 2>/dev/null || echo 0)
TOTAL=$(wc -l < "$METER_LOG" 2>/dev/null || echo 0)
echo "bluegreen: даунтайм-метр — $NON200 не-200 из $TOTAL замеров (каждые 2с)"
if [ "$NON200" -gt 5 ]; then
    echo "bluegreen: ❌ метр зафиксировал даунтайм >10с — считаю деплой проваленным (сайт уже на новом слоте, но процесс требует разбора)"
    exit 1
fi
echo "bluegreen: ✅ готово, даунтайма нет"
