"""Проверочные группы — блоки (ТЗ, 5.4)."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Request, Response, status

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.commands import CheckGroupInput, JournalRecordInput
from app.schemas.responses import CheckGroupOut, JournalRecordOut, ValidationFailed
from app.web.forms import CheckGroupForm, CsrfOnlyForm, JournalRecordForm

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


@router.post("/with-records", status_code=status.HTTP_201_CREATED)
def create_group_with_records(
    request: Request,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    payload: Annotated[dict[str, Any], Body()],
):
    """Создать группу и все строки редактора одной транзакцией."""
    group_payload = payload.get("group")
    rows_payload = payload.get("records")
    if not isinstance(group_payload, dict) or not isinstance(rows_payload, list) or len(rows_payload) > 100:
        raise ValidationFailed("Неверные данные проверочной группы")
    if any(not isinstance(row, dict) for row in rows_payload):
        raise ValidationFailed("Неверные данные аттестуемых")
    credentials = {"cookie": request.headers.get("cookie", ""), "csrf_token": request.headers.get("x-csrftoken", "")}
    group_data = container.forms.validate(CheckGroupForm, group_payload, **credentials)
    row_data = []
    for index, row in enumerate(rows_payload, start=1):
        try:
            row_data.append(container.forms.validate(JournalRecordForm, row, **credentials))
        except ValidationFailed as exc:
            raise ValidationFailed(f"Строка {index}: {exc.message}", details=exc.details) from exc

    group = container.group_service(uow, principal).create(_group_input(group_data), commit=False)
    service = container.journal_service(uow, principal)
    records = []
    for data in row_data:
        record_input = JournalRecordInput(
            check_date=data["date"], check_time=data["time"],
            type_check_id=data.get("type_check_id"), type_check_name=data.get("type_check_name"),
            fio=data["fio"], category_id=data.get("category_id"), category_name=data.get("category_name"),
            organization_id=data["organization_id"], executor_id=data["executor_id"],
            solution_id=data.get("solution_id"), solution_name=data.get("solution_name"),
            note=data.get("note"), group_id=group.id,
        )
        records.append(service.create(record_input, commit=False))
    uow.commit()
    return {"group": CheckGroupOut.of(group, len([row for row in records if row.group_id == group.id])),
            "records": [JournalRecordOut.of(row) for row in records]}


@router.put("/{group_id}", response_model=CheckGroupOut)
def update_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: GroupForm):
    group = container.group_service(uow, principal).update(group_id, _group_input(data))
    return CheckGroupOut.of(group, len(uow.journal.in_group(group.id)))


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    """Удаление группы целиком."""
    container.group_service(uow, principal).delete(group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
