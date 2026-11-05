"""WebSocket-соединения (документ «WebRTC Control», 3.3).

* Только wss:// и только со страниц своего порта (заголовок Origin).
* Токен доступа — первым сообщением после установки соединения, а не в адресе.
  Если действительный токен не получен за 5 секунд, соединение закрывается.
* По истечении срока JWT сервер закрывает соединение (код 4001), клиент
  переподключается с обновлённым токеном.
* При смене пароля, отметке «уволен» и выходе из системы все соединения
  пользователя закрываются (код 4003); команда между воркерами и подами
  передаётся через Redis Pub/Sub.
* Событие notify сообщает клиенту о новых уведомлениях — клиент сразу
  запрашивает GET /api/notifications/pending.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import defaultdict
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.container import Container
from app.schemas.responses import AuthenticationFailed
from app.services.access_control.principal import Principal
from core.interprocess.client import create_async_redis
from core.interprocess.events import REALTIME_CHANNEL, RealtimeEvent, RealtimeEventType

logger = logging.getLogger(__name__)

router = APIRouter()

CLOSE_POLICY = 1008
CLOSE_TOKEN_EXPIRED = 4001
CLOSE_SESSION_ENDED = 4003


class ConnectionHub:
    """Открытые соединения пользователей в пределах одного процесса."""

    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = defaultdict(set)

    def register(self, user_uuid: UUID, ws: WebSocket) -> None:
        self._connections[user_uuid].add(ws)

    def unregister(self, user_uuid: UUID, ws: WebSocket) -> None:
        connections = self._connections.get(user_uuid)
        if connections is None:
            return
        connections.discard(ws)
        if not connections:
            self._connections.pop(user_uuid, None)

    def count(self, user_uuid: UUID) -> int:
        return len(self._connections.get(user_uuid, ()))

    async def dispatch(self, event: RealtimeEvent) -> None:
        for ws in list(self._connections.get(event.user_uuid, ())):
            try:
                if event.type is RealtimeEventType.CLOSE:
                    self.unregister(event.user_uuid, ws)
                    await ws.close(code=CLOSE_SESSION_ENDED, reason="session ended")
                else:
                    await ws.send_json({"type": "notifications"})
            except (RuntimeError, WebSocketDisconnect):
                self.unregister(event.user_uuid, ws)

    async def close_all(self) -> None:
        for user_uuid in list(self._connections):
            for ws in list(self._connections.get(user_uuid, ())):
                with contextlib.suppress(RuntimeError):
                    await ws.close(code=1001)
        self._connections.clear()


class RedisEventListener:
    """Подписка на канал Redis Pub/Sub: команды для соединений этого процесса."""

    def __init__(self, url: str, hub: ConnectionHub) -> None:
        self._url = url
        self._hub = hub

    async def run(self) -> None:
        while True:
            client = create_async_redis(self._url)
            try:
                pubsub = client.pubsub()
                await pubsub.subscribe(REALTIME_CHANNEL)
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        await self._hub.dispatch(RealtimeEvent.from_json(message["data"]))
                    except (ValueError, KeyError):
                        logger.warning("Некорректное событие в канале %s", REALTIME_CHANNEL)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Нет подписки на события Redis, повтор через 5 секунд", exc_info=True)
                await asyncio.sleep(5)
            finally:
                with contextlib.suppress(Exception):
                    await client.aclose()


def _authenticate(container: Container, token: str) -> tuple[Principal, datetime]:
    claims = container.tokens.decode(token, audience=container.portal.audience, now=container.clock.now())
    uow = container.unit_of_work()
    try:
        principal = container.auth_service(uow).authenticate(token)
    finally:
        uow.close()
    return principal, claims.expires_at


async def _reject(ws: WebSocket, code: int = CLOSE_POLICY) -> None:
    with contextlib.suppress(RuntimeError):
        await ws.close(code=code)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    container: Container = ws.app.state.container
    hub: ConnectionHub = ws.app.state.hub

    # Соединения принимаются только со страниц приложения своего порта
    origin = (ws.headers.get("origin") or "").rstrip("/")
    if origin not in container.portal.allowed_origins:
        await _reject(ws)
        return
    if container.settings.require_secure_websocket and ws.url.scheme != "wss":
        await _reject(ws)
        return
    await ws.accept()

    # Токен передаётся первым сообщением, а не в адресе подключения
    try:
        message = await asyncio.wait_for(ws.receive_json(), timeout=container.settings.ws_auth_timeout_seconds)
        principal, expires_at = await run_in_threadpool(_authenticate, container, str(message["token"]))
    except (TimeoutError, KeyError, TypeError, ValueError, AuthenticationFailed, WebSocketDisconnect):
        await _reject(ws)
        return

    hub.register(principal.uuid, ws)
    try:
        await ws.send_json({"type": "ready"})
        while True:
            remaining = (expires_at - container.clock.now()).total_seconds()
            if remaining <= 0:
                await _reject(ws, CLOSE_TOKEN_EXPIRED)
                return
            try:
                text = await asyncio.wait_for(ws.receive_text(), timeout=remaining)
            except TimeoutError:
                await _reject(ws, CLOSE_TOKEN_EXPIRED)
                return
            if text == "ping":
                await ws.send_text("pong")
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.unregister(principal.uuid, ws)
