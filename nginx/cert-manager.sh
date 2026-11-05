#!/bin/sh
set -eu

: "${HTTPS_HOST:?HTTPS_HOST is required}"
: "${ACME_EMAIL:?ACME_EMAIL is required}"
if [ "${ACME_ENABLED:-false}" != true ]; then
    echo "ACME issuance disabled: external validation ports are unavailable."
    while :; do sleep 86400; done
fi

export LE_CONFIG_HOME=/acme.sh
ACME_HOME=/acmebin

stop_nginx() {
    /scripts/stop-nginx.sh
}

resume_nginx() {
    /scripts/resume-nginx.sh
}

trap resume_nginx EXIT INT TERM

acme.sh --set-default-ca --server letsencrypt --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"

while :; do
    stop_nginx
    if acme.sh --issue --alpn --server letsencrypt \
        --certificate-profile shortlived --days 3 --keylength ec-256 \
        --pre-hook /scripts/stop-nginx.sh \
        --domain "$HTTPS_HOST" --accountemail "$ACME_EMAIL" \
        --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"; then
        if acme.sh --install-cert --ecc --domain "$HTTPS_HOST" \
            --key-file /etc/nginx/certs/privkey.pem \
            --fullchain-file /etc/nginx/certs/fullchain.pem \
            --reloadcmd /scripts/resume-nginx.sh \
            --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME"; then
            break
        fi
    fi
    resume_nginx
    sleep 300
done

trap resume_nginx EXIT INT TERM
while :; do
    sleep 21600
    acme.sh --cron --home "$ACME_HOME" --config-home "$LE_CONFIG_HOME" || true
done
