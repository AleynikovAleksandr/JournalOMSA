"""Управление пользователями (ТЗ, раздел 9): группы сотрудников (роли)."""

from __future__ import annotations

from app.interfaces.repositories import UnitOfWork
from app.models.user import UserGroup
from app.schemas.responses import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import (
    ADMIN_GROUP_NAME, Principal, allowed_rights_for_group, has_user_rights_override,
)
from app.services.access_control.rights import (
    ADMIN_ONLY_RIGHTS, DEFAULT_RIGHTS, MENU_SETTINGS, format_personal_rules, format_rules,
    has_personal_rules, parse_rules,
)
from app.services.user_management.users import NO_SETTINGS_RIGHT, SYSTEM_ADMIN_FIO


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

    def rights_preview(self, group: UserGroup) -> frozenset[str]:
        if group.rules is not None:
            return parse_rules(group.rules)
        members = self._uow.users.list(group_id=group.id)
        return parse_rules(members[0].rules) if members else DEFAULT_RIGHTS

    def _get(self, group_id: int) -> UserGroup:
        group = self._uow.user_groups.get(group_id)
        if group is None or group.is_deleted:
            raise NotFound("Группа не найдена")
        return group

    def _name(self, name: str, *, exclude_id: int | None = None) -> str:
        cleaned = name.strip()
        if self._uow.user_groups.name_taken(cleaned, exclude_id=exclude_id):
            raise Conflict("Группа с таким названием уже есть", details={"name": ["Название занято"]})
        return cleaned

    def create(self, name: str) -> UserGroup:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        cleaned = name.strip()
        deleted = self._uow.user_groups.get_deleted_by_name(cleaned)
        if deleted is not None:
            deleted.is_deleted = False
            self._uow.commit()
            return deleted
        group = UserGroup(name=self._name(cleaned), is_archive=False, rules=format_rules(DEFAULT_RIGHTS))
        self._uow.user_groups.add(group)
        self._uow.commit()
        return group

    def rename(self, group_id: int, name: str) -> UserGroup:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        group = self._get(group_id)
        if group.name == ADMIN_GROUP_NAME:
            raise Conflict("Название группы «Администраторы» изменить нельзя")
        group.name = self._name(name, exclude_id=group.id)
        self._uow.commit()
        return group

    def delete(self, group_id: int) -> None:
        self._policy.require(self._principal, "user_groups", "manage", NO_SETTINGS_RIGHT)
        group = self._get(group_id)
        if group.is_archive:
            raise Conflict("Группу «Архив» удалить нельзя")
        if self._uow.users.count_in_group(group.id, include_fired=False):
            raise Conflict("Группа не пуста — сначала перенесите сотрудников")
        members = self._uow.users.list(group_id=group.id)
        if members:
            # Скрываем группу, но сохраняем связь с уволенными: при восстановлении
            # эта же группа вернётся в список вместе с исходными правами.
            group.is_deleted = True
        else:
            self._uow.user_groups.delete(group)
        self._uow.commit()

    def set_rights(self, group_id: int, rights: frozenset[str]) -> UserGroup:
        self._policy.require(self._principal, "rights", "assign", NO_SETTINGS_RIGHT)
        group = self._get(group_id)
        if group.is_archive:
            raise Conflict("У архивной группы нет собственных прав")
        if group.name != ADMIN_GROUP_NAME and rights & ADMIN_ONLY_RIGHTS:
            raise PermissionDenied("Эти права доступны только группе «Администраторы»")
        current = self._uow.users.get(self._principal.user_id)
        if (
            current is not None
            and current.group_id == group_id
            and current.fio != SYSTEM_ADMIN_FIO
            and not has_user_rights_override(current)
            and MENU_SETTINGS not in rights
        ):
            raise PermissionDenied("Нельзя снять у своей группы право «Настройки»")
        try:
            formatted = format_rules(rights)
        except ValueError as exc:
            raise ValidationFailed(str(exc), details={"rights": [str(exc)]}) from exc
        for user in self._uow.users.list(group_id=group_id):
            if user.fio == SYSTEM_ADMIN_FIO:
                continue
            if has_user_rights_override(user):
                if not has_personal_rules(user.rules):
                    user.rules = format_personal_rules(allowed_rights_for_group(group.name, parse_rules(user.rules)))
            else:
                user.rules = formatted
        group.rules = formatted
        self._uow.commit()
        return group
