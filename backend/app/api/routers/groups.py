"""Проверочные группы — блоки (ТЗ, 5.4)."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.commands import CheckGroupInput
from app.schemas.responses import CheckGroupOut
from app.web.forms import CheckGroupForm, CsrfOnlyForm

router = APIRouter(prefix="/groups", tags=["Проверочные группы"])

GroupForm = Annotated[dict[str, Any], Depends(form(CheckGroupForm))]


def _group_input(data: dict[str, Any]) -> CheckGroupInput:
    return CheckGroupInput(
        check_date=data["date"],
        check_time=data["time"],
        type_check_id=data.get("type_check_id"),
        type_check_name=data.get("type_check_name"),
    )


@router.get("", response_model=list[CheckGroupOut])
def list_groups(
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Проверочные группы для календаря и таблицы."""
    service = container.group_service(uow, principal)
    return [CheckGroupOut.of(group, count) for group, count in service.list(date_from=date_from, date_to=date_to)]


@router.post("", response_model=CheckGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: GroupForm):
    return CheckGroupOut.of(container.group_service(uow, principal).create(_group_input(data)))


@router.put("/{group_id}", response_model=CheckGroupOut)
def update_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: GroupForm):
    group = container.group_service(uow, principal).update(group_id, _group_input(data))
    return CheckGroupOut.of(group, len(uow.journal.in_group(group.id)))


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    """Удаление группы целиком."""
    container.group_service(uow, principal).delete(group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
