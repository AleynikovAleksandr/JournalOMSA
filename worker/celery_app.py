"""Приложение Celery: брокер — Redis, планировщик — единственный процесс celery beat.

Запуск планировщика внутри Gunicorn недопустим: каждый воркер создал бы
свою копию, и уведомления дублировались бы (документ «Redis в OMSA Ledger»).

    celery -A worker.celery_app worker -Q notifications,maintenance -n worker@%h
    celery -A worker.celery_app beat
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from core.config import get_settings

QUEUE_NOTIFICATIONS = "notifications"
QUEUE_MAINTENANCE = "maintenance"

settings = get_settings()

celery_app = Celery(
    "omsa_ledger",
    broker=settings.celery_broker_url,
    include=["worker.tasks.notifications", "worker.tasks.push", "worker.tasks.maintenance"],
)
celery_app.conf.update(
    timezone="UTC",
    enable_utc=True,
    task_default_queue=QUEUE_NOTIFICATIONS,
    task_routes={
        "notifications.*": {"queue": QUEUE_NOTIFICATIONS},
        "maintenance.*": {"queue": QUEUE_MAINTENANCE},
    },
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=120,
    task_soft_time_limit=90,
    worker_prefetch_multiplier=1,
    worker_hijack_root_logger=False,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        # Событие 5 ТЗ: повторные напоминания о незавершённых задачах — раз в минуту
        "generate-overdue-notifications": {
            "task": "notifications.generate_overdue",
            "schedule": 60.0,
            "options": {"expires": 55},
        },
        "send-due-web-push": {
            "task": "notifications.send_due_push",
            "schedule": 60.0,
            "options": {"expires": 55},
        },
        "cleanup-refresh-tokens": {
            "task": "maintenance.cleanup_refresh_tokens",
            "schedule": crontab(hour=3, minute=15),
        },
    },
)

celery = celery_app
