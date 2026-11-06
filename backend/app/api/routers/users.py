"""Пользователи и роли (ТЗ, 5.6). Доступ — право «Настройки» (menuSettings)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form
from app.container import Container
from app.models.user import User
from app.schemas.commands import UserCreateInput, UserUpdateInput
from app.schemas.responses import UserGroupOut, UserOut, ValidationFailed
from app.web.forms import CsrfOnlyForm, FiredForm, RightsForm, UserCreateForm, UserGroupForm, UserUpdateForm

router = APIRouter(prefix="/users", tags=["Пользователи"])
groups_router = APIRouter(prefix="/user-groups", tags=["Группы пользователей"])


def _user_out(container: Container, user: User) -> UserOut:
    """Действует ли блокировка входа, решает сервер — по своим часам и тому же правилу, что при входе."""
    locked = container.lock_policy.active_lock(user, container.clock.now()) is not None
    return UserOut.of(user, is_locked=locked)


@router.get("", response_model=list[UserOut])
def list_users(
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    search: str | None = None,
    group_id: int | None = None,
    archive: bool = True,
):
    """Сотрудники с поиском по ФИО/логину, фильтром по группе и признаку «архив»."""
    users = container.user_service(uow, principal).list(search=search, group_id=group_id, archive=archive)
    return [_user_out(container, user) for user in users]


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    return _user_out(container, container.user_service(uow, principal).get(user_id))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(UserCreateForm))],
):
    if data.get("rights"):
        raise ValidationFailed("Права назначаются группе", details={"rights": ["Выберите права группы"]})
    user = container.user_service(uow, principal).create(
        UserCreateInput(
            fio=data["fio"],
            login=data["login"],
            password=data["password"],
            group_id=data["group_id"],
            profile=data.get("profile"),
        )
    )
    return _user_out(container, user)


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(UserUpdateForm))],
):
    user = container.user_service(uow, principal).update(
        user_id,
        UserUpdateInput(
            fio=data["fio"],
            login=data["login"],
            group_id=data["group_id"],
            profile=data.get("profile"),
            is_fired=bool(data.get("is_fired")),
            password=data.get("password") or None,
        ),
    )
    return _user_out(container, user)


@router.patch("/{user_id}/fired", response_model=UserOut)
def set_fired(
    user_id: int,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(FiredForm))],
):
    """Отметка «уволен» / восстановление."""
    user = container.user_service(uow, principal).set_fired(user_id, bool(data.get("is_fired")))
    return _user_out(container, user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_user(user_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    container.user_service(uow, principal).delete(user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Группы (роли)
# ---------------------------------------------------------------------------
GroupForm = Annotated[dict[str, Any], Depends(form(UserGroupForm))]


@groups_router.get("", response_model=list[UserGroupOut])
def list_user_groups(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    service = container.user_group_service(uow, principal)
    return [UserGroupOut.of(group, members, preview=service.rights_preview(group)) for group, members in service.list()]


@groups_router.post("", response_model=UserGroupOut, status_code=status.HTTP_201_CREATED)
def create_user_group(principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: GroupForm):
    return UserGroupOut.of(container.user_group_service(uow, principal).create(data["name"]))


@groups_router.put("/{group_id}/rights", response_model=UserGroupOut)
def set_user_group_rights(
    group_id: int,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(RightsForm))],
):
    service = container.user_group_service(uow, principal)
    group = service.set_rights(group_id, frozenset(data.get("rights") or ()))
    return UserGroupOut.of(group, service.members(group))


@groups_router.put("/{group_id}", response_model=UserGroupOut)
def rename_user_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep, data: GroupForm):
    service = container.user_group_service(uow, principal)
    group = service.rename(group_id, data["name"])
    return UserGroupOut.of(group, service.members(group))


@groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def delete_user_group(group_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> Response:
    container.user_group_service(uow, principal).delete(group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
