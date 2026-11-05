"""Журнал проверок — записи (ТЗ, 5.3)."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.commands import JournalFilter, JournalRecordInput
from app.schemas.responses import JournalRecordOut, LockOut
from app.web.forms import CsrfOnlyForm, JournalRecordForm, NoteForm, StatusForm

router = APIRouter(prefix="/journal", tags=["Журнал"])

RecordForm = Annotated[dict[str, Any], Depends(form(JournalRecordForm))]


def _record_input(data: dict[str, Any]) -> JournalRecordInput:
    return JournalRecordInput(
        check_date=data["date"],
        check_time=data["time"],
        type_check_id=data["type_check_id"],
        type_check_name=data.get("type_check_name"),
        fio=data["fio"],
        category_id=data["category_id"],
        category_name=data.get("category_name"),
        organization_id=data["organization_id"],
        executor_id=data["executor_id"],
        solution_id=data.get("solution_id"),
        solution_name=data.get("solution_name"),
        note=data.get("note"),
        group_id=data.get("group_id"),
        version=data.get("version"),
    )


@router.get("", response_model=list[JournalRecordOut])
def list_records(
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    fio: str | None = None,
    executor_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    my: bool = False,
    completed: bool | None = None,
):
    """Записи журнала с фильтрами: ФИО, исполнитель, диапазон дат, «мои задачи», «завершённые»."""
    flt = JournalFilter(
        fio=fio, executor_id=executor_id, date_from=date_from, date_to=date_to, completed=completed, my=my
    )
    return [JournalRecordOut.of(record) for record in container.journal_service(uow, principal).list(flt)]


@router.get("/{record_id}", response_model=JournalRecordOut)
def get_record(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    return JournalRecordOut.of(container.journal_service(uow, principal).get(record_id))


@router.post("", response_model=JournalRecordOut, status_code=status.HTTP_201_CREATED)
def create_record(principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: RecordForm):
    return JournalRecordOut.of(container.journal_service(uow, principal).create(_record_input(data)))


@router.put("/{record_id}", response_model=JournalRecordOut)
def update_record(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: RecordForm):
    return JournalRecordOut.of(container.journal_service(uow, principal).update(record_id, _record_input(data)))


@router.patch("/{record_id}/status", response_model=JournalRecordOut)
def update_status(
    record_id: int,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(StatusForm))],
):
    """Изменение только статуса готовности решения."""
    record = container.journal_service(uow, principal).update_status(
        record_id,
        data.get("solution_id"),
        solution_name=data.get("solution_name"),
        version=data.get("version"),
    )
    return JournalRecordOut.of(record)


@router.patch("/{record_id}/note", response_model=JournalRecordOut)
def update_note(
    record_id: int,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(NoteForm))],
):
    """Сохранение или изменение примечания к записи."""
    record = container.journal_service(uow, principal).update_note(
        record_id, data.get("note"), version=data.get("version")
    )
    return JournalRecordOut.of(record)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_record(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    container.journal_service(uow, principal).delete(record_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{record_id}/lock", response_model=LockOut, dependencies=[Depends(form(CsrfOnlyForm))])
def lock_record(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    """Блокировка карточки на время редактирования; повторный вызов продлевает срок."""
    result = container.journal_service(uow, principal).lock(record_id)
    return LockOut(locked=result.acquired, ttl_seconds=result.ttl_seconds, available=result.available)


@router.delete("/{record_id}/lock", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def unlock_record(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    container.journal_service(uow, principal).unlock(record_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
