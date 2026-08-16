#!/bin/sh
# Минутный локальный проб сайта (cron на VPS, регистрируется deploy.yml).
#
# Зачем при живом site-watchdog.yml: GitHub троттлит cron `*/5` до реальных
# 50–70 минут между запусками (наблюдение 2026-07-20) — дыра в обнаружении
# почти час. Локальный cron стабильно раз в минуту: 2 подряд провала →
# ступенчатая ремедиация (watchdog-remediate.sh, у него есть grace-период
# для свежего деплоя) + Telegram-алерт. GitHub-вотчдог остаётся внешним
# бэкапом (ловит смерть самого VPS, чего локальный проб не может).
#
# Тихий в здоровом состоянии: пишет в лог только аномалии.

# Blue-green: локальный порт приложения зависит от активного слота
# (scripts/deploy-bluegreen.sh пишет его в ACTIVE_SLOT; нет файла — слот a).
ACTIVE_SLOT=$(cat /opt/delovoy-park/ACTIVE_SLOT 2>/dev/null || echo a)
APP_PORT=3000
[ "$ACTIVE_SLOT" = "b" ] && APP_PORT=3001
APP_URL="http://127.0.0.1:${APP_PORT}/api/health"
PUBLIC_URL="${PUBLIC_URL:-https://delovoy-park.ru/}"
ENV_FILE="/opt/delovoy-park/.env"
REMEDIATE="/opt/delovoy-park/scripts/watchdog-remediate.sh"
FAIL_MARKER="/tmp/.local-watchdog-fails"
ALERT_MARKER="/tmp/.local-watchdog-alerted"
LOCK_DIR="/tmp/.local-watchdog-lock"
ALERT_COOLDOWN=900  # сек; не чаще одного алерта в 15 минут
FAIL_THRESHOLD=2    # подряд неудачных минут до ремедиации

# 5xx-алерт (issue #577): независимый канал от site-down выше — сайт может
# отвечать 200 на /api/health и всё равно сыпать 5xx на конкретном роуте.
PERF_LOG="/var/log/delovoy-park/nginx-perf.log"
PERF_OFFSET_FILE="/tmp/.local-watchdog-perf-offset"
FIVEXX_ALERT_MARKER="/tmp/.local-watchdog-5xx-alerted"
FIVEXX_THRESHOLD=10  # 5xx за минуту до алерта

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"

ts() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

# Не допускаем параллельных запусков (ремедиация может идти минуты).
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Протухший лок (>15 мин) снимаем — прошлый запуск умер.
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
        mkdir "$LOCK_DIR" 2>/dev/null || exit 0
    else
        exit 0
    fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

env_var() {
    grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

telegram_alert() {
    # $2 — маркер кулдауна; свой на каждый независимый класс алертов (иначе
    # 5xx-всплеск и site-down делили бы один кулдаун и подавляли друг друга).
    MARKER="${2:-$ALERT_MARKER}"
    TOKEN=$(env_var TELEGRAM_BOT_TOKEN)
    CHAT=$(env_var TELEGRAM_ADMIN_CHAT_ID)
    ROOT=$(env_var TELEGRAM_API_ROOT)
    [ -z "$ROOT" ] && ROOT="https://api.telegram.org"
    [ -z "$TOKEN" ] || [ -z "$CHAT" ] && { echo "$(ts) alert skipped: no telegram creds"; return 0; }
    # Кулдаун, чтобы затяжной инцидент не спамил каждые 2 минуты.
    if [ -f "$MARKER" ] && [ -z "$(find "$MARKER" -mmin +15 2>/dev/null)" ]; then
        return 0
    fi
    touch "$MARKER"
    curl -s --max-time 10 -X POST "${ROOT}/bot${TOKEN}/sendMessage" \
        -d "chat_id=${CHAT}" \
        -d "parse_mode=HTML" \
        --data-urlencode "text=$1" \
        -o /dev/null || true
}

# Инкрементальное чтение perf-лога (issue #577): офсет с прошлого запуска,
# читаем только новые байты — без этого пришлось бы либо парсить весь файл
# каждую минуту (растущая стоимость), либо гадать по времени. Ротация/рестарт
# nginx уменьшает размер файла — офсет больше текущего размера сбрасывается.
check_5xx_spike() {
    # $SUDO обязателен: logrotate ставит ротированным файлам 0640 www-data:adm
    # (infra/nginx/delovoy-nginx-perf.logrotate), а cron-пользователь deploy
    # состоит только в группе docker (scripts/setup-vps.sh) — без sudo чтение
    # молча вернёт пусто (COUNT=0) и алерт никогда не сработает.
    [ -f "$PERF_LOG" ] || return 0
    CUR_SIZE=$($SUDO stat -c%s "$PERF_LOG" 2>/dev/null || echo 0)
    LAST_OFFSET=$(cat "$PERF_OFFSET_FILE" 2>/dev/null || echo 0)
    case "$LAST_OFFSET" in ''|*[!0-9]*) LAST_OFFSET=0 ;; esac
    if [ "$LAST_OFFSET" -gt "$CUR_SIZE" ]; then
        LAST_OFFSET=0
    fi
    echo "$CUR_SIZE" > "$PERF_OFFSET_FILE"
    [ "$CUR_SIZE" -eq "$LAST_OFFSET" ] && return 0

    COUNT=$($SUDO tail -c "+$((LAST_OFFSET + 1))" "$PERF_LOG" 2>/dev/null | grep -c '"status":5[0-9][0-9]' || true)
    [ -z "$COUNT" ] && COUNT=0
    [ "$COUNT" -ge "$FIVEXX_THRESHOLD" ] || return 0

    echo "$(ts) 5xx spike: $COUNT за последнюю минуту"
    telegram_alert "⚠️ <b>Local watchdog: всплеск 5xx</b>
${COUNT} ответов 5xx за последнюю минуту (порог ${FIVEXX_THRESHOLD})." "$FIVEXX_ALERT_MARKER"
}

app_ok() {
    CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$APP_URL" 2>/dev/null || echo "000")
    [ "$CODE" = "200" ]
}

public_ok() {
    CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo "000")
    [ "$CODE" = "200" ]
}

check_5xx_spike

if app_ok && public_ok; then
    rm -f "$FAIL_MARKER"
    exit 0
fi

FAILS=$(cat "$FAIL_MARKER" 2>/dev/null || echo 0)
FAILS=$((FAILS + 1))
echo "$FAILS" > "$FAIL_MARKER"
echo "$(ts) probe FAILED (consecutive: $FAILS)"

if [ "$FAILS" -lt "$FAIL_THRESHOLD" ]; then
    exit 0
fi

echo "$(ts) threshold reached — running remediation"
telegram_alert "🚨 <b>Local watchdog: сайт не отвечает ${FAILS} мин подряд</b>
Запускаю ступенчатую ремедиацию на VPS (nginx → restart app → compose up)."

if [ -x "$REMEDIATE" ]; then
    "$REMEDIATE" || true
else
    echo "$(ts) remediate script missing: $REMEDIATE"
fi

rm -f "$FAIL_MARKER"

sleep 5
if public_ok; then
    echo "$(ts) recovered"
    telegram_alert "✅ <b>Local watchdog: сайт восстановлен</b>"
else
    echo "$(ts) still down after remediation"
    telegram_alert "❌ <b>Local watchdog: ремедиация НЕ помогла — нужно ручное вмешательство</b>"
fi
