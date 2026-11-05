"""Конфигурация Gunicorn (документ «Gunicorn: параметры для 100 одновременных пользователей»).

Запуск:
    GUNICORN_BIND=0.0.0.0:5600 gunicorn -c gunicorn/gunicorn.conf.py "app.main:create_portal_app('web')"
    GUNICORN_BIND=0.0.0.0:5620 gunicorn -c gunicorn/gunicorn.conf.py "app.main:create_portal_app('admin')"
"""

import os

# Порт сервиса: 5600 — web, 5620 — admin (документ «Страницы Flask и порты», раздел 4)
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:5600")

# Асинхронный воркер для FastAPI и WebSocket (uvicorn.workers.UvicornWorker устарел)
worker_class = "uvicorn_worker.UvicornWorker"
# Число воркеров задаётся явно: cpu_count() в контейнере возвращает ядра узла, а не лимит пода
workers = int(os.getenv("WEB_CONCURRENCY", "3"))

timeout = 30
graceful_timeout = 30
# Больше времени простоя соединений на стороне Nginx (60 с), иначе возможны ошибки 502
keepalive = 75

# Перезапуск воркера после 1000 запросов защищает от утечек памяти
max_requests = 1000
max_requests_jitter = 100

backlog = 2048
# Служебные файлы воркеров в памяти, а не на диске контейнера
worker_tmp_dir = os.getenv("GUNICORN_WORKER_TMP_DIR", "/dev/shm")
# Пулы соединений с БД и Redis не разделяются между процессами
preload_app = False

# CIDR сети подов; доступ к приложению в обход Nginx закрыт NetworkPolicy.
# Значение «*» недопустимо: клиент смог бы подставить чужой адрес в X-Forwarded-For.
forwarded_allow_ips = os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1")

log_dir = os.getenv("GUNICORN_LOG_DIR", "logs/gunicorn")
os.makedirs(log_dir, exist_ok=True)
accesslog = f"{log_dir}/access.log"
errorlog = f"{log_dir}/error.log"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
