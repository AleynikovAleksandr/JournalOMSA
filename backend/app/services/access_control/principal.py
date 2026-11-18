"""Текущий пользователь запроса."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.models.user import User
from app.services.access_control.rights import ADMIN_ONLY_RIGHTS, has_personal_rules, parse_rules

SYSTEM_ADMIN_FIO = "Администратор системы"
SYSTEM_ADMIN_LOGIN = "admin"
ADMIN_GROUP_NAME = "Администраторы"


def allowed_rights_for_group(group_name: str, rights: frozenset[str]) -> frozenset[str]:
    return rights if group_name == ADMIN_GROUP_NAME else rights - ADMIN_ONLY_RIGHTS


def has_user_rights_override(user: User) -> bool:
    if user.login == SYSTEM_ADMIN_LOGIN:
        return False
    if has_personal_rules(user.rules):
        return True
    if user.group.rules is None:
        return False
    return parse_rules(user.rules) != parse_rules(user.group.rules)


def effective_user_rules(user: User) -> str | None:
    if user.login == SYSTEM_ADMIN_LOGIN or user.group.rules is None or has_user_rights_override(user):
        return user.rules
    return user.group.rules


@dataclass(frozen=True, slots=True)
class Principal:
    user_id: int
    uuid: UUID
    fio: str
    login: str
    rights: frozenset[str]
    is_fired: bool
    group_name: str = ""

    @property
    def is_system_admin(self) -> bool:
        """Стартовая учётная запись приложения с логином admin."""
        return not self.is_fired and self.login == SYSTEM_ADMIN_LOGIN

    @property
    def can_view_other_tasks(self) -> bool:
        """Чужие задачи доступны активным участникам группы администраторов."""
        return not self.is_fired and (self.is_system_admin or self.group_name == ADMIN_GROUP_NAME)

    @classmethod
    def from_user(cls, user: User) -> Principal:
        return cls(
            user_id=user.id,
            uuid=user.uuid,
            fio=user.fio,
            login=user.login,
            rights=allowed_rights_for_group(user.group.name, parse_rules(effective_user_rules(user))),
            is_fired=user.is_fired,
            group_name=user.group.name,
        )

    def has(self, right: str) -> bool:
        """Право действует, только пока сотрудник не уволен."""
        return (
            not self.is_fired
            and right in self.rights
            and (right not in ADMIN_ONLY_RIGHTS or self.group_name == ADMIN_GROUP_NAME)
        )
