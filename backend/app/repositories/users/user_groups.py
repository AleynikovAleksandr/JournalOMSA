"""Группы сотрудников (роли)."""

from __future__ import annotations

from sqlalchemy import exists, func, select

from app.models.user import User, UserGroup
from app.repositories.base import SqlRepository


class UserGroupRepository(SqlRepository):
    def list(self) -> list[UserGroup]:
        return list(self._session.scalars(select(UserGroup).order_by(UserGroup.id)))

    def get(self, group_id: int) -> UserGroup | None:
        return self._session.get(UserGroup, group_id)

    def name_taken(self, name: str, *, exclude_id: int | None = None) -> bool:
        conditions = [func.lower(UserGroup.name) == name.lower()]
        if exclude_id is not None:
            conditions.append(UserGroup.id != exclude_id)
        return bool(self._session.scalar(select(exists().where(*conditions))))

    def member_counts(self) -> tuple[dict[int, int], int]:
        """Число работающих сотрудников по группам и число уволенных (для группы «Архив»)."""
        rows = self._session.execute(
            select(User.group_id, func.count()).where(User.is_fired.is_(False)).group_by(User.group_id)
        )
        active = {int(group_id): int(count) for group_id, count in rows}
        fired = int(self._session.scalar(select(func.count()).where(User.is_fired.is_(True))) or 0)
        return active, fired

    def add(self, group: UserGroup) -> None:
        self._session.add(group)

    def delete(self, group: UserGroup) -> None:
        self._session.delete(group)
