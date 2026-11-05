#!/usr/bin/env bash
# Точка входа для запуска и остановки OMSA Ledger в Kubernetes.
#
#   scripts/deploy_k8s.sh start   [окружение]                  запустить или обновить всё
#   scripts/deploy_k8s.sh stop    [окружение]                  остановить всё (данные сохраняются)
#   scripts/deploy_k8s.sh restart [окружение]                  перезапустить все сервисы
#   scripts/deploy_k8s.sh status  [окружение]                  состояние подов, сервисов и томов
#   scripts/deploy_k8s.sh render  [окружение]                  только вывести манифесты
#
# Окружение — каталог deploy_k8s/overlays/<окружение>, по умолчанию prod.
#
# start   применяет манифесты, дожидается PostgreSQL и Redis, перезапускает приложение,
#         Celery и Nginx при обновлении и ждёт готовности всех сервисов.
#         После stop поды создаются заново, перезапуск не нужен.
# stop    уменьшает число подов всех сервисов до нуля: сначала Nginx (новые запросы не
#         принимаются), затем приложение и Celery, последними Redis и PostgreSQL.
#         Тома с данными, Secret и внешний адрес балансировщика остаются; start поднимает всё обратно.
# start и restart перезапускают Nginx вместе с приложением; у Nginx один под,
# поэтому сайт будет недоступен несколько секунд.
#
# ConfigMap PostgreSQL и Nginx подключают файлы backend/database/schema.sql и
# nginx/nginx.conf.template из общего каталога проекта, поэтому kustomize запускается
# с --load-restrictor LoadRestrictionsNone.
set -euo pipefail

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

command_name="start"
overlay="prod"
positional=()
for arg in "$@"; do
  case "${arg}" in
    --with-nginx) ;; # legacy no-op: Nginx теперь всегда входит в start/restart
    --dry-run) command_name="render" ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Неизвестный параметр: ${arg}" >&2; usage >&2; exit 2 ;;
    *) positional+=("${arg}") ;;
  esac
done
for arg in "${positional[@]+"${positional[@]}"}"; do
  case "${arg}" in
    start|stop|restart|status|render) command_name="${arg}" ;;
    *) overlay="${arg}" ;;
  esac
done

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
overlay_dir="${root_dir}/deploy_k8s/overlays/${overlay}"
namespace="$(sed -n 's/^namespace: *//p' "${root_dir}/deploy_k8s/base/kustomization.yaml")"
rollout_timeout="${ROLLOUT_TIMEOUT:-300s}"
part_of="app.kubernetes.io/part-of=omsa-ledger"

# Порядок остановки; запуск — в обратном порядке
stop_order=(nginx web admin beat worker redis postgres)
# Поды, читающие omsa-ledger-config и omsa-ledger-secrets: Gunicorn и Celery
app_deployments=(web admin worker beat)

if [[ ! -d "${overlay_dir}" ]]; then
  echo "Окружение не найдено: ${overlay_dir}" >&2
  exit 1
fi

k() {
  kubectl -n "${namespace}" "$@"
}

build_manifests() {
  if command -v kustomize >/dev/null 2>&1; then
    kustomize build --load-restrictor LoadRestrictionsNone "${overlay_dir}"
  else
    kubectl kustomize --load-restrictor LoadRestrictionsNone "${overlay_dir}"
  fi
}

remove_legacy_caddy() {
  # One-time migration: remove the old public endpoint before creating Nginx.
  # The old caddy-data PVC is kept so its ACME state remains recoverable.
  k delete deployment/caddy service/caddy \
    networkpolicy/web-from-caddy-only networkpolicy/admin-from-caddy-only \
    --ignore-not-found
  local resource
  while IFS= read -r resource; do
    if [[ "${resource}" == configmap/caddy-config* ]]; then
      k delete "${resource}" --ignore-not-found
    fi
  done < <(k get configmaps -o name)
}

check_secret_files() {
  # Файлы с паролями в репозиторий не входят: их состав описан в README (раздел «Секреты»)
  local secret_file
  for secret_file in "${overlay_dir}/secret.yaml" "${root_dir}/deploy_k8s/base/redis/users.acl"; do
    if [[ ! -f "${secret_file}" ]]; then
      echo "Нет файла ${secret_file}: создайте его по README (раздел «Секреты»)" >&2
      exit 1
    fi
  done
  if grep -q "CHANGE_ME" "${overlay_dir}/secret.yaml"; then
    echo "Внимание: в ${overlay_dir}/secret.yaml остались значения CHANGE_ME" >&2
  fi
}

wait_ready() {
  local name
  for name in "$@"; do
    k rollout status "deployment/${name}" --timeout="${rollout_timeout}"
  done
}

restart_pods() {
  local targets=("${app_deployments[@]}" nginx)
  echo "Перезапуск: ${targets[*]}"
  k rollout restart "${targets[@]/#/deployment/}"
  wait_ready "${targets[@]}"
}

# Работало ли приложение до запуска: после stop или при первой установке перезапуск не нужен
app_was_running() {
  local replicas
  replicas="$(k get deployment/web -o 'jsonpath={.spec.replicas}' 2>/dev/null || true)"
  [[ -n "${replicas}" && "${replicas}" != "0" ]]
}

cmd_start() {
  check_secret_files
  local was_running=false
  if app_was_running; then
    was_running=true
  fi
  remove_legacy_caddy
  echo "Применение манифестов (${overlay})"
  build_manifests | kubectl apply -f -
  echo "Ожидание PostgreSQL и Redis"
  wait_ready postgres redis
  if [[ "${was_running}" == true ]]; then
    restart_pods
  fi
  echo "Ожидание готовности сервисов"
  wait_ready web admin worker beat nginx
  echo "OMSA Ledger запущен"
  k get service nginx
}

cmd_stop() {
  local name
  for name in "${stop_order[@]}"; do
    echo "Остановка: ${name}"
    k scale "deployment/${name}" --replicas=0
  done
  if [[ -n "$(k get pods -l "${part_of}" -o name)" ]]; then
    k wait --for=delete pod -l "${part_of}" --timeout="${rollout_timeout}"
  fi
  echo "OMSA Ledger остановлен: данные PostgreSQL и Redis, сертификаты ACME и Secret сохранены"
}

cmd_restart() {
  restart_pods
}

cmd_status() {
  k get deployments,pods,services,persistentvolumeclaims -l "${part_of}"
}

case "${command_name}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  render) check_secret_files; build_manifests ;;
esac
