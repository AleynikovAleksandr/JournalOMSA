"""Служебные задачи."""

from __future__ import annotations

import logging

from worker.celery_app import celery_app
from worker.runtime import WorkerRuntime, get_runtime

logger = logging.getLogger(__name__)


def cleanup_refresh_tokens(runtime: WorkerRuntime) -> int:
    """Удаляет refresh-токены с истёкшим сроком действия."""
    uow = runtime.unit_of_work()
    try:
        removed = uow.refresh_tokens.delete_expired(runtime.clock.now())
        uow.commit()
    except Exception:
        uow.rollback()
        raise
    finally:
        uow.close()
    if removed:
        logger.info("Удалено просроченных refresh-токенов: %s", removed)
    return removed


@celery_app.task(name="maintenance.cleanup_refresh_tokens")
def cleanup_refresh_tokens_task() -> int:
    return cleanup_refresh_tokens(get_runtime())
