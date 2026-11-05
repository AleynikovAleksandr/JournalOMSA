"""Подписки на системные уведомления браузера."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models.notification import NotificationSubscription
from app.repositories.base import SqlRepository


class SubscriptionRepository(SqlRepository):
    def find(self, user_uuid: UUID, user_agent: str) -> NotificationSubscription | None:
        stmt = select(NotificationSubscription).where(
            NotificationSubscription.user_uuid == user_uuid, NotificationSubscription.user_agent == user_agent
        )
        return self._session.scalar(stmt)

    def add(self, subscription: NotificationSubscription) -> None:
        self._session.add(subscription)
