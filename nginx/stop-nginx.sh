#!/bin/sh
set -eu

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
