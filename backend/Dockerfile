# Образ приложения OMSA Ledger: Gunicorn + FastAPI + Flask.
# Из одного образа запускаются сервисы web (порт 5600) и admin (порт 5620).
#
# Сборка из корня проекта:
#   docker build -f backend/Dockerfile -t ${REGISTRY}/backend:${APP_VERSION} .
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Зависимости — из pyproject.toml (единый список для образов backend и worker)
COPY pyproject.toml /tmp/pyproject.toml
RUN python -c "import tomllib; deps = tomllib.load(open('/tmp/pyproject.toml', 'rb'))['project']['dependencies']; open('/tmp/requirements.txt', 'w').write('\n'.join(deps))" \
 && pip install -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt /tmp/pyproject.toml

RUN groupadd --system --gid 10001 omsa \
 && useradd --system --uid 10001 --gid omsa --home-dir /app --shell /usr/sbin/nologin omsa

COPY --chown=omsa:omsa backend/ /app/
COPY --chown=omsa:omsa --chmod=755 scripts/run_gunicorn.sh /app/scripts/run_gunicorn.sh
RUN mkdir -p /app/service_data/gunicorn /app/uploads \
 && chown -R omsa:omsa /app/service_data /app/uploads

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} \
    APP_MODULE="app.main:create_portal_app('web')" \
    GUNICORN_BIND=0.0.0.0:5600 \
    GUNICORN_LOG_DIR=/app/service_data/gunicorn

USER 10001
EXPOSE 5600 5620

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; port = os.environ['GUNICORN_BIND'].rsplit(':', 1)[1]; urllib.request.urlopen(f'http://localhost:{port}/health', timeout=3)"

CMD ["/app/scripts/run_gunicorn.sh"]
