"""Задачи текущего исполнителя (ТЗ, 5.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.responses import JournalRecordOut
from app.web.forms import CsrfOnlyForm

router = APIRouter(prefix="/tasks", tags=["Задачи"])


@router.get("/my", response_model=list[JournalRecordOut])
def my_tasks(principal: PrincipalDep, container: ContainerDep, uow: UowDep, completed: bool = False):
    """Задачи текущего исполнителя; completed=true — завершённые."""
    records = container.task_service(uow, principal).my(completed=completed)
    return [JournalRecordOut.of(record) for record in records]


@router.get("/upcoming", response_model=list[JournalRecordOut])
def upcoming(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    return [JournalRecordOut.of(record) for record in container.task_service(uow, principal).upcoming()]


@router.get("/due", response_model=list[JournalRecordOut])
def due(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    return [JournalRecordOut.of(record) for record in container.task_service(uow, principal).due()]


@router.patch("/{record_id}/complete", response_model=JournalRecordOut, dependencies=[Depends(form(CsrfOnlyForm))])
def complete(record_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    """Отметка задачи как завершённой — единственное действие, прекращающее уведомления."""
    return JournalRecordOut.of(container.task_service(uow, principal).complete(record_id))
