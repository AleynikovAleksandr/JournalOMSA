"""Refresh-токены."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select

from app.models.auth import RefreshToken
from app.repositories.base import SqlRepository


class RefreshTokenRepository(SqlRepository):
    def get(self, token_id: UUID) -> RefreshToken | None:
        return self._session.get(RefreshToken, token_id)

    def add(self, token: RefreshToken) -> None:
        self._session.add(token)

    def delete(self, token: RefreshToken) -> None:
        self._session.delete(token)

    def delete_for_user(self, user_uuid: UUID) -> int:
        """Удаление всех refresh-токенов пользователя (смена пароля, ТЗ 4.2, шаг 2)."""
        result = self._session.execute(delete(RefreshToken).where(RefreshToken.user_uuid == user_uuid))
        return int(result.rowcount or 0)

    def delete_session(self, session_id: UUID) -> int:
        """Удаление всех токенов сессии входа: журнала и открытого из него управления пользователями."""
        result = self._session.execute(delete(RefreshToken).where(RefreshToken.session_id == session_id))
        return int(result.rowcount or 0)

    def session_active(self, session_id: UUID, *, portal: str, now: datetime) -> bool:
        """Есть ли у сессии входа действующий токен указанного сервиса."""
        stmt = select(RefreshToken.id).where(
            RefreshToken.session_id == session_id, RefreshToken.portal == portal, RefreshToken.expires_at > now
        )
        return self._session.scalar(stmt.limit(1)) is not None

    def delete_expired(self, now: datetime) -> int:
        result = self._session.execute(delete(RefreshToken).where(RefreshToken.expires_at <= now))
        return int(result.rowcount or 0)
