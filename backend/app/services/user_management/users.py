"""Управление пользователями (ТЗ, раздел 9): сотрудники и их права."""

from __future__ import annotations

from uuid import uuid4

from app.interfaces.infrastructure import PasswordHasher
from app.interfaces.repositories import UnitOfWork
from app.models.user import User, UserGroup
from app.schemas.commands import UserCreateInput, UserUpdateInput
from app.schemas.responses import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal
from app.services.access_control.rights import MENU_SETTINGS, format_rules
from app.services.authentication.auth import normalize_login
from app.services.authentication.passwords import PasswordManager
from core.clock import Clock
from core.interprocess.events import EventPublisher, RealtimeEvent, RealtimeEventType

NO_SETTINGS_RIGHT = "Недостаточно прав для управления пользователями"
NO_EDIT_RIGHT = "Недостаточно прав для редактирования данных сотрудника"


class UserService:
    def __init__(
        self,
        uow: UnitOfWork,
        principal: Principal,
        *,
        policy: AccessPolicy,
        hasher: PasswordHasher,
        clock: Clock,
        publisher: EventPublisher,
    ) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy
        self._clock = clock
        self._publisher = publisher
        self._passwords = PasswordManager(uow, hasher, clock, publisher)

    def _require(self, act: str, message: str = NO_SETTINGS_RIGHT) -> None:
        self._policy.require(self._principal, "users", act, message)

    def _close_connections(self, user: User) -> None:
        user_uuid = user.uuid
        self._uow.after_commit(lambda: self._publisher.publish(RealtimeEvent(RealtimeEventType.CLOSE, user_uuid)))

    # ---- чтение ----
    def list(self, *, search: str | None = None, group_id: int | None = None, archive: bool = True) -> list[User]:
        self._require("read")
        return self._uow.users.list(search=search, group_id=group_id, include_fired=archive)

    def get(self, user_id: int) -> User:
        self._require("read")
        user = self._uow.users.get(user_id)
        if user is None:
            raise NotFound("Сотрудник не найден")
        return user

    # ---- проверки ----
    def _group(self, group_id: int) -> UserGroup:
        group = self._uow.user_groups.get(group_id)
        if group is None:
            raise ValidationFailed("Группа не найдена", details={"group_id": ["Неизвестная группа"]})
        if group.is_archive:
            raise ValidationFailed(
                "В архив нельзя добавлять — отметьте сотрудника как уволенного",
                details={"group_id": ["Архивная группа"]},
            )
        return group

    def _login(self, login: str, *, exclude_id: int | None = None) -> str:
        normalized = normalize_login(login)
        if self._uow.users.login_taken(normalized, exclude_id=exclude_id):
            raise Conflict("Логин уже занят", details={"login": ["Логин уже используется"]})
        return normalized

    def _not_self(self, user: User, message: str) -> None:
        if user.id == self._principal.user_id:
            raise PermissionDenied(message)

    # ---- изменение ----
    def create(self, data: UserCreateInput) -> User:
        self._require("manage")
        group = self._group(data.group_id)
        user = User(
            uuid=uuid4(),
            fio=data.fio.strip(),
            login=self._login(data.login),
            profile=(data.profile or "").strip() or None,
            group=group,
            is_fired=data.is_fired,
            rules=format_rules(data.rights),
            failed_login_attempts=0,
        )
        self._passwords.set_initial(user, data.password)
        self._uow.users.add(user)
        self._uow.commit()
        return user

    def update(self, user_id: int, data: UserUpdateInput) -> User:
        self._require("manage")
        self._require("edit_profile", NO_EDIT_RIGHT)
        user = self.get(user_id)
        if data.password and user.locked_until is not None and user.locked_until > self._clock.now():
            raise ValidationFailed(
                "Новый пароль можно задать после окончания блокировки",
                details={"password": ["Учётная запись временно заблокирована"]},
            )
        if data.is_fired and not user.is_fired:
            self._not_self(user, "Нельзя отметить уволенной собственную учётную запись")
        if data.group_id != user.group_id:
            user.group = self._group(data.group_id)
        user.fio = data.fio.strip()
        user.login = self._login(data.login, exclude_id=user.id)
        user.profile = (data.profile or "").strip() or None
        self._set_fired(user, data.is_fired)
        if data.password:
            self._passwords.change(user, data.password)
        self._uow.commit()
        return user

    def set_fired(self, user_id: int, is_fired: bool) -> User:
        self._require("manage")
        self._require("edit_profile", NO_EDIT_RIGHT)
        user = self.get(user_id)
        if is_fired:
            self._not_self(user, "Нельзя отметить уволенной собственную учётную запись")
        self._set_fired(user, is_fired)
        self._uow.commit()
        return user

    def _set_fired(self, user: User, is_fired: bool) -> None:
        if user.is_fired != is_fired:
            user.is_fired = is_fired
            # Права уволенного меняются сразу: открытые соединения закрываются
            self._close_connections(user)

    def set_rights(self, user_id: int, rights: frozenset[str]) -> User:
        self._policy.require(self._principal, "rights", "assign", NO_SETTINGS_RIGHT)
        user = self.get(user_id)
        if user.id == self._principal.user_id and MENU_SETTINGS not in rights:
            raise PermissionDenied("Нельзя снять с себя право «Настройки»")
        try:
            user.rules = format_rules(rights)
        except ValueError as exc:
            raise ValidationFailed(str(exc), details={"rights": [str(exc)]}) from exc
        self._uow.commit()
        return user

    def delete(self, user_id: int) -> None:
        self._require("manage")
        user = self.get(user_id)
        self._not_self(user, "Нельзя удалить собственную учётную запись")
        if self._uow.users.is_referenced_in_journal(user.id):
            raise Conflict("Сотрудник указан в журнале — удаление невозможно, отметьте его уволенным")
        self._close_connections(user)
        self._uow.refresh_tokens.delete_for_user(user.uuid)
        self._uow.push.delete_for_user(user.uuid)
        self._uow.users.delete(user)
        self._uow.commit()
