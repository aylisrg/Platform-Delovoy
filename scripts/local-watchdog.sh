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
    TOKEN=$(env_var TELEGRAM_BOT_TOKEN)
    CHAT=$(env_var TELEGRAM_ADMIN_CHAT_ID)
    ROOT=$(env_var TELEGRAM_API_ROOT)
    [ -z "$ROOT" ] && ROOT="https://api.telegram.org"
    [ -z "$TOKEN" ] || [ -z "$CHAT" ] && { echo "$(ts) alert skipped: no telegram creds"; return 0; }
    # Кулдаун, чтобы затяжной инцидент не спамил каждые 2 минуты.
    if [ -f "$ALERT_MARKER" ] && [ -z "$(find "$ALERT_MARKER" -mmin +15 2>/dev/null)" ]; then
        return 0
    fi
    touch "$ALERT_MARKER"
    curl -s --max-time 10 -X POST "${ROOT}/bot${TOKEN}/sendMessage" \
        -d "chat_id=${CHAT}" \
        -d "parse_mode=HTML" \
        --data-urlencode "text=$1" \
        -o /dev/null || true
}

app_ok() {
    CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$APP_URL" 2>/dev/null || echo "000")
    [ "$CODE" = "200" ]
}

public_ok() {
    CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo "000")
    [ "$CODE" = "200" ]
}

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
