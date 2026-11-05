"""Выдача уведомлений текущему пользователю и учёт показанных (ТЗ, раздел 2)."""

from __future__ import annotations

import base64
import binascii
import re
from urllib.parse import urlsplit
from uuid import UUID

from app.interfaces.repositories import UnitOfWork
from app.models.notification import Notification, NotificationSubscription, PushSubscription
from app.schemas.responses import AuthenticationFailed, NotFound, PermissionDenied, ValidationFailed
from app.schemas.settings import Portal, Settings
from app.services.access_control.principal import Principal
from core.clock import Clock


class NotificationService:
    """Выдача уведомлений текущему пользователю и учёт показанных."""

    def __init__(self, uow: UnitOfWork, principal: Principal, clock: Clock, settings: Settings, portal: Portal) -> None:
        self._uow = uow
        self._principal = principal
        self._clock = clock
        self._settings = settings
        self._portal = portal

    @property
    def push_public_key(self) -> str | None:
        if self._portal is not Portal.WEB or not self._settings.web_push_private_key:
            return None
        return self._settings.web_push_public_key

    def _web_session(self, raw_refresh: str | None):
        if not raw_refresh or self._portal is not Portal.WEB:
            raise AuthenticationFailed("Требуется действующая сессия журнала")
        try:
            token = self._uow.refresh_tokens.get(UUID(raw_refresh))
        except ValueError:
            token = None
        if (
            token is None
            or token.portal != Portal.WEB.value
            or token.user_uuid != self._principal.uuid
            or token.expires_at <= self._clock.now()
        ):
            raise AuthenticationFailed("Требуется действующая сессия журнала")
        return token.session_id

    def subscribe_push(self, endpoint: str, p256dh: str, auth: str, *, refresh_token: str | None) -> None:
        if not self.push_public_key:
            raise PermissionDenied("Web Push не настроен")
        session_id = self._web_session(refresh_token)
        try:
            parts = urlsplit(endpoint)
            port = parts.port
            host = (parts.hostname or "").lower()
        except ValueError as exc:
            raise ValidationFailed("Недопустимый адрес push-сервиса") from exc
        allowed = (
            host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
            or host.endswith((".notify.windows.com", ".wns.windows.com"))
        )
        if (
            parts.scheme != "https" or not allowed or port not in (None, 443)
            or parts.username or parts.password or parts.fragment or not endpoint.isascii()
        ):
            raise ValidationFailed("Недопустимый адрес push-сервиса")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", p256dh) or not re.fullmatch(r"[A-Za-z0-9_-]+", auth):
            raise ValidationFailed("Недопустимые ключи подписки")
        try:
            public = base64.urlsafe_b64decode(p256dh + "=" * (-len(p256dh) % 4))
            secret = base64.urlsafe_b64decode(auth + "=" * (-len(auth) % 4))
        except (ValueError, binascii.Error) as exc:
            raise ValidationFailed("Недопустимые ключи подписки") from exc
        if len(public) != 65 or public[0] != 4 or len(secret) != 16:
            raise ValidationFailed("Недопустимые ключи подписки")
        now = self._clock.now()
        subscription = self._uow.push.find_endpoint(endpoint)
        if subscription is None:
            subscription = PushSubscription(
                user_uuid=self._principal.uuid,
                session_id=session_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                created_at=now,
                updated_at=now,
            )
            self._uow.push.add(subscription)
        else:
            subscription.user_uuid = self._principal.uuid
            subscription.session_id = session_id
            subscription.p256dh = p256dh
            subscription.auth = auth
            subscription.updated_at = now
        self._uow.commit()

    def unsubscribe_push(self, *, refresh_token: str | None) -> None:
        self._uow.push.delete_session(self._web_session(refresh_token))
        self._uow.commit()

    def pending(self) -> list[Notification]:
        """Уведомления, сформированные пока пользователь не был в системе, не теряются:
        они выдаются при очередном опросе после входа."""
        return self._uow.notifications.pending(self._principal.uuid, self._clock.now())

    def history(self, limit: int = 200) -> list[Notification]:
        return self._uow.notifications.history(self._principal.uuid, limit=limit)

    def ack(self, notification_id: int) -> Notification:
        """Отметка о показе исключает повторный показ этого уведомления и не меняет статус задачи."""
        notification = self._uow.notifications.get(notification_id)
        if notification is None or notification.user_uuid != self._principal.uuid:
            raise NotFound("Уведомление не найдено")
        if notification.shown_at is None:
            notification.shown_at = self._clock.now()
            self._uow.commit()
        return notification

    def subscribe(self, permission: str, user_agent: str | None) -> NotificationSubscription:
        agent = (user_agent or "unknown")[:255]
        now = self._clock.now()
        subscription = self._uow.subscriptions.find(self._principal.uuid, agent)
        if subscription is None:
            subscription = NotificationSubscription(
                user_uuid=self._principal.uuid, user_agent=agent, permission=permission, created_at=now, updated_at=now
            )
            self._uow.subscriptions.add(subscription)
        else:
            subscription.permission = permission
            subscription.updated_at = now
        self._uow.commit()
        return subscription
