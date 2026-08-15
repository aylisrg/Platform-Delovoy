#!/bin/sh
# Применяет канонический vhost из репозитория (infra/nginx/delovoy-park.conf)
# к живому nginx. Дисциплина как у apply-nginx-static-archive.sh: бэкап,
# nginx -t, автооткат при провале. Запускать через workflow ops-nginx.yml
# (там обязательный diff-гейт перед apply).
#
# Ожидает рядом (кладёт scp из workflow/deploy):
#   /opt/delovoy-park/infra/nginx/delovoy-park.conf
#   /opt/delovoy-park/infra/nginx/delovoy-upstream.conf
#   /opt/delovoy-park/infra/nginx/delovoy-nginx-perf.logrotate
set -eu

SRC="${VHOST_SRC:-/opt/delovoy-park/infra/nginx/delovoy-park.conf}"
UPSTREAM_SRC="${UPSTREAM_SRC:-/opt/delovoy-park/infra/nginx/delovoy-upstream.conf}"
LOGROTATE_SRC="${LOGROTATE_SRC:-/opt/delovoy-park/infra/nginx/delovoy-nginx-perf.logrotate}"
CONF="${NGINX_CONF:-/etc/nginx/sites-available/delovoy-park}"
UPSTREAM_CONF="/etc/nginx/conf.d/delovoy-upstream.conf"
LOGROTATE_CONF="/etc/logrotate.d/delovoy-nginx-perf"
PERF_LOG_DIR="/var/log/delovoy-park"
CERT_DIR="/etc/letsencrypt/live/delovoy-park.ru"

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"

fail() { echo "apply-nginx-vhost: $1" >&2; exit 1; }

[ -f "$SRC" ] || fail "нет исходника $SRC"
[ -f "$UPSTREAM_SRC" ] || fail "нет исходника $UPSTREAM_SRC"
[ -f "$LOGROTATE_SRC" ] || fail "нет исходника $LOGROTATE_SRC"

# Vhost ссылается на certbot-файлы — без них nginx -t упадёт, а сайт
# останется на бэкапе. Проверяем заранее с внятной ошибкой.
for F in "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem" \
         /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem; do
    $SUDO test -f "$F" || fail "нет $F — сначала certbot --nginx -d delovoy-park.ru -d www.delovoy-park.ru"
done

# Upstream: существующий файл НЕ трогаем — в нём может жить активный
# blue-green слот (3001). Ставим образец только при первом применении.
if [ ! -f "$UPSTREAM_CONF" ]; then
    $SUDO cp "$UPSTREAM_SRC" "$UPSTREAM_CONF"
    echo "apply-nginx-vhost: установлен $UPSTREAM_CONF (порт 3000)"
else
    echo "apply-nginx-vhost: $UPSTREAM_CONF уже существует — не трогаю (blue-green)"
fi

BACKUP=""
if [ -f "$CONF" ]; then
    BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
    $SUDO cp "$CONF" "$BACKUP"
    echo "apply-nginx-vhost: бэкап → $BACKUP"
fi

# Каталог perf-лога (issue #577): access_log в vhost'е ссылается на файл
# внутри него, и nginx не создаёт отсутствующую директорию сам — без этого
# шага reload ниже упал бы с "Permission denied"/"No such file or directory"
# при первом применении.
$SUDO mkdir -p "$PERF_LOG_DIR"
$SUDO chown www-data:adm "$PERF_LOG_DIR"

$SUDO cp "$LOGROTATE_SRC" "$LOGROTATE_CONF"

$SUDO cp "$SRC" "$CONF"
$SUDO ln -sf "$CONF" /etc/nginx/sites-enabled/delovoy-park

if $SUDO nginx -t; then
    $SUDO systemctl reload nginx
    echo "apply-nginx-vhost: применён и перезагружен"
else
    echo "apply-nginx-vhost: nginx -t ПРОВАЛЕН — откат" >&2
    if [ -n "$BACKUP" ]; then
        $SUDO cp "$BACKUP" "$CONF"
        $SUDO nginx -t && $SUDO systemctl reload nginx || true
    fi
    exit 1
fi
