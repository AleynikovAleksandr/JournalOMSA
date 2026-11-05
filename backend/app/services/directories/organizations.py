"""Справочник организаций (ТЗ, 8.2.9): ведение при наличии права «Справочники»."""

from __future__ import annotations

from app.interfaces.repositories import UnitOfWork
from app.models.organization import Organization
from app.schemas.commands import OrganizationInput
from app.schemas.responses import Conflict, NotFound
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal

NO_REFS_RIGHT = "Недостаточно прав для ведения справочника организаций"


class OrganizationService:
    def __init__(self, uow: UnitOfWork, principal: Principal, policy: AccessPolicy) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy

    def list(self, search: str | None = None) -> list[Organization]:
        return self._uow.organizations.list(search=search)

    def get(self, organization_id: int) -> Organization:
        organization = self._uow.organizations.get(organization_id)
        if organization is None:
            raise NotFound("Организация не найдена")
        return organization

    @staticmethod
    def _apply(organization: Organization, data: OrganizationInput) -> None:
        organization.name = data.name.strip()
        organization.address = (data.address or "").strip() or None
        organization.phone = (data.phone or "").strip() or None
        organization.contact = (data.contact or "").strip() or None
        organization.email = (data.email or "").strip() or None
        organization.note = (data.note or "").strip() or None

    def create(self, data: OrganizationInput) -> Organization:
        self._policy.require(self._principal, "organizations", "write", NO_REFS_RIGHT)
        organization = Organization()
        self._apply(organization, data)
        self._uow.organizations.add(organization)
        self._uow.commit()
        return organization

    def update(self, organization_id: int, data: OrganizationInput) -> Organization:
        self._policy.require(self._principal, "organizations", "write", NO_REFS_RIGHT)
        organization = self.get(organization_id)
        self._apply(organization, data)
        self._uow.commit()
        return organization

    def delete(self, organization_id: int) -> None:
        self._policy.require(self._principal, "organizations", "write", NO_REFS_RIGHT)
        organization = self.get(organization_id)
        if self._uow.organizations.is_used(organization.id):
            raise Conflict("Организация указана в записях журнала — удаление невозможно")
        self._uow.organizations.delete(organization)
        self._uow.commit()
