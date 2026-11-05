"""Справочник организаций."""

from __future__ import annotations

from sqlalchemy import exists, func, select

from app.models.journal import JournalRecord
from app.models.organization import Organization
from app.repositories.base import SqlRepository


class OrganizationRepository(SqlRepository):
    def list(self, *, search: str | None = None) -> list[Organization]:
        stmt = select(Organization).order_by(Organization.id)
        if search:
            stmt = stmt.where(func.lower(Organization.name).contains(search.strip().lower(), autoescape=True))
        return list(self._session.scalars(stmt))

    def get(self, organization_id: int) -> Organization | None:
        return self._session.get(Organization, organization_id)

    def is_used(self, organization_id: int) -> bool:
        return bool(self._session.scalar(select(exists().where(JournalRecord.organization_id == organization_id))))

    def add(self, organization: Organization) -> None:
        self._session.add(organization)

    def delete(self, organization: Organization) -> None:
        self._session.delete(organization)
