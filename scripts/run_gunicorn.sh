#!/usr/bin/env bash
# Запуск сервиса OMSA Ledger через Gunicorn.
#
#   APP_MODULE="app.main:create_portal_app('web')"   GUNICORN_BIND=0.0.0.0:5600 scripts/run_gunicorn.sh   # web
#   APP_MODULE="app.main:create_portal_app('admin')" GUNICORN_BIND=0.0.0.0:5620 scripts/run_gunicorn.sh   # admin
#
# В образе приложения скрипт лежит в /app/scripts, код backend — в /app;
# в репозитории — в scripts/, код — в backend/.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(dirname "${script_dir}")"

if [[ -d "${root_dir}/backend/gunicorn" ]]; then
  app_dir="${root_dir}/backend"
else
  app_dir="${root_dir}"
fi
cd "${app_dir}"

: "${APP_MODULE:=app.main:create_portal_app('web')}"
: "${GUNICORN_LOG_DIR:=${root_dir}/logs/gunicorn}"
export GUNICORN_LOG_DIR
mkdir -p "${GUNICORN_LOG_DIR}"

exec gunicorn -c gunicorn/gunicorn.conf.py "${APP_MODULE}"
