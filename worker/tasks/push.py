"""Отправка ожидающих системных уведомлений через pywebpush."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable

from sqlalchemy import text

from app.schemas.responses import NotificationOut
from app.schemas.settings import Portal
from worker.celery_app import celery_app
from worker.runtime import WorkerRuntime, get_runtime

logger = logging.getLogger(__name__)
PUSH_LOCK_ID = 7_310_002


def send_due_push(runtime: WorkerRuntime, *, sender: Callable | None = None) -> int:
    """Отправить ожидающие события браузерам; показ подтверждает переход пользователя."""
    settings = runtime.settings
    if not settings.web_push_private_key or not settings.web_push_public_key:
        return 0
    if sender is None:
        from pywebpush import webpush

        sender = webpush
    subject = settings.web_push_subject or settings.origins_for(Portal.WEB)[0]
    uow = runtime.unit_of_work()
    sent = 0
    try:
        # Beat один, но повторная задача из очереди не должна отправить тот же push параллельно.
        if runtime.database.dialect == "postgresql":
            locked = uow.session.scalar(text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": PUSH_LOCK_ID})
            if not locked:
                return 0
        now = runtime.clock.now()
        # Celery soft limit = 90 с: ограничиваем число запросов и время каждого.
        for notification, subscription in uow.push.due(now, limit=20):
            payload = NotificationOut.of(notification).model_dump(mode="json")
            try:
                sender(
                    subscription_info={
                        "endpoint": subscription.endpoint,
                        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                    },
                    data=json.dumps(payload, ensure_ascii=False),
                    vapid_private_key=settings.web_push_private_key,
                    vapid_claims={"sub": subject},
                    ttl=3600,
                    timeout=4,
                )
            except Exception as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    uow.push.delete(subscription)
                else:
                    logger.warning("Web Push не принят для уведомления %s: HTTP %s", notification.id, status)
            else:
                uow.push.mark_delivered(notification, subscription, now)
                sent += 1
        uow.commit()
        return sent
    except Exception:
        uow.rollback()
        raise
    finally:
        uow.close()


@celery_app.task(name="notifications.send_due_push")
def send_due_push_task() -> int:
    return send_due_push(get_runtime())
