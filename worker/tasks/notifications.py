"""Задачи подсистемы уведомлений."""

from __future__ import annotations

import logging

from worker.celery_app import celery_app
from worker.runtime import WorkerRuntime, get_runtime

logger = logging.getLogger(__name__)


def generate_overdue(runtime: WorkerRuntime) -> int:
    """Досоздаёт повторные напоминания по просроченным незавершённым задачам.

    Вставка без перезаписи и ограничение уникальности TNotifications делают
    задачу идемпотентной: повторный запуск не создаёт дублей.
    """
    uow = runtime.unit_of_work()
    try:
        inserted = runtime.scheduler(uow).generate_overdue()
        uow.commit()
        return inserted
    except Exception:
        uow.rollback()
        raise
    finally:
        uow.close()


@celery_app.task(name="notifications.generate_overdue")
def generate_overdue_notifications() -> int:
    return generate_overdue(get_runtime())
