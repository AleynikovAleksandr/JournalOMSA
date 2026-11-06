"""Проверка прав на стороне сервера при каждом действии (ТЗ, раздел 10)."""

from __future__ import annotations

from app.interfaces.infrastructure import AccessControl
from app.models.journal import JournalRecord
from app.schemas.responses import PermissionDenied
from app.services.access_control.principal import Principal
from app.services.access_control.rights import JRN_OWN_ONLY, JRN_STATUS_ONLY

ROLE_AUTHENTICATED = "authenticated"
ROLE_ACTIVE = "active"


class AccessPolicy:
    """Права по модели Casbin: роль пользователя и права группы."""

    def __init__(self, acl: AccessControl) -> None:
        self._acl = acl

    @staticmethod
    def subjects(principal: Principal) -> list[str]:
        if principal.is_fired:
            # Уволенный сотрудник может только просматривать свои задачи.
            return [ROLE_AUTHENTICATED]
        return [ROLE_AUTHENTICATED, ROLE_ACTIVE, *sorted(principal.rights)]

    def allows(self, principal: Principal, obj: str, act: str) -> bool:
        return self._acl.allows(self.subjects(principal), obj, act)

    def require(self, principal: Principal, obj: str, act: str, message: str = "Недостаточно прав") -> None:
        if not self.allows(principal, obj, act):
            raise PermissionDenied(message)


class JournalRules:
    """Правила журнала, зависящие от конкретной записи: ограничения
    «только своих задач» (jrnOwnOnly) и «только статуса» (jrnStatusOnly)."""

    def __init__(self, policy: AccessPolicy, principal: Principal) -> None:
        self._policy = policy
        self._principal = principal

    @property
    def principal(self) -> Principal:
        return self._principal

    def _own(self, executor_id: int) -> bool:
        return executor_id == self._principal.user_id

    def _own_only_ok(self, executor_id: int) -> bool:
        return not self._principal.has(JRN_OWN_ONLY) or self._own(executor_id)

    def can_view(self, record: JournalRecord) -> bool:
        if self._principal.is_fired:
            # Уволенному доступны для просмотра только его собственные задачи
            return self._own(record.executor_id)
        return self._policy.allows(self._principal, "journal", "read")

    def can_create(self, executor_id: int) -> bool:
        return (
            self._policy.allows(self._principal, "journal", "create")
            and not self._principal.has(JRN_STATUS_ONLY)
            and self._own_only_ok(executor_id)
        )

    def can_edit_fields(self, record: JournalRecord) -> bool:
        return (
            self._policy.allows(self._principal, "journal", "update")
            and not self._principal.has(JRN_STATUS_ONLY)
            and self._own_only_ok(record.executor_id)
        )

    def can_change_status(self, record: JournalRecord) -> bool:
        return self._policy.allows(self._principal, "journal", "update_status") and self._own_only_ok(
            record.executor_id
        )

    def can_reassign(self, record: JournalRecord, new_executor_id: int) -> bool:
        """Сотрудник с ограничением «только своих задач» не передаёт свои задачи другим."""
        return self.can_edit_fields(record) and self._own_only_ok(new_executor_id)

    def can_delete(self, record: JournalRecord) -> bool:
        return self._policy.allows(self._principal, "journal", "delete") and self._own_only_ok(record.executor_id)
