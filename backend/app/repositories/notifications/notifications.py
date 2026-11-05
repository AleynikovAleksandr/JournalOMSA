"""Уведомления по задачам."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects import postgresql

from app.models.journal import JournalRecord
from app.models.notification import Notification, NotificationKind
from app.models.references import Solution
from app.models.user import User
from app.repositories.base import SqlRepository

# Конструкторы INSERT ... ON CONFLICT DO NOTHING по имени диалекта SQLAlchemy
_INSERT_DIALECTS: dict[str, Callable[..., Any]] = {"postgresql": postgresql.insert}


def register_insert_dialect(name: str, insert: Callable[..., Any]) -> None:
    _INSERT_DIALECTS[name] = insert


@dataclass(frozen=True, slots=True)
class PlannedNotification:
    journal_id: int
    user_uuid: UUID
    kind: NotificationKind
    fire_at: datetime


class NotificationRepository(SqlRepository):
    def insert_ignore(self, planned: Sequence[PlannedNotification], *, created_at: datetime) -> int:
        """Вставка без перезаписи: уже существующее уведомление (ограничение
        уникальности) пропускается, поэтому повторный запуск не создаёт дублей."""
        if not planned:
            return 0
        rows = [
            {
                "journal_id": item.journal_id,
                "user_uuid": item.user_uuid,
                "kind": item.kind.value,
                "fire_at": item.fire_at,
                "created_at": created_at,
            }
            for item in planned
        ]
        dialect_insert = _INSERT_DIALECTS.get(self.dialect)
        if dialect_insert is None:
            raise RuntimeError(f"СУБД {self.dialect} не поддерживает вставку без перезаписи")
        stmt = (
            dialect_insert(Notification)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["journal_id", "user_uuid", "kind", "fire_at"])
        )
        result = self._session.execute(stmt)
        return int(result.rowcount or 0)

    def pending(self, user_uuid: UUID, now: datetime) -> list[Notification]:
        """Подлежащие показу уведомления: наступил момент показа, показ не подтверждён,
        задача не завершена и пользователь по-прежнему её исполнитель."""
        stmt = (
            select(Notification)
            .join(JournalRecord, Notification.journal_id == JournalRecord.id)
            .join(User, JournalRecord.executor_id == User.id)
            .join(Solution, JournalRecord.solution_id == Solution.id)
            .where(
                Notification.user_uuid == user_uuid,
                User.uuid == user_uuid,
                Notification.shown_at.is_(None),
                Notification.fire_at <= now,
                Solution.is_final.is_(False),
            )
            .order_by(Notification.fire_at, Notification.id)
        )
        return list(self._session.scalars(stmt).unique())

    def history(self, user_uuid: UUID, *, limit: int = 200) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_uuid == user_uuid)
            .order_by(Notification.fire_at.desc(), Notification.id.desc())
            .limit(limit)
        )
        return list(self._session.scalars(stmt).unique())

    def get(self, notification_id: int) -> Notification | None:
        return self._session.get(Notification, notification_id)

    def delete_unshown(
        self,
        journal_id: int,
        *,
        user_uuid: UUID | None = None,
        kinds: Iterable[NotificationKind] | None = None,
    ) -> int:
        stmt = delete(Notification).where(Notification.journal_id == journal_id, Notification.shown_at.is_(None))
        if user_uuid is not None:
            stmt = stmt.where(Notification.user_uuid == user_uuid)
        if kinds is not None:
            stmt = stmt.where(Notification.kind.in_([kind.value for kind in kinds]))
        result = self._session.execute(stmt)
        return int(result.rowcount or 0)

    def for_record(self, journal_id: int) -> list[Notification]:
        stmt = select(Notification).where(Notification.journal_id == journal_id).order_by(Notification.fire_at)
        return list(self._session.scalars(stmt).unique())
