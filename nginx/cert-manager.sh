#!/bin/sh
set -eu

pause_nginx() {
    touch /run/acme/nginx-paused
    pid_file=/var/run/nginx.pid
    if [ -s "$pid_file" ]; then
        pid="$(cat "$pid_file")"
        kill -QUIT "$pid" 2>/dev/null || true
        attempts=0
        while [ -s "$pid_file" ] && [ "$attempts" -lt 30 ]; do
            sleep 1
            attempts=$((attempts + 1))
        done
    fi
}

resume_nginx() {
    rm -f /run/acme/nginx-paused
}

case "${1:-}" in
    pause) pause_nginx; exit 0 ;;
    resume) resume_nginx; exit 0 ;;
esac

: "${HTTPS_HOST:?HTTPS_HOST is required}"
: "${ACME_EMAIL:?ACME_EMAIL is required}"
if [ "${ACME_ENABLED:-false}" != true ]; then
    echo "ACME issuance disabled: external validation ports are unavailable."
    while :; do sleep 86400; done
fi

export LE_CONFIG_HOME=/acme.sh
ACME_HOME=/acmebin

trap resume_nginx EXIT INT TERM

acme.sh --set-default-ca --server letsencrypt --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"

while :; do
    pause_nginx
    if acme.sh --issue --alpn --server letsencrypt \
        --certificate-profile shortlived --days 3 --keylength ec-256 \
        --pre-hook '/scripts/cert-manager.sh pause' \
        --domain "$HTTPS_HOST" --accountemail "$ACME_EMAIL" \
        --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"; then
        if acme.sh --install-cert --ecc --domain "$HTTPS_HOST" \
            --key-file /etc/nginx/certs/privkey.pem \
            --fullchain-file /etc/nginx/certs/fullchain.pem \
            --reloadcmd '/scripts/cert-manager.sh resume' \
            --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"; then
            resume_nginx
            break
        fi
    fi
    resume_nginx
    sleep 300
done

while :; do
    sleep 21600
    acme.sh --cron --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME" || true
    resume_nginx
done
