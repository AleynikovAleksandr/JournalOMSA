"""Авторизация и учётная запись (ТЗ, 5.1)."""

from __future__ import annotations

from typing import Annotated, Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse

from app.api.deps import ContainerDep, PrincipalDep, UowDep, client_ip, form, require_origin, user_agent
from app.container import Container
from app.schemas.responses import AuthenticationFailed, MeOut, PermissionDenied, TokenOut
from app.services.authentication.auth import IssuedSession
from app.web.forms import ChangePasswordForm, CsrfOnlyForm, LoginForm, PushSubscribeForm

router = APIRouter(prefix="/auth", tags=["Авторизация"], dependencies=[Depends(require_origin)])

COOKIE_PATH = "/api/auth"


@router.post("/push-subscribe", status_code=status.HTTP_204_NO_CONTENT)
def push_subscribe(
    request: Request,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(PushSubscribeForm))],
) -> None:
    container.notification_service(uow, principal).subscribe_push(
        data["endpoint"], data["p256dh"], data["auth"],
        refresh_token=request.cookies.get(container.portal.refresh_cookie),
    )


@router.delete("/push-subscribe", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def push_unsubscribe(request: Request, principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> None:
    container.notification_service(uow, principal).unsubscribe_push(
        refresh_token=request.cookies.get(container.portal.refresh_cookie)
    )


def _set_refresh_cookie(response: Response, container: Container, session: IssuedSession) -> None:
    # HttpOnly — недоступна скриптам; Path=/api/auth — отправляется только эндпоинтам авторизации
    response.set_cookie(
        container.portal.refresh_cookie,
        str(session.refresh_token),
        max_age=int(container.settings.refresh_token_ttl.total_seconds()),
        path=COOKIE_PATH,
        secure=container.settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


def _token(container: Container, session: IssuedSession) -> TokenOut:
    expires_in = int((session.access_expires_at - container.clock.now()).total_seconds())
    return TokenOut(
        access_token=session.access_token,
        expires_in=max(expires_in, 0),
        user=MeOut.of(session.user, portal=container.portal.portal.value, admin_url=container.portal.admin_link),
    )


@router.post("/login", response_model=TokenOut)
def login(
    request: Request,
    response: Response,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(LoginForm))],
) -> TokenOut:
    """Вход по логину и паролю с учётом лимита в 5 попыток; выдача JWT и refresh-токена."""
    session = container.auth_service(uow).login(
        data["login"], data["password"], ip=client_ip(request), user_agent=user_agent(request)
    )
    _set_refresh_cookie(response, container, session)
    return _token(container, session)


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(form(CsrfOnlyForm))])
def refresh(request: Request, response: Response, container: ContainerDep, uow: UowDep) -> TokenOut:
    """Обмен действующего refresh-токена на новый JWT (refresh-токен заменяется новым)."""
    session = container.auth_service(uow).refresh(
        request.cookies.get(container.portal.refresh_cookie),
        ip=client_ip(request),
        user_agent=user_agent(request),
    )
    _set_refresh_cookie(response, container, session)
    return _token(container, session)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(form(CsrfOnlyForm))])
def logout(request: Request, container: ContainerDep, uow: UowDep) -> Response:
    """Удаление текущего refresh-токена (завершение сессии)."""
    container.auth_service(uow).logout(request.cookies.get(container.portal.refresh_cookie))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        container.portal.refresh_cookie,
        path=COOKIE_PATH,
        secure=container.settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )
    return response


def _redirect(url: str) -> RedirectResponse:
    # Ответ с билетом или новой сессией не кэшируется
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER, headers={"Cache-Control": "no-store"})


@router.get("/admin-handoff", include_in_schema=False)
def admin_handoff(request: Request, container: ContainerDep, uow: UowDep) -> RedirectResponse:
    """Журнал → управление пользователями без повторного ввода логина и пароля.

    Сессия журнала проверяется по refresh-cookie; при праве «Настройки» сервис admin
    получает одноразовый билет. Без сессии или без права — страница входа сервиса admin.
    """
    ticket = container.auth_service(uow).admin_handoff(request.cookies.get(container.portal.refresh_cookie))
    admin = container.settings.admin_public_origin
    if ticket is None:
        return _redirect(f"{admin}/login")
    return _redirect(f"{admin}{COOKIE_PATH}/sso?{urlencode({'ticket': ticket})}")


@router.get("/sso", include_in_schema=False)
def sso(request: Request, container: ContainerDep, uow: UowDep, ticket: str = "") -> RedirectResponse:
    """Вход в управление пользователями по билету из журнала."""
    try:
        session = container.auth_service(uow).enter_by_ticket(
            ticket, ip=client_ip(request), user_agent=user_agent(request)
        )
    except (AuthenticationFailed, PermissionDenied):
        return _redirect(container.portal.login_path)
    response = _redirect(container.portal.home_path)
    _set_refresh_cookie(response, container, session)
    return response


@router.post("/change-password", response_model=TokenOut)
def change_password(
    request: Request,
    response: Response,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(ChangePasswordForm))],
) -> TokenOut:
    """Смена пароля: обновление password_changed_at и удаление всех refresh-токенов пользователя."""
    session = container.auth_service(uow).change_password(
        principal,
        data["old_password"],
        data["new_password"],
        ip=client_ip(request),
        user_agent=user_agent(request),
    )
    _set_refresh_cookie(response, container, session)
    return _token(container, session)


@router.get("/me", response_model=MeOut)
def me(principal: PrincipalDep, container: ContainerDep, uow: UowDep) -> MeOut:
    """Текущий пользователь: ФИО, логин, роль и набор прав."""
    user = container.auth_service(uow).current_user(principal)
    return MeOut.of(user, portal=container.portal.portal.value, admin_url=container.portal.admin_link)
