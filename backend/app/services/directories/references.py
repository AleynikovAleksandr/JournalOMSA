"""Справочники для интерфейса: категории, виды проверок, статусы, исполнители, дерево прав."""

from __future__ import annotations

from dataclasses import dataclass

from app.interfaces.repositories import UnitOfWork
from app.models.references import Category, Solution, TypeCheck
from app.models.user import User
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal


@dataclass(frozen=True, slots=True)
class ReferenceData:
    categories: list[Category]
    type_checks: list[TypeCheck]
    solutions: list[Solution]
    executors: list[User]


class ReferenceService:
    def __init__(self, uow: UnitOfWork, principal: Principal, policy: AccessPolicy) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy

    def load(self) -> ReferenceData:
        self._policy.require(self._principal, "references", "read")
        return ReferenceData(
            categories=self._uow.references.categories(),
            type_checks=self._uow.references.type_checks(),
            solutions=self._uow.references.solutions(),
            executors=self._uow.users.executors(),
        )

