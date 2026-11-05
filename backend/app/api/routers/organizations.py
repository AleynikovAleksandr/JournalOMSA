"""Справочник организаций (ТЗ, 5.5)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.commands import OrganizationInput
from app.schemas.responses import OrganizationOut
from app.web.forms import CsrfOnlyForm, OrganizationForm

router = APIRouter(prefix="/organizations", tags=["Организации"])

OrgForm = Annotated[dict[str, Any], Depends(form(OrganizationForm))]


def _org_input(data: dict[str, Any]) -> OrganizationInput:
    return OrganizationInput(
        name=data["name"],
        address=data.get("address"),
        phone=data.get("phone"),
        contact=data.get("contact"),
        email=data.get("email"),
        note=data.get("note"),
    )


@router.get("", response_model=list[OrganizationOut])
def list_organizations(principal: PrincipalDep, container: ContainerDep, uow: UowDep, search: str | None = None):
    return [OrganizationOut.of(org) for org in container.organization_service(uow, principal).list(search)]


@router.get("/{organization_id}", response_model=OrganizationOut)
def get_organization(organization_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    return OrganizationOut.of(container.organization_service(uow, principal).get(organization_id))


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: OrgForm):
    return OrganizationOut.of(container.organization_service(uow, principal).create(_org_input(data)))


@router.put("/{organization_id}", response_model=OrganizationOut)
def update_organization(
    organization_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: OrgForm
):
    organization = container.organization_service(uow, principal).update(organization_id, _org_input(data))
    return OrganizationOut.of(organization)


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_organization(
    organization_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep
) -> Response:
    container.organization_service(uow, principal).delete(organization_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
