"""Реквизиты приложения из TOptions."""

from __future__ import annotations

from app.interfaces.repositories import UnitOfWork
from app.models.references import Option
from app.schemas.commands import OptionInput
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal


class OptionService:
    def __init__(self, uow: UnitOfWork, principal: Principal, policy: AccessPolicy) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy

    def _require(self) -> None:
        self._policy.require(self._principal, "users", "manage", "Недостаточно прав для изменения реквизитов")

    def get(self) -> Option | None:
        self._require()
        items = self._uow.references.options()
        return items[0] if items else None

    def save(self, data: OptionInput) -> Option:
        self._require()
        items = self._uow.references.options()
        item = items[0] if items else Option()
        item.address = (data.address or "").strip() or None
        item.position = (data.position or "").strip() or None
        item.fio = (data.fio or "").strip() or None
        if not items:
            self._uow.references.add_option(item)
        self._uow.commit()
        return item
