"""Уведомления (ТЗ, 5.2 и раздел 2)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app.api.deps import ContainerDep, PrincipalDep, UowDep, form, user_agent
from app.schemas.responses import NotificationOut, SubscriptionOut
from app.web.forms import CsrfOnlyForm, SubscribeForm

router = APIRouter(prefix="/notifications", tags=["Уведомления"])


@router.get("/push-config")
def push_config(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    key = container.notification_service(uow, principal).push_public_key
    return {"enabled": bool(key), "public_key": key}


@router.post("/subscribe", response_model=SubscriptionOut)
def subscribe(
    request: Request,
    principal: PrincipalDep,
    container: ContainerDep,
    uow: UowDep,
    data: Annotated[dict[str, Any], Depends(form(SubscribeForm))],
):
    """Регистрация клиента на получение уведомлений (состояние разрешения браузера)."""
    subscription = container.notification_service(uow, principal).subscribe(data["permission"], user_agent(request))
    return SubscriptionOut(permission=subscription.permission, updated_at=subscription.updated_at)


@router.get("/pending", response_model=list[NotificationOut])
def pending(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    """Подлежащие показу (непоказанные) уведомления по всем незавершённым задачам пользователя."""
    return [NotificationOut.of(item) for item in container.notification_service(uow, principal).pending()]


@router.get("", response_model=list[NotificationOut])
def history(principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    """Журнал уведомлений текущего пользователя, включая показанные."""
    return [NotificationOut.of(item) for item in container.notification_service(uow, principal).history()]


@router.post("/{notification_id}/ack", response_model=NotificationOut, dependencies=[Depends(form(CsrfOnlyForm))])
def ack(notification_id: int, principal: PrincipalDep, container: ContainerDep, uow: UowDep):
    """Отметка уведомления как показанного; статус задачи не меняется."""
    return NotificationOut.of(container.notification_service(uow, principal).ack(notification_id))
