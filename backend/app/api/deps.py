"""Зависимости эндпоинтов: контейнер, единица работы, текущий пользователь, формы."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Annotated, Any

from fastapi import Body, Depends, Request

from app.container import Container
from app.repositories.unit_of_work import SqlUnitOfWork
from app.schemas.responses import AuthenticationFailed, PermissionDenied
from app.services.access_control.principal import Principal
from app.web.forms import ApiForm

CSRF_HEADER = "x-csrftoken"


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def get_uow(container: ContainerDep) -> Iterator[SqlUnitOfWork]:
    uow = container.unit_of_work()
    try:
        yield uow
    except Exception:
        uow.rollback()
        raise
    finally:
        uow.close()


UowDep = Annotated[SqlUnitOfWork, Depends(get_uow)]


def get_principal(request: Request, container: ContainerDep, uow: UowDep) -> Principal:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationFailed("Требуется вход в систему")
    return container.auth_service(uow).authenticate(token.strip())


PrincipalDep = Annotated[Principal, Depends(get_principal)]


def client_ip(request: Request) -> str | None:
    """IP-адрес клиента. За обратным прокси Uvicorn подставляет адрес из X-Forwarded-For,
    только если запрос пришёл с доверенного адреса (forwarded_allow_ips в Gunicorn)."""
    return request.client.host if request.client else None


def user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def require_origin(request: Request, container: ContainerDep) -> None:
    """Эндпоинты /api/auth/* принимают запросы только со страниц своего порта."""
    origin = request.headers.get("origin")
    if origin is None:
        if request.method in {"GET", "HEAD"}:
            return
        raise PermissionDenied("Запрос отклонён: не указан источник (Origin)")
    if origin.rstrip("/") not in container.portal.allowed_origins:
        raise PermissionDenied("Запрос отклонён: недопустимый источник (Origin)")


def form(form_cls: type[ApiForm]) -> Callable[..., dict[str, Any]]:
    """Зависимость: данные запроса, проверенные формой Flask-WTF (поля и CSRF-токен)."""

    def dependency(
        request: Request,
        container: ContainerDep,
        payload: Annotated[dict[str, Any] | None, Body()] = None,
    ) -> dict[str, Any]:
        return container.forms.validate(
            form_cls,
            payload,
            cookie=request.headers.get("cookie", ""),
            csrf_token=request.headers.get(CSRF_HEADER, ""),
        )

    return dependency
