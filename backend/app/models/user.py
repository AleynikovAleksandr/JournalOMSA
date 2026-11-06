"""Сотрудники и группы (роли) пользователей (ТЗ, 6.2)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.types import UTCDateTime
from database.session import db


class UserGroup(db.Model):
    __tablename__ = "TUserGroups"
    __table_args__ = {"comment": "Группы (роли) пользователей"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
    rules: Mapped[str | None] = mapped_column(String(150), nullable=True)
    is_archive: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=false(),
    )


class User(db.Model):
    __tablename__ = "TUsers"
    __table_args__ = {"comment": "Сотрудники (исполнители)"}

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid, unique=True, default=uuid.uuid4
    )
    fio: Mapped[str] = mapped_column("FIO", String(150))
    profile: Mapped[str | None] = mapped_column(String(150))
    rules: Mapped[str] = mapped_column(String(150), default="", server_default="")
    is_fired: Mapped[bool] = mapped_column(
        "isFired", Boolean, default=False, server_default=false()
    )
    login: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    password_changed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("TUserGroups.id", ondelete="RESTRICT"), index=True
    )

    group: Mapped[UserGroup] = relationship(lazy="joined")
