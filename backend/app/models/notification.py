"""Уведомления по задачам (ТЗ, раздел 2 и 6.2)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.journal import JournalRecord
from app.models.types import UTCDateTime
from database.session import db


class NotificationKind(StrEnum):
    """Вид события по таблице ТЗ, п. 2.2."""

    ASSIGNED = "assigned"  # 1. назначение задачи
    REMIND_24H = "remind_24h"  # 2. предварительное напоминание (сутки)
    REMIND_1H = "remind_1h"  # 3. предварительное напоминание (час)
    DUE = "due"  # 4. наступление времени задачи
    OVERDUE = "overdue"  # 5. напоминание о незавершённой задаче
    CHANGED = "changed"  # 6. изменение задачи


_KINDS = ", ".join(f"'{kind.value}'" for kind in NotificationKind)


class Notification(db.Model):
    __tablename__ = "TNotifications"
    __table_args__ = (
        # Одно и то же уведомление (задача + исполнитель + вид + момент показа) не повторяется
        UniqueConstraint("journal_id", "user_uuid", "kind", "fire_at"),
        Index("ix_TNotifications_pending", "user_uuid", "shown_at", "fire_at"),
        CheckConstraint(f"kind IN ({_KINDS})", name="kind"),
        {"comment": "Уведомления по задачам"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    journal_id: Mapped[int] = mapped_column(
        ForeignKey("TJournal.id", ondelete="CASCADE"), index=True
    )
    user_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("TUsers.uuid", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(20))
    fire_at: Mapped[datetime] = mapped_column(UTCDateTime)
    shown_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)

    record: Mapped[JournalRecord] = relationship(lazy="joined")


class NotificationSubscription(db.Model):
    """Клиенты, зарегистрированные на получение уведомлений (POST /api/notifications/subscribe)."""

    __tablename__ = "TNotificationSubscriptions"
    __table_args__ = (
        UniqueConstraint("user_uuid", "user_agent"),
        {"comment": "Браузеры, получающие уведомления"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("TUsers.uuid", ondelete="CASCADE")
    )
    permission: Mapped[str] = mapped_column(
        String(16)
    )
    user_agent: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)


class PushSubscription(db.Model):
    """Web Push endpoint конкретного браузера, привязанный к web-сессии."""

    __tablename__ = "TPushSubscriptions"
    __table_args__ = {"comment": "Подписки браузеров на Web Push"}

    id: Mapped[int] = mapped_column(primary_key=True)
    user_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("TUsers.uuid", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(128))
    auth: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)


class PushDelivery(db.Model):
    """Успешная отправка одного уведомления одному браузеру."""

    __tablename__ = "TPushDeliveries"
    __table_args__ = (
        UniqueConstraint("notification_id", "subscription_id"),
        {"comment": "Отправленные Web Push уведомления"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    notification_id: Mapped[int] = mapped_column(
        ForeignKey("TNotifications.id", ondelete="CASCADE"), index=True
    )
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("TPushSubscriptions.id", ondelete="CASCADE"), index=True
    )
    delivered_at: Mapped[datetime] = mapped_column(UTCDateTime)
