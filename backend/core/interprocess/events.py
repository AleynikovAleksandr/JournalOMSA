"""События для открытых WebSocket-соединений.

Соединения пользователя могут быть открыты в разных воркерах Gunicorn
и на разных подах, поэтому команды передаются через Redis Pub/Sub
(документ «WebRTC Control», 3.3.5):

* close  — закрыть все соединения пользователя (смена пароля, отметка
  «уволен», выход из системы);
* notify — у пользователя появились уведомления: клиент сразу запрашивает
  GET /api/notifications/pending, не дожидаясь очередного опроса.

Если приложению передана шина событий процесса (EventBus), события
доставляются через неё, без Redis.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

import redis

logger = logging.getLogger(__name__)

REALTIME_CHANNEL = "omsa:realtime"


class RealtimeEventType(StrEnum):
    CLOSE = "close"
    NOTIFY = "notify"


@dataclass(frozen=True, slots=True)
class RealtimeEvent:
    type: RealtimeEventType
    user_uuid: UUID

    def to_json(self) -> str:
        return json.dumps({"type": self.type.value, "user_uuid": str(self.user_uuid)})

    @classmethod
    def from_json(cls, raw: str | bytes) -> RealtimeEvent:
        data = json.loads(raw)
        return cls(RealtimeEventType(data["type"]), UUID(data["user_uuid"]))


Handler = Callable[[RealtimeEvent], Awaitable[None]]


class EventPublisher(Protocol):
    def publish(self, event: RealtimeEvent) -> None: ...


class NullEventPublisher:
    def publish(self, event: RealtimeEvent) -> None:
        logger.debug("Событие %s не передано: получателей нет", event)


class RedisEventPublisher:
    def __init__(self, client: redis.Redis) -> None:
        self._redis = client

    def publish(self, event: RealtimeEvent) -> None:
        try:
            self._redis.publish(REALTIME_CHANNEL, event.to_json())
        except redis.RedisError:
            logger.warning("Redis недоступен: событие %s не передано", event.type)


class EventBus(EventPublisher, Protocol):
    """Доставка событий соединениям внутри процесса вместо Redis Pub/Sub."""

    def subscribe(self, loop: asyncio.AbstractEventLoop, handler: Handler) -> int: ...
    def unsubscribe(self, token: int) -> None: ...
