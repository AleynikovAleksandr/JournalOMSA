"""Базовый класс репозиториев."""

from __future__ import annotations

from sqlalchemy.orm import Session


class SqlRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    @property
    def dialect(self) -> str:
        return self._session.get_bind().dialect.name
