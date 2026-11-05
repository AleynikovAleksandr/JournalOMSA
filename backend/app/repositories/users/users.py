"""Сотрудники."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import exists, func, or_, select

from app.models.journal import JournalRecord
from app.models.user import User
from app.repositories.base import SqlRepository


class UserRepository(SqlRepository):
    def get(self, user_id: int) -> User | None:
        return self._session.get(User, user_id)

    def get_by_uuid(self, user_uuid: UUID) -> User | None:
        """Единственное обращение к базе при проверке JWT — выборка по уникальному UUID."""
        return self._session.scalar(select(User).where(User.uuid == user_uuid))

    def get_by_login(self, login: str) -> User | None:
        return self._session.scalar(select(User).where(User.login == login))

    def login_taken(self, login: str, *, exclude_id: int | None = None) -> bool:
        stmt = select(exists().where(User.login == login))
        if exclude_id is not None:
            stmt = select(exists().where(User.login == login, User.id != exclude_id))
        return bool(self._session.scalar(stmt))

    def list(self, *, search: str | None = None, group_id: int | None = None, include_fired: bool = True) -> list[User]:
        stmt = select(User).order_by(User.fio, User.id)
        if search:
            needle = search.strip().lower()
            stmt = stmt.where(
                or_(
                    func.lower(User.fio).contains(needle, autoescape=True),
                    func.lower(User.login).contains(needle, autoescape=True),
                )
            )
        if group_id is not None:
            stmt = stmt.where(User.group_id == group_id)
        if not include_fired:
            stmt = stmt.where(User.is_fired.is_(False))
        return list(self._session.scalars(stmt).unique())

    def executors(self) -> list[User]:
        stmt = select(User).where(User.is_fired.is_(False)).order_by(User.fio)
        return list(self._session.scalars(stmt).unique())

    def is_referenced_in_journal(self, user_id: int) -> bool:
        return bool(self._session.scalar(select(exists().where(JournalRecord.executor_id == user_id))))

    def count_in_group(self, group_id: int) -> int:
        return int(self._session.scalar(select(func.count()).where(User.group_id == group_id)) or 0)

    def add(self, user: User) -> None:
        self._session.add(user)

    def delete(self, user: User) -> None:
        self._session.delete(user)
