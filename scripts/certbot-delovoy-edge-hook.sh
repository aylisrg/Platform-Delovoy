#!/bin/sh
# Certbot deploy-hook: host nginx is not the public TLS terminator.
set -eu

[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/delovoy-park.ru" ] || exit 0
CERT="$RENEWED_LINEAGE/fullchain.pem"
openssl x509 -in "$CERT" -noout -checkhost delovoy-park.ru
openssl x509 -in "$CERT" -noout -checkhost www.delovoy-park.ru
openssl x509 -in "$CERT" -noout -checkend 0

# A stopped/absent edge loads the certificate on its next start.
if [ "$(docker inspect --format '{{.State.Running}}' delovoy-edge 2>/dev/null || true)" != "true" ]; then
    echo "certbot-edge: edge not running; certificate will load on startup"
    exit 0
fi
docker exec delovoy-edge nginx -t
docker exec delovoy-edge nginx -s reload
echo "certbot-edge: renewed certificate loaded by public TLS edge"
