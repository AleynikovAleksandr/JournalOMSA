#!/bin/sh
set -eu

nginx_child=""
shutdown() {
    if [ -n "$nginx_child" ]; then
        kill -TERM "$nginx_child" 2>/dev/null || true
        wait "$nginx_child" 2>/dev/null || true
    fi
    exit 0
}
trap shutdown TERM INT

while :; do
    while [ -e /run/acme/nginx-paused ]; do sleep 1; done
    /docker-entrypoint.sh nginx -g 'daemon off;' &
    nginx_child=$!
    wait "$nginx_child" || true
    nginx_child=""
    while [ -e /run/acme/nginx-paused ]; do sleep 1; done
    sleep 1
done
