"""Управление пользователями (ТЗ, раздел 9): группы сотрудников (роли)."""

from __future__ import annotations

from app.interfaces.repositories import UnitOfWork
from app.models.user import UserGroup
from app.schemas.responses import Conflict, NotFound
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal
from app.services.user_management.users import NO_SETTINGS_RIGHT


class UserGroupService:
    def __init__(self, uow: UnitOfWork, principal: Principal, policy: AccessPolicy) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy

    def list(self) -> list[tuple[UserGroup, int]]:
        """Группы и число сотрудников в каждой: уволенные показываются в группе «Архив»."""
        self._policy.require(self._principal, "users", "read", NO_SETTINGS_RIGHT)
        active, fired = self._uow.user_groups.member_counts()
        return [
            (group, fired if group.is_archive else active.get(group.id, 0)) for group in self._uow.user_groups.list()
        ]

    def members(self, group: UserGroup) -> int:
        active, fired = self._uow.user_groups.member_counts()
        return fired if group.is_archive else active.get(group.id, 0)

    def _get(self, group_id: int) -> UserGroup:
        group = self._uow.user_groups.get(group_id)
        if group is None:
            raise NotFound("Группа не найдена")
        return group

    def _name(self, name: str, *, exclude_id: int | None = None) -> str:
        cleaned = name.strip()
        if self._uow.user_groups.name_taken(cleaned, exclude_id=exclude_id):
            raise Conflict("Группа с таким названием уже есть", details={"name": ["Название занято"]})
        return cleaned

    def create(self, name: str) -> UserGroup:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        group = UserGroup(name=self._name(name), is_archive=False)
        self._uow.user_groups.add(group)
        self._uow.commit()
        return group

    def rename(self, group_id: int, name: str) -> UserGroup:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        group = self._get(group_id)
        group.name = self._name(name, exclude_id=group.id)
        self._uow.commit()
        return group

    def delete(self, group_id: int) -> None:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        group = self._get(group_id)
        if group.is_archive:
            raise Conflict("Группу «Архив» удалить нельзя")
        if self._uow.users.count_in_group(group.id):
            raise Conflict("Группа не пуста — сначала перенесите сотрудников")
        self._uow.user_groups.delete(group)
        self._uow.commit()
