"""Проверочные группы (блоки)."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select

from app.models.journal import CheckGroup, JournalRecord
from app.repositories.base import SqlRepository


class CheckGroupRepository(SqlRepository):
    def list(self, *, date_from: date | None = None, date_to: date | None = None) -> list[tuple[CheckGroup, int]]:
        counts = (
            select(JournalRecord.group_id.label("group_id"), func.count(JournalRecord.id).label("records"))
            .group_by(JournalRecord.group_id)
            .subquery()
        )
        stmt = (
            select(CheckGroup, func.coalesce(counts.c.records, 0))
            .outerjoin(counts, counts.c.group_id == CheckGroup.id)
            .order_by(CheckGroup.check_date, CheckGroup.check_time, CheckGroup.id)
        )
        if date_from is not None:
            stmt = stmt.where(CheckGroup.check_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(CheckGroup.check_date <= date_to)
        return [(group, int(count)) for group, count in self._session.execute(stmt).unique()]

    def get(self, group_id: int) -> CheckGroup | None:
        return self._session.get(CheckGroup, group_id)

    def find(self, check_date: date, check_time: str, type_check_id: int) -> CheckGroup | None:
        stmt = (
            select(CheckGroup)
            .where(
                CheckGroup.check_date == check_date,
                CheckGroup.check_time == check_time,
                CheckGroup.type_check_id == type_check_id,
            )
            .order_by(CheckGroup.id)
            .limit(1)
        )
        return self._session.scalar(stmt)

    def add(self, group: CheckGroup) -> None:
        self._session.add(group)

    def delete(self, group: CheckGroup) -> None:
        self._session.delete(group)
