"""Справочники для интерфейса (категории, виды проверок, статусы, исполнители, права)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.schemas.commands import OptionInput
from app.schemas.responses import ExecutorOut, IdName, OptionsOut, ReferencesOut, SolutionOut, rights_tree
from app.web.forms import OptionsForm

router = APIRouter(prefix="/references", tags=["Справочники"])


@router.get("", response_model=ReferencesOut)
def references(principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> ReferencesOut:
    data = container.reference_service(uow, principal).load()
    return ReferencesOut(
        categories=[IdName(id=item.id, name=item.name) for item in data.categories],
        type_checks=[IdName(id=item.id, name=item.name) for item in data.type_checks],
        solutions=[SolutionOut(id=item.id, name=item.name, is_final=item.is_final) for item in data.solutions],
        executors=[ExecutorOut.of(user) for user in data.executors],
        rights_tree=rights_tree(),
    )


@router.get("/options", response_model=OptionsOut)
def get_options(principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> OptionsOut:
    return OptionsOut.of(container.option_service(uow, principal).get())


@router.put("/options", response_model=OptionsOut)
def save_options(
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(OptionsForm))],
) -> OptionsOut:
    return OptionsOut.of(container.option_service(uow, principal).save(OptionInput(**data)))
