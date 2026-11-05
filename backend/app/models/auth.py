"""Refresh-токены (ТЗ, 4.1 и 6.2)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.types import UTCDateTime
from database.session import db


class RefreshToken(db.Model):
    __tablename__ = "TRefreshTokens"
    __table_args__ = {"comment": "Refresh-токены (сессии пользователей)"}

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("TUsers.uuid", ondelete="CASCADE"), index=True
    )
    portal: Mapped[str] = mapped_column(String(10))
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(45))
