"""Записи журнала проверок."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Select, delete, func, select

from app.models.journal import CheckGroup, JournalRecord
from app.models.notification import Notification
from app.models.references import Solution
from app.repositories.base import SqlRepository
from app.schemas.commands import JournalFilter


class JournalRepository(SqlRepository):
    def _base(self) -> Select[tuple[JournalRecord]]:
        return (
            select(JournalRecord)
            .join(JournalRecord.group)
            .join(JournalRecord.solution)
            .order_by(CheckGroup.check_date, CheckGroup.check_time, JournalRecord.number, JournalRecord.id)
        )

    def list(self, flt: JournalFilter) -> list[JournalRecord]:
        stmt = self._base()
        if flt.fio:
            stmt = stmt.where(func.lower(JournalRecord.fio).contains(flt.fio.strip().lower(), autoescape=True))
        if flt.executor_id is not None:
            stmt = stmt.where(JournalRecord.executor_id == flt.executor_id)
        if flt.date_from is not None:
            stmt = stmt.where(CheckGroup.check_date >= flt.date_from)
        if flt.date_to is not None:
            stmt = stmt.where(CheckGroup.check_date <= flt.date_to)
        if flt.completed is not None:
            stmt = stmt.where(Solution.is_final.is_(flt.completed))
        return list(self._session.scalars(stmt).unique())

    def get(self, record_id: int) -> JournalRecord | None:
        return self._session.get(JournalRecord, record_id)

    def in_group(self, group_id: int) -> list[JournalRecord]:
        stmt = self._base().where(JournalRecord.group_id == group_id)
        return list(self._session.scalars(stmt).unique())

    def active_until(self, last_date: date) -> list[JournalRecord]:
        """Незавершённые задачи с датой проверки не позже указанной (для повторных напоминаний)."""
        stmt = self._base().where(Solution.is_final.is_(False), CheckGroup.check_date <= last_date)
        return list(self._session.scalars(stmt).unique())

    def next_number(self, group_id: int) -> int:
        current = self._session.scalar(select(func.max(JournalRecord.number)).where(JournalRecord.group_id == group_id))
        return int(current or 0) + 1

    def add(self, record: JournalRecord) -> None:
        self._session.add(record)

    def delete(self, record: JournalRecord) -> None:
        self._session.execute(delete(Notification).where(Notification.journal_id == record.id))
        self._session.delete(record)
