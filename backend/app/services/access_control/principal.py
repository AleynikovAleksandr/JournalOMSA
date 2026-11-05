"""Текущий пользователь запроса."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.models.user import User
from app.services.access_control.rights import parse_rules


@dataclass(frozen=True, slots=True)
class Principal:
    user_id: int
    uuid: UUID
    fio: str
    login: str
    rights: frozenset[str]
    is_fired: bool

    @classmethod
    def from_user(cls, user: User) -> Principal:
        return cls(
            user_id=user.id,
            uuid=user.uuid,
            fio=user.fio,
            login=user.login,
            rights=parse_rules(user.rules),
            is_fired=user.is_fired,
        )

    def has(self, right: str) -> bool:
        """Право действует, только пока сотрудник не уволен."""
        return not self.is_fired and right in self.rights
