"""Установка и смена пароля (ТЗ, 4.2: защита JWT при смене пароля)."""

from __future__ import annotations

from app.interfaces.infrastructure import PasswordHasher
from app.interfaces.repositories import UnitOfWork
from app.models.user import User
from app.schemas.responses import ValidationFailed
from core.clock import Clock, truncate_to_ms
from core.interprocess.events import EventPublisher, RealtimeEvent, RealtimeEventType

MIN_PASSWORD_LENGTH = 8


class PasswordManager:
    def __init__(self, uow: UnitOfWork, hasher: PasswordHasher, clock: Clock, publisher: EventPublisher) -> None:
        self._uow = uow
        self._hasher = hasher
        self._clock = clock
        self._publisher = publisher

    @staticmethod
    def validate(password: str) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValidationFailed(
                f"Пароль должен содержать не менее {MIN_PASSWORD_LENGTH} символов",
                details={"password": ["Слишком короткий пароль"]},
            )

    def set_initial(self, user: User, password: str) -> None:
        """Пароль нового сотрудника: password_changed_at заполняется при регистрации."""
        self.validate(password)
        user.password_hash = self._hasher.hash(password)
        user.password_changed_at = truncate_to_ms(self._clock.now())

    def change(self, user: User, password: str) -> None:
        """Смена пароля.

        1. Обновляется password_changed_at: токены, выданные раньше, отклоняются.
        2. Удаляются все refresh-токены: новый JWT в обход защиты не получить.
        3. После фиксации закрываются открытые WebSocket-соединения пользователя.
        """
        self.validate(password)
        user.password_hash = self._hasher.hash(password)
        user.password_changed_at = truncate_to_ms(self._clock.now())
        self._uow.refresh_tokens.delete_for_user(user.uuid)
        self._uow.push.delete_for_user(user.uuid)
        user_uuid = user.uuid
        self._uow.after_commit(lambda: self._publisher.publish(RealtimeEvent(RealtimeEventType.CLOSE, user_uuid)))
