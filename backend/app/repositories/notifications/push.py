"""Подписки браузеров и доставка Web Push."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, exists, select

from app.models.auth import RefreshToken
from app.models.journal import JournalRecord
from app.models.notification import Notification, PushDelivery, PushSubscription
from app.models.references import Solution
from app.models.user import User
from app.repositories.base import SqlRepository


class PushRepository(SqlRepository):
    def find_endpoint(self, endpoint: str) -> PushSubscription | None:
        return self._session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))

    def add(self, subscription: PushSubscription) -> None:
        self._session.add(subscription)

    def delete_session(self, session_id: UUID) -> None:
        self._session.execute(delete(PushSubscription).where(PushSubscription.session_id == session_id))

    def delete_for_user(self, user_uuid: UUID) -> None:
        self._session.execute(delete(PushSubscription).where(PushSubscription.user_uuid == user_uuid))

    def delete(self, subscription: PushSubscription) -> None:
        self._session.delete(subscription)

    def due(self, now: datetime, *, limit: int = 100) -> list[tuple[Notification, PushSubscription]]:
        """Только ожидающие уведомления текущему исполнителю с действующей web-сессией."""
        active_session = exists(
            select(RefreshToken.id).where(
                RefreshToken.session_id == PushSubscription.session_id,
                RefreshToken.user_uuid == PushSubscription.user_uuid,
                RefreshToken.portal == "web",
                RefreshToken.expires_at > now,
            )
        )
        delivered = exists(
            select(PushDelivery.id).where(
                PushDelivery.notification_id == Notification.id,
                PushDelivery.subscription_id == PushSubscription.id,
            )
        )
        stmt = (
            select(Notification, PushSubscription)
            .join(JournalRecord, Notification.journal_id == JournalRecord.id)
            .join(User, JournalRecord.executor_id == User.id)
            .join(Solution, JournalRecord.solution_id == Solution.id)
            .join(PushSubscription, PushSubscription.user_uuid == Notification.user_uuid)
            .where(
                Notification.user_uuid == User.uuid,
                Notification.shown_at.is_(None),
                Notification.fire_at <= now,
                Solution.is_final.is_(False),
                active_session,
                ~delivered,
            )
            .order_by(Notification.fire_at, Notification.id, PushSubscription.id)
            .limit(limit)
        )
        return list(self._session.execute(stmt).unique())

    def mark_delivered(self, notification: Notification, subscription: PushSubscription, now: datetime) -> None:
        self._session.add(
            PushDelivery(notification_id=notification.id, subscription_id=subscription.id, delivered_at=now)
        )
