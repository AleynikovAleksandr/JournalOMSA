# Образ фоновых задач OMSA Ledger: Celery worker и Celery beat.
# Сервисы worker и beat используют один образ и отличаются командой запуска.
#
# Сборка из корня проекта:
#   docker build -f worker/Dockerfile -t ${REGISTRY}/worker:${APP_VERSION} .
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml /tmp/pyproject.toml
RUN python -c "import tomllib; deps = tomllib.load(open('/tmp/pyproject.toml', 'rb'))['project']['dependencies']; open('/tmp/requirements.txt', 'w').write('\n'.join(deps))" \
 && pip install -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt /tmp/pyproject.toml

RUN groupadd --system --gid 10001 omsa \
 && useradd --system --uid 10001 --gid omsa --home-dir /app --shell /usr/sbin/nologin omsa

# Задачи используют сервисы и модели приложения
COPY --chown=omsa:omsa backend/ /app/
COPY --chown=omsa:omsa worker/ /app/worker/
RUN rm -f /app/worker/Dockerfile \
 && mkdir -p /app/service_data/celery \
 && chown -R omsa:omsa /app/service_data

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

USER 10001

CMD ["celery", "-A", "worker.celery_app", "worker", "-Q", "notifications,maintenance", "--concurrency=2", "-n", "worker@%h", "--loglevel=info"]
