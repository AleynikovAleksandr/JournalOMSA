"""Одноразовые билеты перехода из журнала (порт 5600) в управление пользователями (порт 5620).

Сотрудник с правом «Настройки», вошедший в журнал, открывает управление
пользователями без повторного ввода логина и пароля: сервис web выдаёт билет,
сервис admin обменивает его на свою сессию. Билет:

* случайная строка из 256 бит, в Redis хранится только её SHA-256;
* действует 60 секунд и принимается один раз (GETDEL);
* привязан к пользователю и к сессии входа в журнал.

При недоступности Redis билет не выдаётся — остаётся обычный вход по паролю.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from uuid import UUID

import redis

logger = logging.getLogger(__name__)

TICKET_TTL_SECONDS = 60


class RedisHandoffTickets:
    KEY_PREFIX = "omsa:handoff:"

    def __init__(self, client: redis.Redis | None, *, ttl_seconds: int = TICKET_TTL_SECONDS) -> None:
        self._redis = client
        self._ttl_seconds = ttl_seconds

    def _key(self, ticket: str) -> str:
        return self.KEY_PREFIX + hashlib.sha256(ticket.encode()).hexdigest()

    def issue(self, user_uuid: UUID, session_id: UUID) -> str | None:
        if self._redis is None:
            return None
        ticket = secrets.token_urlsafe(32)
        payload = json.dumps({"user": str(user_uuid), "session": str(session_id)})
        try:
            self._redis.set(self._key(ticket), payload, ex=self._ttl_seconds)
        except redis.RedisError:
            logger.warning("Redis недоступен: билет перехода в управление пользователями не выдан")
            return None
        return ticket

    def redeem(self, ticket: str) -> tuple[UUID, UUID] | None:
        """Пользователь и сессия входа билета; повторно билет не принимается."""
        if not ticket or len(ticket) > 128 or self._redis is None:
            return None
        try:
            raw = self._redis.getdel(self._key(ticket))
        except redis.RedisError:
            logger.warning("Redis недоступен: билет перехода в управление пользователями не проверен")
            return None
        if raw is None:
            return None
        try:
            payload = json.loads(raw)
            return UUID(payload["user"]), UUID(payload["session"])
        except (ValueError, KeyError, TypeError):
            return None
